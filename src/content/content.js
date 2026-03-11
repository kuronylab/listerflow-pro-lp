/* ListerFlow Pro for Yaballe (MV3 content script)
   ※ STORE定数・グローバル変数は store.js に分離済み
*/

/* ---------- ライセンス・オプション管理は license.js に分離済み ---------- */

/* ---------- Statistics・History は history.js に分離済み ---------- */

/* ---------- DOM helpers は dom-helpers.js に分離済み ---------- */

/* ---------- Vero / タイトル短縮 / ターゲット文字数判定は vero.js に分離済み ---------- */


/* ---------- UI ---------- */

const UI = {
  root: null,
  status: null,
  badge: null,
  btnOpt: null,
  btnLabel: null,
  spin: null,
  asinBar: null,
  histSel: null,
  quickMipBtn: null,
  statsBar: null,
  listingCountLabel: null,
  pauseResumeBtn: null
};

function destroyMainUI() {
  if (UI.root && UI.root.isConnected) {
    console.log('🗑️ [LFP] main UI removed');
    UI.root.remove();
  }
  UI.root = null;
  UI.status = null;
  UI.badge = null;
  UI.btnOpt = null;
  UI.btnLabel = null;
  UI.spin = null;
}

function ensureUIBelowTitle(titleEl) {
  if (!titleEl) return;
  if (UI.root && UI.root.isConnected) return;

  // ステータス表示用のボックス（Get ItemとVero Warningsの間に配置）
  const statusBox = document.createElement("div");
  statusBox.className = "lfp-status-box";
  statusBox.id = "lfp-status-box";

  const row = document.createElement("div");
  row.className = "lfp-row";

  const btn = document.createElement("button");
  btn.className = "lfp-btn";
  btn.type = "button";
  // ハイライト設定がONなら生成時点で即適用（黒色フラッシュ防止）
  if (STORE.opt.highlightOptimize) {
    btn.classList.add("highlight");
  }

  const label = document.createElement("span");
  label.className = "lfp-btn-label";
  label.textContent = "最適化";

  const spin = document.createElement("span");
  spin.className = "lfp-spin";
  spin.style.display = "none";

  btn.appendChild(label);
  btn.appendChild(spin);

  const status = document.createElement("div");
  status.className = "lfp-status";
  status.textContent = "文字数：計算中... / Vero：- / 出品：-";

  row.appendChild(btn);
  row.appendChild(status);

  const badge = document.createElement("div");
  badge.className = "lfp-badge";
  badge.textContent = "";

  statusBox.appendChild(row);
  statusBox.appendChild(badge);

  // Vero Warningsの直前に挿入
  insertBeforeVeroWarnings(statusBox);

  UI.root = statusBox;
  UI.status = status;
  UI.badge = badge;
  UI.btnOpt = btn;
  UI.btnLabel = label;
  UI.spin = spin;

}

function setBusy(isBusy) {
  if (!UI.btnOpt) return;

  // 出品中（MIP後）は、たとえbusy指示が来ても「最適化中」には変えない
  if (isBusy && STORE.turboExecuted.mip) {
    if (UI.btnLabel) UI.btnLabel.textContent = "最適化";
    if (UI.spin) UI.spin.style.display = "none";
    UI.btnOpt.disabled = true;
    return;
  }

  UI.btnOpt.disabled = isBusy;

  // 最適化中の表示
  if (isBusy) {
    if (UI.btnLabel) UI.btnLabel.textContent = "最適化中";
    if (UI.spin) UI.spin.style.display = "inline-block";
  } else {
    // 最適化完了時の表示：needsRetryに応じて「最適化」または「再実行」
    // ロック中（MIP後）は強制的に「最適化」表記にする
    const label = STORE.turboExecuted.mip ? "最適化" : (STORE.optimizeState.needsRetry ? "再実行" : "最適化");
    if (UI.btnLabel) UI.btnLabel.textContent = label;
    if (UI.spin) UI.spin.style.display = "none";
  }

  // ハイライト管理：常に設定に基づいて不整合を防ぐ
  if (STORE.opt.highlightOptimize) {
    UI.btnOpt.classList.add("highlight");
    // インラインスタイルを残さないようにして、CSSを優先させる
    UI.btnOpt.style.background = "";
    UI.btnOpt.style.color = "";
  }
}

function setStatusLine(len, veroCount, shipText, highlight) {
  if (!UI.status) return;
  UI.status.textContent = `文字数：${len} / Vero：${veroCount} / 出品：${shipText}`;
  if (UI.btnOpt && STORE.opt.highlightOptimize) {
    // 修正: 最適化完了後も常に.highlightクラスを保持
    // highlightOptimizeがONの場合、常に.highlightクラスを付与
    UI.btnOpt.classList.add("highlight");
    // インラインスタイルをクリア
    UI.btnOpt.style.background = "";
    UI.btnOpt.style.color = "";
  } else if (UI.btnOpt) {
    // highlightOptimizeがOFFの場合のみ削除
    UI.btnOpt.classList.remove("highlight");
  }
}

function setBadge(text) {
  if (!UI.badge) return;
  UI.badge.textContent = text || "";
}

function resetUIState() {
  setBadge("");
  if (UI.btnOpt) {
    UI.btnOpt.disabled = false;
    if (UI.btnLabel) UI.btnLabel.textContent = "最適化";
    if (UI.spin) UI.spin.style.display = "none";
  }
  if (UI.status) {
    UI.status.textContent = "文字数：- / Vero：- / 出品：-";
  }
  // 点滅防止: highlightOptimizeがONの場合はクラスを維持
  if (UI.btnOpt && !STORE.opt.highlightOptimize) {
    UI.btnOpt.classList.remove("highlight");
  }
  // 最適化状態をリセット
  STORE.optimizeState.needsRetry = false;
  STORE.optimizeState.lastOutputs = [];
  // MIPボタンの点滅防止フラグをリセット（次のASINで正しく再判定）
  if (UI.quickMipBtn) UI.quickMipBtn._wasEnabled = false;

  // 出品成功判定フラグはここではなくhandleGetItemClickでASIN変更時にリセット
  // okButtonClicked = false; // 削除: 二重表示防止のため
  listingCounted = false;
  STORE.turboExecuted.mip = false;
  STORE.turboExecuted.optimizeCount = 0;

  if (okButtonCheckInterval) {
    clearInterval(okButtonCheckInterval);
    okButtonCheckInterval = null;
  }
}

/* ---------- Quick MIP ---------- */

function findRealMipButton() {
  return document.querySelector("#mip-list-item-btn") || null;
}


function clickRealMipButton() {
  const real = findRealMipButton();
  if (!real) return false;
  const aria = real.getAttribute("aria-disabled");
  if (aria === "true") return false;
  if (real.hasAttribute("disabled")) return false;

  // 重要：手動/自動に関わらずMIPボタンをクリックしたら「実行済み」としてマーク
  // これにより、出品完了までの遷移中に自動最適化が走るのを防ぐ
  STORE.turboExecuted.mip = true;

  // ユーザー提案：MIP後は最適化ボタンを即座に無効化（グレーアウト）する
  if (UI.btnOpt) UI.btnOpt.disabled = true;

  real.click();
  return true;
}

function ensureQuickMipButton(btnGet) {
  // 既に存在する場合は何もしない（再生成を防止）
  if (UI.quickMipBtn && UI.quickMipBtn.isConnected) return;

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "btn btn-primary btn-custom-secondary";
  btn.id = "lfp-quick-mip";

  btn.style.width = `${btnGet.getBoundingClientRect().width}px`;
  btn.style.marginLeft = "8px";
  btn.style.whiteSpace = "nowrap";
  btn.style.display = "inline-flex"; // 常に表示（有効/無効で制御）
  btn.style.alignItems = "center";
  btn.style.justifyContent = "center";
  btn.disabled = true; // 初期状態は無効（条件判定後に有効化）

  btn.innerHTML = `<span>MIP&nbsp;&nbsp;<i class="glyph-icon icon-linecons-paper-plane"></i></span>`;
  btn.addEventListener("click", () => clickRealMipButton());

  btnGet.parentElement?.appendChild(btn);
  UI.quickMipBtn = btn;
}

function removeQuickMipButton() {
  if (UI.quickMipBtn && UI.quickMipBtn.isConnected) UI.quickMipBtn.remove();
  UI.quickMipBtn = null;
}

/* ---------- OpenAI は openai.js に分離済み ---------- */

/* ---------- Evaluate / Optimize は optimize.js に分離済み ---------- */

/* ---------- State control: show UI only after Get Item populated Title ---------- */

let uiUnlocked = false;
let lastPasteAt = 0;

function lockUI() {
  uiUnlocked = false;
  // UIを完全に消去して、次のタイトル出現まで待機する
  destroyMainUI();
  // MIPボタンは削除せず、常時グレーアウト表示を維持（resetUIStateで無効化済み）
}

function unlockUI(titleEl) {
  uiUnlocked = true;
  ensureUIBelowTitle(titleEl);
  wireOptimizeButton(titleEl);

  // UI作成後、即座にステータスを更新（ラグ解消）
  const title = readText(titleEl);
  const len = (title || "").length;
  if (UI.status && len > 0) {
    UI.status.textContent = `文字数：${len} / Vero：計算中... / 出品：計算中...`;
  }

  // 出品統計も即座に更新
  refreshListingCountUI();
}

function wireOptimizeButton(titleEl) {
  if (!UI.btnOpt) return;
  if (UI.btnOpt.dataset.lfpWired) return;
  UI.btnOpt.dataset.lfpWired = "1";
  UI.btnOpt.addEventListener("click", async () => onOptimizeClick({ titleEl }));
}

/* ---------- History UI は history-ui.js に分離済み ---------- */
/* ---------- MutationObserver (debounced) ---------- */

let evalTimer = null;
let evalRunning = false;

function scheduleEvaluate(fn, delay = 300) {
  if (evalTimer) clearTimeout(evalTimer);
  evalTimer = setTimeout(async () => {
    if (evalRunning) return;
    evalRunning = true;
    try {
      await fn();

      // Get Item完了後（評価後）に最速出品モードの判定
      const titleEl = findTitleFieldSmart();
      const btnGet = findButtonByText(/^Get Item$/i);
      if (STORE.opt.turboListingMode && titleEl && btnGet) {
        handleTurboListing(titleEl, btnGet);
      }
    } catch (err) {
      if (err.message && err.message.includes('Extension context invalidated')) {
        attemptRecovery();
      } else {
        console.error('[LFP] scheduleEvaluate error:', err);
      }
    } finally {
      evalRunning = false;
    }
  }, delay);
}

/**
 * 最速出品モード（ターボモード）の実行判定
 * ステータスが「OK」または「OK（最適化後）」になった瞬間にボタンを代理クリックする。
 * ロック処理は行わず、既存のボタンの状態に従う。
 */
async function handleTurboListing(titleEl, btnGet) {
  if (!STORE.opt.turboListingMode) return;

  // すでにMIP実行済みの場合は何もせず終了（重複クリック防止）
  if (STORE.turboExecuted.mip) return;

  // 管理者なら無制限
  const currentPlan = (STORE.license.plan || "free").toLowerCase();

  if (currentPlan === 'free') {
    // BasicプランはTurbo不可。Popupで制限しているため、ここでONの場合はアカウント切り替え等のラグ。
    // アラートは出さずにSilentにOFFにする（再ログイン時の不快なポップアップを防ぐ）
    STORE.opt.turboListingMode = false;
    chrome.storage.sync.get(['lfp_options_v1']).then(data => {
      const opt = data.lfp_options_v1 || {};
      opt.turboListingMode = false;
      chrome.storage.sync.set({ 'lfp_options_v1': opt });
    });
    return;
  }
  const statusText = UI.status?.textContent || "";

  // 1. 最適化が必要な場合（最大3回まで自動リトライ）
  // ★ 「出品：OK（最適化後）」= まだ最適化されていない → 最適化ボタンを押す
  if (statusText.includes("出品：OK（最適化後）")) {
    const titleVal = normSpace(readText(titleEl));
    // タイトルが空（取得中や完了後など）の場合は最適化を自動実行しない
    if (!titleVal) return;

    if (UI.btnOpt && !UI.btnOpt.disabled && !optimizeRunning && STORE.turboExecuted.optimizeCount < 3) {
      console.log(`[LFP] Turbo: 自動最適化ボタンをクリック (${STORE.turboExecuted.optimizeCount + 1}/3)`);
      STORE.turboExecuted.optimizeCount++;
      UI.btnOpt.click();
    }
  }
  // 2. 最適化完了後 or 最適化不要で出品可能な場合（MIP自動クリック）
  // ★ 「出品：OK」（「（最適化後）」なし）= 最適化済み → MIPボタンを押す
  else if (statusText.includes("出品：OK") && !statusText.includes("（最適化後）")) {
    if (UI.quickMipBtn && !UI.quickMipBtn.disabled && !STORE.turboExecuted.mip) {
      // 最適化実行中（API待ち）ならスキップ
      if (optimizeRunning) return;

      console.log("[LFP] Turbo: 自動MIPボタンをクリック");
      STORE.turboExecuted.mip = true; // 実行済みフラグを先に立てる

      // 少し待機してから実行
      setTimeout(() => {
        clickRealMipButton();
      }, 250);
    }
  }
}

/**
 * ターボモードの使用カウントを加算する処理
 * OKボタン自動クリック処理を邪魔しないように分離
 */
async function checkAndIncrementTurboCount() {
  const currentPlan = (STORE.license.plan || '').toLowerCase();
  console.log(`[LFP] checkAndIncrementTurboCount called with plan: ${currentPlan}`);
  
  if (currentPlan !== 'pro' && currentPlan !== 'pro-trial') {
    console.log(`[LFP] Turbo count increment skipped for plan: ${currentPlan}`);
    return;
  }

  try {
    const licData = await chrome.storage.local.get(['lfp_license_v1', 'lfp_active_email']);
    const email = licData.lfp_active_email || getYaballeCurrentEmail();
    const license = licData?.lfp_license_v1 || {};

    if (!license.turboTrialCounts) license.turboTrialCounts = {};

    if (email) {
      license.turboTrialCounts[email] = (license.turboTrialCounts[email] || 0) + 1;
      console.log(`[LFP] Account: ${email}, Turbo Trial Count incremented to: ${license.turboTrialCounts[email]}/5`);
    } else {
      license.turboTrialCount = (license.turboTrialCount || 0) + 1;
    }

    await chrome.storage.local.set({ 'lfp_license_v1': license });
    chrome.runtime.sendMessage({ type: "LFP_SYNC_REQUEST" });

    const currentCount = email ? license.turboTrialCounts[email] : license.turboTrialCount;

    if (currentCount >= 5) {
      STORE.opt.turboListingMode = false;
      const optionsData = await chrome.storage.sync.get(['lfp_options_v1']);
      const opt = optionsData?.lfp_options_v1 || {};
      opt.turboListingMode = false;
      await chrome.storage.sync.set({ 'lfp_options_v1': opt });
      
      const disableKey = email ? `lfp_turbo_auto_disabled_${email}` : 'lfp_turbo_auto_disabled';
      await chrome.storage.local.set({ [disableKey]: true, 'lfp_turbo_auto_disabled': true });
      
      STORE.turboTrialAlertShown = true;
      // OKボタンクリックを邪魔しないように少し遅延させてからアラート表示
      setTimeout(() => {
        showLfpAlert("本日のTurbo Mode試用制限（5回）に達しました。\n次回以降は自動でOFFになります。\nPremiumプランにアップグレードすると無制限に利用可能です。", "Premium限定機能");
      }, 1500);
    }
  } catch (err) {
    console.error("[LFP] Turbo count increment error:", err);
  }
}

let initRunning = false;

async function init() {
  if (initRunning) return;

  // エクステンションコンテキストの有効性をチェック
  if (!isExtensionContextValid()) {
    console.log("[LFP] エクステンションコンテキストが無効です。初期化をスキップします。");
    return;
  }

  // チラつき防止：成功/エラーモーダルが表示されている間は、現在のUIの状態を維持したまま処理を抜ける
  // これにより、モーダル出現時にタイトル要素が一時的に隠れてUIが消去されるのを防ぐ
  // offsetParentのチェックを外すことで、レンダリング直前のモーダルも早期に捉える
  const modal = document.querySelector('.modal, [role="dialog"]');
  if (modal && !modal.dataset.lfpModal) {
    return;
  }

  initRunning = true;

  try {
    await loadOptions();
    if (!isListerRoute()) { lockUI(); return; }

    const btnGet = findButtonByText(/^Get Item$/i);
    const asinInput = findAsinInputSmart(btnGet);
    // 存在確認は非表示（モーダルによる隠蔽など）でもOKとする
    const titleEl = findTitleFieldSmart(true);

    if (STORE.opt.historyEnabled && asinInput && (!UI.asinBar || !UI.asinBar.isConnected)) {
      const bar = document.createElement("div");
      bar.className = "lfp-asinbar";
      bar.id = "lfp-asinbar";

      const sel = document.createElement("select");
      sel.id = "lfp-hist";
      sel.innerHTML = `<option value="">ASIN履歴（直近100件）</option>`;
      bar.appendChild(sel);

      // リセットボタンを追加
      const resetBtn = document.createElement("button");
      resetBtn.className = "lfp-reset-btn";
      resetBtn.textContent = "×リセット";
      resetBtn.title = "ASIN履歴をすべて削除";
      resetBtn.addEventListener("click", async () => {
        const confirmed = await showLfpConfirm("ASIN履歴をすべて削除しますか？", "ASIN履歴リセット");
        if (confirmed) {
          try {
            await resetHistory();
            // ページ内表示を更新（履歴のみ）
            await refreshHistorySelect(true);
            await refreshListingCountUI();
            await showLfpAlert("ASIN履歴をリセットしました", "完了");
          } catch (err) {
            console.error('リセットエラー:', err);
            await showLfpAlert("リセット中にエラーが発生しました。", "エラー");
          }
        }
      });
      bar.appendChild(resetBtn);

      // コピーボタンを追加
      const copyBtn = document.createElement("button");
      copyBtn.id = "lfp-copy-btn-id";
      copyBtn.className = "lfp-copy-btn";
      copyBtn.textContent = "📋コピー";
      copyBtn.title = "ASIN履歴をクリップボードにコピー";
      copyBtn.style.display = STORE.opt.showCopyCsvButtons ? "inline-block" : "none";
      bar.appendChild(copyBtn);

      // CSVボタンを追加
      const csvBtn = document.createElement("button");
      csvBtn.id = "lfp-csv-btn-id";
      csvBtn.className = "lfp-csv-btn";
      csvBtn.textContent = "📊CSV";
      csvBtn.title = "ASIN履歴をCSVでダウンロード";
      csvBtn.style.display = STORE.opt.showCopyCsvButtons ? "inline-block" : "none";
      bar.appendChild(csvBtn);

      // 統計情報ボタンを追加
      const statsBtn = document.createElement("button");
      statsBtn.id = "lfp-open-stats-btn";
      statsBtn.className = "lfp-stats-btn";
      statsBtn.textContent = "📈統計情報";
      statsBtn.title = "統計情報を表示";
      statsBtn.style.cssText = "background:#fff; border-color:rgba(0,0,0,.1); cursor:pointer; transition:background 0.2s;";
      statsBtn.addEventListener("mouseover", () => statsBtn.style.background = "#f0f0f0");
      statsBtn.addEventListener("mouseout", () => statsBtn.style.background = "#fff");
      statsBtn.addEventListener("click", (e) => {
        e.preventDefault();
        toggleStatsPopup();
      });
      bar.appendChild(statsBtn);

      // 出品件数ラベルを追加
      const countLabel = document.createElement("span");
      countLabel.className = "lfp-listing-count-label";
      countLabel.style.marginLeft = "12px";
      countLabel.style.fontSize = "14px";
      countLabel.style.fontWeight = "bold";
      countLabel.style.color = "#111";
      countLabel.style.display = "inline-flex";
      countLabel.style.alignItems = "center";
      countLabel.style.height = "32px";
      countLabel.textContent = "出品完了: -件";
      bar.appendChild(countLabel);
      UI.listingCountLabel = countLabel;

      asinInput.parentElement?.insertBefore(bar, asinInput);

      UI.asinBar = bar;
      UI.histSel = sel;

      // MIPボタンもASINバーと同時に生成（表示タイミングを揃える）
      if (STORE.opt.quickMipButton && btnGet) ensureQuickMipButton(btnGet);

      await refreshHistorySelect();
      await refreshListingCountUI();

      // コピーボタンのイベント（スプレッドシート用2カラム形式）
      copyBtn.addEventListener("click", async () => {
        const hist = await loadHistory();
        if (hist.length === 0) {
          showLfpAlert("コピーする履歴がありません");
          return;
        }

        // ドロップダウンの表示テキストからエラー状態を直接判定するマップを作成
        // 履歴リスト(hist)は[最新, ..., 最古]の順
        // 貼り付け時は[最古, ..., 最新]の順（.reverse()）
        const dropdownItems = document.querySelectorAll('.lfp-dropdown-item');
        const errorMap = {};
        dropdownItems.forEach(el => {
          const text = el.textContent || "";
          const asin = el.dataset.asin;
          if (asin) {
            // 表示テキストが ! または × で始まる場合はエラーとみなす
            errorMap[asin] = text.startsWith('!') || text.startsWith('×');
          }
        });

        // 履歴を反転（古い順）させてから、スプレッドシート用の2カラム（出品日、エラー日）を作成
        const rows = [...hist].reverse().map(item => {
          const date = item.lastSeen ? new Date(item.lastSeen) : new Date();
          const dateStr = `${date.getMonth() + 1}/${date.getDate()}`;

          let dateCol1 = dateStr; // 出品日
          let dateCol2 = '';      // エラー日

          // エラー判定：
          // 1. 画面上の表示テキスト（! または ×）を最優先
          // 2. 保存されているフラグを次点
          const f = item.flags || {};
          const isError = (errorMap[item.asin] === true) ||
            !!(f.protected || f.brand || f.already_listed || f.no_listings || f.no_item);

          if (isError) {
            dateCol1 = '';
            dateCol2 = dateStr;
          }
          // 1行目から確実にタブを含める
          return `${dateCol1}\t${dateCol2}`;
        });

        // スプレッドシートへの貼り付け時にズレが生じないよう、末尾の改行のみを削除する
        const finalCopyText = rows.join("\r\n");

        // クリップボードにコピー（フォーカス喪失時のフォールバック付き）
        copyToClipboard(finalCopyText).then(() => {
          copyBtn.textContent = "✅ コピー完了！";
          setTimeout(() => {
            copyBtn.textContent = "📋コピー";
          }, 2000);
        }).catch(() => {
          copyBtn.textContent = "❌ コピー失敗";
          setTimeout(() => {
            copyBtn.textContent = "📋コピー";
          }, 2000);
        });
      });

      // CSV出力ボタンのイベント（スプレッドシート用2カラム形式）
      csvBtn.addEventListener("click", async () => {
        const hist = await loadHistory();
        if (hist.length === 0) {
          showLfpAlert("出力する履歴がありません");
          return;
        }

        let csvContent = "\uFEFF"; // BOM for Excel
        csvContent += "ASINコード,結果,出品日,エラーにより出品不可\r\n";

        // 履歴を反転（古い順）させてから出力
        [...hist].reverse().forEach(item => {
          const date = item.lastSeen ? new Date(item.lastSeen) : new Date();
          const dateStr = `${date.getMonth() + 1}/${date.getDate()}`;

          // 結果カラムを追加
          let result = '出品完了';
          if (item.flags?.no_listings) result = 'No listings';
          else if (item.flags?.no_item) result = 'No item';
          else if (item.flags?.protected) result = 'Protected';
          else if (item.flags?.brand) result = 'Brand';
          else if (item.flags?.already_listed) result = 'Already listed';

          let dateCol1 = dateStr; // 出品日
          let dateCol2 = ' ';     // エラー日（空白の場合はスペース）

          if (item.flags?.protected || item.flags?.brand || item.flags?.already_listed || item.flags?.no_listings || item.flags?.no_item) {
            dateCol1 = ' ';       // 空白の場合はスペース
            dateCol2 = dateStr;
          }

          csvContent += `"${item.asin}","${result}","${dateCol1}","${dateCol2}"\r\n`;
        });

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.setAttribute("href", url);
        link.setAttribute("download", `LFP_ASIN履歴_${new Date().toLocaleDateString()}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      });

      sel.addEventListener("change", async () => {
        const v = sel.value;
        if (!v) return;
        resetUIState();
        setInputValue(asinInput, v);

        if (STORE.opt.autoGetOnHistory && btnGet) {
          await sleep(60);
          btnGet.click();
        }
      });
    }

    if (!titleEl) {
      lockUI();
      return;
    }

    const titleNow = normSpace(readText(titleEl));

    if (uiUnlocked) {
      ensureUIBelowTitle(titleEl);
      // MIPボタンを常時表示（初期状態はグレーアウト）
      if (STORE.opt.quickMipButton && btnGet) ensureQuickMipButton(btnGet);

      scheduleEvaluate(async () => {
        await evaluateAndRender({ titleEl, btnGet });
      }, 50);  // ラグ解消のため遅延を短縮

      if (!titleNow) lockUI();
    } else {
      destroyMainUI();
      // MIPボタンを常時表示（初期状態はグレーアウト）
      if (STORE.opt.quickMipButton && btnGet) ensureQuickMipButton(btnGet);

      if (titleNow) {
        unlockUI(titleEl);
        await sleep(30);
        await evaluateAndRender({ titleEl, btnGet });
      }
    }

    // 直接のリスナー登録（data-lfp-wired）は廃止し、イベント委譲（Delegation）に移行。
    // 代わりに要素の存在チェックとUIの整合性確認のみを行う。

    if (asinInput && (STORE.opt.historyEnabled || STORE.opt.autoGetOnPaste)) {
      if (!UI.asinBar || !UI.asinBar.isConnected) {
        // UIが未生成、または切り離されている場合は生成
        scheduleInit();
      }
    }

    // MutationObserverの初期化（初回のみ）
    if (!mainObserver) {
      mainObserver = new MutationObserver((muts) => {
        if (!isListerRoute()) return;
        for (const m of muts) {
          if (isInsideLfp(m.target)) return;
          if (m.addedNodes && Array.from(m.addedNodes).some(isInsideLfp)) return;
        }
        scheduleEvaluate(init, 300);
      });
      mainObserver.observe(document.body, { childList: true, subtree: true, characterData: true });

      // 新規: リアルタイム更新タイマーを起動
      startWorkTimeUpdateTimer();
    }

    // 各種Observerの初期化（初回のみ）
    if (!observersInitialized) {
      setupNoListingsObserver();
      setupListingSuccessObserver();
      setupGlobalEventListeners(); // 委譲リスナーをセットアップ
      setupListerPageDetection();  // 出現監視
      // メッセージリスナー
      chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.type === 'LFP_SYNC_UI') {
          refreshListingCountUI();
          // ドロップダウンが開いている場合は履歴の再構築をスキップ（閉じてしまう問題の防止）
          const dropdown = document.getElementById('lfp-custom-dropdown');
          if (!dropdown || dropdown.style.display !== 'block') {
            refreshHistorySelect();
          }
        } else if (message.type === 'RESET_UI') {
          resetUIState();
          // ASIN入力欄もクリア
          const asinInput = findAsinInputSmart();
          if (asinInput) setInputValue(asinInput, "");
          sendResponse({ ok: true });
        }
        return true;
      });
      observersInitialized = true;
    }

  } catch (err) {
    console.error('[LFP] init error:', err);
    // Extension context invalidatedの場合はリカバリーを試行
    if (err.message && err.message.includes('Extension context invalidated')) {
      attemptRecovery();
    }
  } finally {
    initRunning = false;
  }
}

/* No listingsモーダル検出用のMutationObserver */
/**
 * エラーモーダルの検知と自動処理（履歴更新・ターボ時は自動クローズ）
 */
/* ---------- Modal Observer (エラー/成功モーダル監視) は observers.js に分離済み ---------- */

/* ---------- Route ---------- */

let routeTimer = null;
let lastInitCall = 0;
function scheduleInit(delay = 250) {
  const now = Date.now();
  // 非常に短い間隔（100ms以内）での連続呼び出しを抑制
  if (now - lastInitCall < 100) return;
  lastInitCall = now;

  if (routeTimer) clearTimeout(routeTimer);
  routeTimer = setTimeout(() => {
    init().catch((err) => {
      console.error('[LFP] scheduleInit -> init error:', err);
    });
  }, delay);
}

window.addEventListener("hashchange", () => {
  console.log('[LFP] hashchange detected:', location.hash);

  // UIを完全にクリーンアップ
  if (UI.asinBar && UI.asinBar.isConnected) {
    UI.asinBar.remove();
  }
  UI.asinBar = null;
  UI.histSel = null;

  if (!isListerRoute()) {
    lockUI();
  } else {
    // Listerページに遷移した場合、UIをリセットして再初期化
    lockUI();
  }

  try { lfpApplyMipCompactLabel(); } catch (_) { }
  scheduleInit();
});

scheduleInit();

/* LFP MIP COMPACT PATCH START */
function lfpCompactMipLabelFor(el) {
  if (!el) return;
  const span = el.querySelector("span");
  if (!span) return;

  // すでに置換済みなら何もしない
  if (span.dataset.lfpCompact === "1") return;
  span.dataset.lfpCompact = "1";

  // 中身を「MIP + 紙飛行機」に統一
  span.innerHTML = `MIP <i class="glyph-icon icon-linecons-paper-plane"></i>`;

  // span自体の中央寄せ・幅確保（CSS側でもやるが念のため）
  span.style.display = "inline-flex";
  span.style.alignItems = "center";
  span.style.justifyContent = "center";
  span.style.gap = "10px";
  span.style.whiteSpace = "nowrap";
  span.style.width = "100%";
}

function lfpApplyMipCompactLabel() {
  // 実ボタン
  const real = document.querySelector("#mip-list-item-btn");
  if (real) lfpCompactMipLabelFor(real);

  // クイックMIP（存在する場合）
  const quick = document.querySelector("#lfp-quick-mip");
  if (quick) lfpCompactMipLabelFor(quick);
}
/* LFP MIP COMPACT PATCH END */

/* ---------- SPA Navigation Detection ---------- */ // ASIN入力欄の変更監視（リカバリー用：再ペースト時に状態をクリア）
const asinInput = findAsinInputSmart();
if (asinInput) {
  asinInput.addEventListener('input', () => {
    const currentVal = asinInput.value.trim();
    if (currentVal !== STORE.lastRequestedAsin) {
      console.log('[LFP] ASIN change detected. Resetting state for recovery.');
      STORE.lastRequestedAsin = currentVal;

      // 内部状態のリセット
      STORE.optimizeState.needsRetry = false;
      STORE.turboExecuted.optimizeCount = 0;
      STORE.turboExecuted.mip = false;
      okButtonClicked = false;
      listingCounted = false;

      // UI表示の初期化
      STORE.shipStatus = "取得中...";
      if (UI.badge) {
        UI.badge.textContent = "";
        UI.badge.style.display = "none";
      }
      if (UI.btnOpt) {
        UI.btnOpt.disabled = false;
        if (UI.btnLabel) UI.btnLabel.textContent = "最適化";
      }

      // 掃討モードが走っていたら停止
      stopAggressiveCleaner();
    }
  });
}

// URLハッシュ変更を検知してSPA遷移時に拡張機能を再初期化
let lastHash = location.hash;

function setupSPANavigationDetection() {
  const checkHashChange = async () => {
    const currentHash = location.hash;

    // ハッシュが変更された場合
    if (currentHash !== lastHash) {
      console.log(`🔄 [SPA Navigation] ${lastHash} → ${currentHash}`);
      lastHash = currentHash;

      // Listerページに遷移した場合、拡張機能を再初期化
      if (isListerRoute()) {
        console.log('✅ [SPA Navigation] Listerページに遷移しました。拡張機能を再初期化します。');

        // 少し待ってから初期化（DOMが更新されるのを待つ）
        await sleep(300);
        scheduleEvaluate(init, 200);
      }
    }
  };

  // hashchange イベントを監視
  window.addEventListener('hashchange', checkHashChange);

  // MutationObserverでもURL変更を監視（念のため）
  if (!urlChangeObserver) {
    urlChangeObserver = new MutationObserver(() => {
      if (location.hash !== lastHash) {
        checkHashChange();
      }
    });

    urlChangeObserver.observe(document.querySelector('title') || document.head, {
      childList: true,
      subtree: true,
      characterData: true
    });
  }

  console.log('🔍 [SPA Navigation] URLハッシュ変更の監視を開始しました');
}


// SPA遷移検知を開始
setupSPANavigationDetection();


/* ---------- Window Focus Recovery ---------- */

// ウィンドウがフォーカスを取り戻した時に拡張機能を再初期化
let lastFocusTime = Date.now();
let focusRecoveryInProgress = false;

window.addEventListener('focus', async () => {
  // 連続呼び出し防止（1秒以内の再フォーカスは無視）
  const now = Date.now();
  if (now - lastFocusTime < 1000) return;
  lastFocusTime = now;

  // 既にリカバリー中なら無視
  if (focusRecoveryInProgress) return;
  focusRecoveryInProgress = true;

  try {
    console.log('🔄 [Focus Recovery] ウィンドウがフォーカスを取り戻しました');

    // リカバリー用の待機時間を大幅に短縮（ユーザー体験向上）
    await sleep(50);

    // エクステンションコンテキストの有効性をチェック
    if (!isExtensionContextValid()) {
      console.log('⚠️ [Focus Recovery] エクステンションコンテキストが無効です。リカバリーを試行します。');
      await attemptRecovery();
      return;
    }

    // Listerページでない場合は何もしない
    if (!isListerRoute()) return;

    // UIが存在するかチェック
    const uiExists = document.querySelector('.lfp-asinbar, .lfp-status-box');
    const titleEl = findTitleFieldSmart();

    if (!uiExists && titleEl) {
      // UIが消えている場合は再初期化
      console.log('⚠️ [Focus Recovery] UIが消えています。再初期化します。');
      resetAllFlags();
      observersInitialized = false;
      scheduleInit();
    } else if (uiExists) {
      // UIは存在するが、オプションを再読み込みして状態を同期
      await loadOptions();
      await refreshListingCountUI();
      console.log('✅ [Focus Recovery] オプションを再読み込みし、UIを同期しました');
    }
  } finally {
    focusRecoveryInProgress = false;
  }
});

// ページの可視性が変わった時の処理
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState === 'visible') {
    console.log('🔄 [Visibility] ページが可視状態になりました');

    // エクステンションコンテキストの有効性をチェック
    if (!isExtensionContextValid()) {
      console.log('⚠️ [Visibility] エクステンションコンテキストが無効です。リカバリーを試行します。');
      await attemptRecovery();
      return;
    }

    // オプションを再読み込み
    await loadOptions();
  }
});

/* ---------- Health Check ---------- */

// 定期的なヘルスチェック（30秒ごと）
let healthCheckInterval = null;

function startHealthCheck() {
  if (healthCheckInterval) return;

  healthCheckInterval = setInterval(async () => {
    try {
      // Listerページでない場合はスキップ
      if (!isListerRoute()) return;

      // エクステンションコンテキストの有効性をチェック
      if (!isExtensionContextValid()) {
        console.log('⚠️ [Health Check] エクステンションコンテキストが無効です');
        await attemptRecovery();
        return;
      }

      // UIが存在するかチェック
      const uiExists = document.querySelector('.lfp-asinbar');
      const titleEl = findTitleFieldSmart();

      if (!uiExists && titleEl) {
        // UIが消えている場合は再初期化
        console.log('⚠️ [Health Check] UIが消えています。再初期化します。');
        resetAllFlags();
        observersInitialized = false;
        scheduleInit();
      }
    } catch (err) {
      // Extension context invalidated エラーを捕捉
      if (err.message && (err.message.includes('Extension context invalidated') || err.message.includes('context_invalidated'))) {
        console.log('[LFP] ヘルスチェック中にコンテキスト無効化を検知。インターバルを停止します。');
        if (healthCheckInterval) {
          clearInterval(healthCheckInterval);
          healthCheckInterval = null;
        }
      } else {
        console.error('[LFP] Health Check Error:', err);
      }
    }
  }, 5000); // 5秒ごと（ログイン後の遜移にも素早く対応）
}

// ヘルスチェックを開始
startHealthCheck();

/* ---------- Listerページ出現監視 ---------- */

/**
 * body全体のDOM変更を監視し、ASIN入力欄が出現したらUIを再構築。
 * ログイン/ログアウト、アカウント切り替え、メニュー遜移など、
 * hashchangeでは捕捉できないSPA内の画面切り替えを検知するための最終防衛線。
 */
let listerPageCheckTimer = null;

function setupListerPageDetection() {
  if (listerPageObserver) return; // 既にセットアップ済み

  listerPageObserver = new MutationObserver(() => {
    // デバウンス：短時間に何度も呼ばれるので300msごとに刻む
    if (listerPageCheckTimer) return;
    listerPageCheckTimer = setTimeout(() => {
      listerPageCheckTimer = null;
      checkListerPageAppeared();
    }, 300);
  });

  const container = document.body;
  listerPageObserver.observe(container, {
    childList: true,
    subtree: true
  });

  console.log('🔍 [LFP] Listerページ出現監視を開始しました');
}

function checkListerPageAppeared() {
  // Listerページでない場合はスキップ
  if (!isListerRoute()) return;

  // ASIN入力欄が存在するか？
  const asinInput = findAsinInputSmart();
  if (!asinInput) return;

  // 既にUIが表示されているなら何もしない
  const uiExists = UI.asinBar && UI.asinBar.isConnected;
  if (uiExists) return;

  // ASIN入力欄があるのにUIがない → 再初期化が必要
  console.log('🔄 [LFP] Listerページが検出されましたがUIがありません。再初期化します。');
  resetAllFlags();
  observersInitialized = false;
  scheduleInit(100); // 即座に近いタイミングで初期化
}

// Listerページ出現監視を開始
setupListerPageDetection();

/**
 * イベント委譲によるグローバルイベントリスナーのセットアップ
 * SPAによる要素の破壊・再生成に影響されない堅牢な監視
 */
function setupGlobalEventListeners() {
  // すでに登録済みの場合はスキップ
  if (document.documentElement.dataset.lfpWired === "1") return;
  document.documentElement.dataset.lfpWired = "1";

  // キャプチャリングフェーズで監視することで、他スクリプトの stopPropagation による影響を最小限に抑える
  document.addEventListener("click", async (e) => {
    // 1. Get Itemボタンのクリック監視
    const btnGet = findButtonByText(/^Get Item$/i);
    if (e.target.closest("button, a") && btnGet && (e.target === btnGet || btnGet.contains(e.target))) {
      handleGetItemClick();
      return;
    }

    // 2. リアルMIPボタン（Yaballe本来の出品ボタン）のクリック監視
    const realMip = findRealMipButton();
    if (realMip && (e.target === realMip || realMip.contains(e.target))) {
      console.log("🎯 [LFP] リアルMIPボタンのクリックを検知。状態を同期します。");
      STORE.turboExecuted.mip = true;
      if (UI.btnOpt) UI.btnOpt.disabled = true;
      setBusy(false); // 表示を強制リセット
    }
  }, true);

  document.addEventListener("focusin", (e) => {
    const asinInput = findAsinInputSmart();
    if (asinInput && (e.target === asinInput || asinInput.contains(e.target))) {
      if (!UI.asinBar || !UI.asinBar.isConnected) {
        console.log('🎯 [LFP] ASIN入力欄のフォーカスを検知（Delegation）。UIを復旧します。');
        scheduleInit();
      }
    }
  }, true);

  document.addEventListener("paste", async (e) => {
    const asinInput = findAsinInputSmart();
    if (asinInput && (e.target === asinInput || asinInput.contains(e.target))) {
      // ペースト後の値を取得するため少しまつ
      if (!STORE.opt.autoGetOnPaste) return;
      const t = now();
      if (t - lastPasteAt < 800) return;
      lastPasteAt = t;

      await onAsinInput();
      lockUI();
      await sleep(100); // 貼り付け完了を待つ
      const btnGet = findButtonByText(/^Get Item$/i);
      btnGet?.click();
    }
  }, true);

  // ASIN入力欄のinputイベント: 手動入力・修正でASIN形式が完成したら自動Get Item
  let asinInputDebounceTimer = null;

  document.addEventListener("input", async (e) => {
    const asinInput = findAsinInputSmart();
    if (asinInput && (e.target === asinInput || asinInput.contains(e.target))) {
      await onAsinInput();

      // autoGetOnPasteがONの場合、ASIN形式が完成したら自動Get Item
      if (!STORE.opt.autoGetOnPaste) return;

      // ペーストイベントと重複しないようにガード（ペースト直後800ms以内はスキップ）
      if (now() - lastPasteAt < 800) return;

      // デバウンス: 500ms待って入力が安定してから判定
      if (asinInputDebounceTimer) clearTimeout(asinInputDebounceTimer);
      asinInputDebounceTimer = setTimeout(() => {
        const val = normSpace(asinInput.value || "");
        // B0で始まる10桁の英数字かチェック
        if (/^B0[A-Z0-9]{8}$/i.test(val)) {
          console.log(`🚀 [LFP] ASIN形式検出、自動Get Itemを実行: ${val}`);
          lockUI();
          const btnGet = findButtonByText(/^Get Item$/i);
          btnGet?.click();
        }
      }, 500);
    }
  }, true);

  console.log('🛠️ [LFP] イベント委譲リスナーをセットアップしました');
}

/**
 * Get Itemクリック時の統合処理
 */
async function handleGetItemClick() {
  // FreeプランでもGet Itemは無制限（最適化のみに制限をかける）

  const btnGet = findButtonByText(/^Get Item$/i);
  const asinInput = findAsinInputSmart(btnGet);

  // 前回の判定結果が残らないように毎回リセット
  resetUIState();

  // 前回のタイトルを記録（画面更新検出用）
  let t = findTitleFieldSmart();
  if (t) {
    STORE.lastTitle = normSpace(readText(t));
  }

  // 最後にリクエストしたASINを記録
  const asin = normSpace(asinInput?.value || "");
  if (asin) {
    // ASINが新しくなった場合のみ、ボタンクリック履歴をリセット（同一ASIN内での二重動作を防止）
    if (STORE.lastRequestedAsin !== asin) {
      okButtonClicked = false;
      listingCounted = false;
    }
    STORE.lastRequestedAsin = asin;
    STORE.turboExecuted.optimizeCount = 0;
    STORE.turboExecuted.mip = false;
    STORE.optimizeState.lastOutputs = [];  // 新しいASINでは出力履歴をリセット
    await saveHistoryPush(asin);
    await updateHistoryFlags(asin, {
      protected: false,
      brand: false,
      already_listed: false,
      no_listings: false
    });
    await refreshHistorySelect(true);
  }
}



/* ========== 作業時間計測 / 統計ポップアップは worktime.js に分離済み ========== */
