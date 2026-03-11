/* ListerFlow Pro for Yaballe - history.js
   ASIN履歴管理 + 統計カウント
   ※ store.js, utils.js の後に読み込まれる必要があります
*/

/* ---------- Statistics ---------- */

/**
 * クリップボードにテキストをコピー（フォーカス喪失時のフォールバック付き）
 * navigator.clipboard.writeTextはドキュメントにフォーカスがないとNotAllowedErrorになるため、
 * 失敗時はexecCommand('copy')にフォールバックする
 */
async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch (err) {
    // フォールバック: execCommand('copy')を使用
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.cssText = 'position:fixed;left:-9999px;top:-9999px;opacity:0;';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
  }
}

async function incrementListingCount() {
  try {
    // バックグラウンドに統計更新を依頼（連鎖更新はSW側で完結）
    chrome.runtime.sendMessage({ type: "LFP_UPDATE_STATS" });

    // UI上の件数表示を更新
    await refreshListingCountUI();
  } catch (err) {
    console.error('[LFP] incrementListingCount error:', err);
  }
}

/* ---------- History ---------- */

/* 履歴データ形式: [{ asin:"B0XXXX", flags:{ protected:false, no_listings:false, brand:false }, lastSeen:timestamp }, ...] */

// ロック付き履歴操作ユーティリティ（競合状態防止）
async function withHistoryLock(fn) {
  // ロック取得を待機（最大1秒）
  let waitCount = 0;
  while (historyLock && waitCount < 20) {
    await sleep(50);
    waitCount++;
  }
  historyLock = true;
  try {
    return await fn();
  } finally {
    historyLock = false;
  }
}

async function saveHistoryPush(asin, flags = {}) {
  const a = normSpace(asin);
  if (!a) return;

  // ASINバリデーション: B0で始まる10桁の英数字のみ許可
  if (!/^B0[A-Z0-9]{8}$/i.test(a)) {
    console.log(`[LFP] ASIN形式不正のため履歴に追加しません: "${a}"`);
    return;
  }

  return withHistoryLock(async () => {
    try {
      const data = await chrome.storage.local.get([KEY_HIST]);
      let list = Array.isArray(data?.[KEY_HIST]) ? data[KEY_HIST] : [];

      // マイグレーション: 文字列配列からオブジェクト配列へ
      if (list.length > 0 && typeof list[0] === 'string') {
        list = list.map(x => ({ asin: x, flags: { protected: false, no_listings: false, brand: false }, lastSeen: now() }));
      }

      // 既存の同じASINを削除
      const filtered = list.filter(x => x.asin !== a);

      // 新しいエントリを先頭に追加
      filtered.unshift({
        asin: a,
        flags: {
          protected: flags.protected || false,
          no_listings: flags.no_listings || false,
          brand: flags.brand || false
        },
        lastSeen: now()
      });

      // 1000件を超えた場合は古いものから削除
      let historyToSave = filtered.slice(0, 1000);

      // ストレージ容量チェックと自動クリーンアップ
      const MAX_STORAGE_BYTES = 4 * 1024 * 1024; // 4MB (5MB制限の8割程度)
      const currentBytes = await chrome.storage.local.getBytesInUse(KEY_HIST);

      if (currentBytes > MAX_STORAGE_BYTES) {
        console.warn(`[LFP] ASIN履歴が ${MAX_STORAGE_BYTES / (1024 * 1024)}MB を超えました。古い履歴を自動削除します。`);
        // 古い履歴をさらに削除して容量を減らす (例: 10%削除)
        const reduceCount = Math.ceil(historyToSave.length * 0.1);
        historyToSave = historyToSave.slice(0, historyToSave.length - reduceCount);
      }

      await chrome.storage.local.set({ [KEY_HIST]: historyToSave });
    } catch (err) {
      if (err.message && err.message.includes('Extension context invalidated')) {
        // Extension context invalidated - 無視
      } else {
        console.error('[LFP] saveHistoryPush error:', err);
      }
    }
  });
}

async function updateHistoryFlags(asin, flags) {
  const a = normSpace(asin);
  if (!a) return;

  return withHistoryLock(async () => {
    try {
      const data = await chrome.storage.local.get([KEY_HIST]);
      let list = Array.isArray(data?.[KEY_HIST]) ? data[KEY_HIST] : [];

      // マイグレーション
      if (list.length > 0 && typeof list[0] === 'string') {
        list = list.map(x => ({ asin: x, flags: { protected: false, no_listings: false, brand: false }, lastSeen: now() }));
      }

      // 該当ASINのフラグを更新
      const entry = list.find(x => x.asin === a);
      if (entry) {
        entry.flags = { ...entry.flags, ...flags };
        entry.lastSeen = now();
        await chrome.storage.local.set({ [KEY_HIST]: list });
      }
    } catch (err) {
      if (err.message && err.message.includes('Extension context invalidated')) {
        // Extension context invalidated - 無視
      } else {
        console.error('[LFP] updateHistoryFlags error:', err);
      }
    }
  });
}

async function loadHistory() {
  // chrome.storageの有効性をチェック
  if (!chrome?.storage?.local) {
    return [];
  }

  try {
    const data = await chrome.storage.local.get([KEY_HIST]);
    let list = Array.isArray(data?.[KEY_HIST]) ? data[KEY_HIST] : [];

    // マイグレーション
    if (list.length > 0 && typeof list[0] === 'string') {
      list = list.map(x => ({ asin: x, flags: { protected: false, no_listings: false, brand: false }, lastSeen: now() }));
      await chrome.storage.local.set({ [KEY_HIST]: list });
    }

    return list;
  } catch (err) {
    if (err.message && err.message.includes('Extension context invalidated')) {
      // Extension context invalidated - 空の配列を返す
    } else {
      console.error('[LFP] loadHistory error:', err);
    }
    return [];
  }
}

async function resetHistory() {
  try {
    await chrome.storage.local.remove([KEY_HIST]);
  } catch (err) {
    // Extension context invalidated エラーを無視
    if (err.message && err.message.includes('Extension context invalidated')) {
      // 無視して継続
    } else {
      throw err;
    }
  }
}

// 履歴から特定のASINを削除（content.js用）
async function deleteHistoryItemFromContent(asin) {
  return withHistoryLock(async () => {
    try {
      const hist = await loadHistory();
      const filtered = hist.filter(entry => entry.asin !== asin);
      await chrome.storage.local.set({ [KEY_HIST]: filtered });
      // UIの更新は呼び出し元で行う（二重更新防止）
    } catch (err) {
      // Extension context invalidated エラーを無視
      if (err.message && err.message.includes('Extension context invalidated')) {
        // 無視して継続
      } else {
        console.error('[LFP] deleteHistoryItemFromContent error:', err);
      }
    }
  });
}
