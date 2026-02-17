/* ListerFlow Pro for Yaballe (MV3 content script)
   修正点
   ・UIはTitle入力欄の下に配置
   ・Get ItemでTitleが表示された時のみUI表示（初期/リフレッシュ時は非表示）
   ・MutationObserverはデバウンス＋自前UI無視
   ・Quick MIPはオプションONかつ条件OK時のみ表示
*/

const STORE = {
  opt: {
    apiKey: "",
    model: "gpt-4o-mini",
    veroEnabled: true,
    autoGetOnPaste: true,
    autoGetOnHistory: true,
    autoMipAfterOptimize: false,
    quickMipButton: true,  // デフォルトをtrueに変更（options.jsと同期）
    highlightOptimize: true,
    historyEnabled: true,
    // MIP後にOKボタン自動クリック
    autoClickOkAfterMip: true,
    turboListingMode: false
  },
  // 最適化状態の追跡
  optimizeState: {
    needsRetry: false,  // trueの時「再実行」表示
    lastOutputs: []     // 過去の最適化出力を記憶（同一タイトル生成防止用、最大5件）
  },
  // 最後にリクエストしたASIN（No listingsモーダル検出用）
  lastRequestedAsin: "",
  // ターボモードの実行済みフラグ
  turboExecuted: {
    optimizeCount: 0,  // 最適化実行回数（最大3回まで自動リトライ）
    mip: false
  },
  // エラーハンドリング（掃討モード用）
  errorHandling: {
    lastAsin: "",
    timestamp: 0,
    cleanerInterval: null
  }
};

// Observer管理用のグローバル変数
let mainObserver = null;
let noListingsObserver = null;
let listingSuccessObserver = null;
let urlChangeObserver = null;
let observersInitialized = false;

// イベントリスナー管理用（メモリリーク防止）
let dropdownClickHandler = null;
let dropdownMousedownHandler = null;

// setInterval管理用（クリーンアップ用）
let okButtonCheckInterval = null;

// 履歴操作のロック（競合状況防止）
let historyLock = false;

/* ---------- Utilities ---------- */

/**
 * 監視対象となるメインコンテンツコンテナを特定する
 * 適切なコンテナが見つからない場合は document.body を返す
 */
function getContentContainer() {
  // Yaballeの構成に応じた主要なコンテナセレクタ
  const selectors = [
    'ui-view',           // Angular UI-Router (Yaballeでよく使われる)
    '[ui-view]',
    'md-content',        // Angular Material
    '.md-content',
    '#main-wrapper',
    'main',
    'div[role="main"]',
    '.main-content',
    '.content-wrapper',
    'section#content',
    '#inner-content',
    '[ng-view]'          // Angular standard router
  ];

  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el && el.isConnected) return el;
  }

  // フォールバック
  return document.body;
}

/**
 * モーダル等のオーバーレイが表示されるコンテナを特定する
 * Angular Materialではbody直下の .cdk-overlay-container に配置されることが多い
 */
function getOverlayContainer() {
  return document.querySelector('.cdk-overlay-container') || document.body;
}

function isListerRoute() {
  const hash = (location.hash || "").toLowerCase();
  return hash.includes("autolister") || hash.includes("add-items");
}

// 出品自動化およびOKボタン自動クリックの実行判定フラグ（ファイル全体で共有し、ASIN変更時のみリセット）
let okButtonClicked = false;
let listingCounted = false;

/**
 * カスタム確認モーダルを表示する（ブラウザ標準のconfirm()の代替）
 * 中央からポンと出現するアニメーション付き
 * @param {string} message - 確認メッセージ
 * @param {string} [title] - モーダルのタイトル（省略時は"確認"）
 * @returns {Promise<boolean>} ユーザーの選択結果
 */
function showLfpConfirm(message, title = '確認') {
  return new Promise((resolve) => {
    // 既存のオーバーレイがあれば削除
    const existing = document.querySelector('.lfp-confirm-overlay');
    if (existing) existing.remove();

    // オーバーレイを作成
    const overlay = document.createElement('div');
    overlay.className = 'lfp-confirm-overlay';

    // ダイアログ本体
    const dialog = document.createElement('div');
    dialog.className = 'lfp-confirm-dialog';

    // ヘッダー
    const header = document.createElement('div');
    header.className = 'lfp-confirm-header';
    const h3 = document.createElement('h3');
    h3.textContent = title;
    header.appendChild(h3);

    // ボディ
    const body = document.createElement('div');
    body.className = 'lfp-confirm-body';
    const p = document.createElement('p');
    p.textContent = message;
    body.appendChild(p);

    // フッター（ボタン）
    const footer = document.createElement('div');
    footer.className = 'lfp-confirm-footer';

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'lfp-confirm-btn cancel';
    cancelBtn.textContent = 'キャンセル';

    const okBtn = document.createElement('button');
    okBtn.className = 'lfp-confirm-btn ok';
    okBtn.textContent = 'OK';

    footer.appendChild(cancelBtn);
    footer.appendChild(okBtn);

    dialog.appendChild(header);
    dialog.appendChild(body);
    dialog.appendChild(footer);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    // モーダルを閉じる共通処理
    const close = (result) => {
      overlay.style.opacity = '0';
      dialog.style.transform = 'scale(0.9)';
      dialog.style.opacity = '0';
      dialog.style.transition = 'all 0.12s ease-in';
      setTimeout(() => {
        overlay.remove();
        resolve(result);
      }, 120);
    };

    // 表示アニメーション（次フレームでactiveクラスを付与）
    requestAnimationFrame(() => {
      overlay.classList.add('active');
    });

    cancelBtn.addEventListener('click', () => close(false));
    okBtn.addEventListener('click', () => close(true));

    // オーバーレイクリックでキャンセル
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close(false);
    });
  });
}

/**
 * カスタム通知モーダルを表示する（ブラウザ標準のalert()の代替）
 * 中央からポンと出現するアニメーション付き
 * @param {string} message - 通知メッセージ
 * @param {string} [title] - モーダルのタイトル（省略時は"お知らせ"）
 * @returns {Promise<void>} OKボタンが押されたら解決
 */
function showLfpAlert(message, title = 'お知らせ') {
  return new Promise((resolve) => {
    // 既存のオーバーレイがあれば削除
    const existing = document.querySelector('.lfp-confirm-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.className = 'lfp-confirm-overlay';

    const dialog = document.createElement('div');
    dialog.className = 'lfp-confirm-dialog';

    const header = document.createElement('div');
    header.className = 'lfp-confirm-header';
    const h3 = document.createElement('h3');
    h3.textContent = title;
    header.appendChild(h3);

    const body = document.createElement('div');
    body.className = 'lfp-confirm-body';
    const p = document.createElement('p');
    p.textContent = message;
    body.appendChild(p);

    const footer = document.createElement('div');
    footer.className = 'lfp-confirm-footer';

    const okBtn = document.createElement('button');
    okBtn.className = 'lfp-confirm-btn ok';
    okBtn.style.borderRight = 'none';
    okBtn.textContent = 'OK';
    footer.appendChild(okBtn);

    dialog.appendChild(header);
    dialog.appendChild(body);
    dialog.appendChild(footer);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    const close = () => {
      overlay.style.opacity = '0';
      dialog.style.transform = 'scale(0.9)';
      dialog.style.opacity = '0';
      dialog.style.transition = 'all 0.12s ease-in';
      setTimeout(() => {
        overlay.remove();
        resolve();
      }, 120);
    };

    requestAnimationFrame(() => {
      overlay.classList.add('active');
    });

    okBtn.addEventListener('click', close);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });
  });
}

// エクステンションコンテキストの有効性チェック
function isExtensionContextValid() {
  try {
    // chrome.runtime.idが存在し、chrome.storageにアクセスできるかチェック
    return !!(chrome && chrome.runtime && chrome.runtime.id && chrome.storage && chrome.storage.sync);
  } catch (e) {
    return false;
  }
}

// エクステンションコンテキスト無効時のリカバリー処理
let recoveryAttempts = 0;
const MAX_RECOVERY_ATTEMPTS = 3;

async function attemptRecovery() {
  if (recoveryAttempts >= MAX_RECOVERY_ATTEMPTS) {
    console.log("[LFP] リカバリー試行回数上限に達しました。ページをリロードしてください。");
    return false;
  }

  recoveryAttempts++;
  console.log(`[LFP] リカバリー試行 ${recoveryAttempts}/${MAX_RECOVERY_ATTEMPTS}`);

  // 全てのフラグをリセット
  resetAllFlags();

  // Observerを再初期化
  observersInitialized = false;

  // 少し待ってから再初期化
  await sleep(500);

  if (isExtensionContextValid()) {
    console.log("[LFP] エクステンションコンテキストが復活しました");
    recoveryAttempts = 0;
    scheduleInit();
    return true;
  }

  return false;
}

// 全ての実行フラグをリセット
function resetAllFlags() {
  evalRunning = false;
  initRunning = false;
  optimizeRunning = false;
  historyLock = false;
  // okButtonClicked = false; // ASIN変更時以外はリセットしない（二重表示防止）

  // setIntervalをクリア
  if (okButtonCheckInterval) {
    clearInterval(okButtonCheckInterval);
    okButtonCheckInterval = null;
  }

  // 掃討モード終了
  stopAggressiveCleaner();

  console.log("[LFP] 内部フラグをリセットしました（オートメーション記憶は維持）");
}

const KEY_OPT = "lfp_options_v1";
const KEY_HIST = "lfp_asin_history_v1";


function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function normSpace(s) { return (s || "").replace(/\s+/g, " ").trim(); }
function lc(s) { return (s || "").toLowerCase(); }
function now() { return Date.now(); }
function isListerRoute() {
  const hash = (location.hash || "").toLowerCase();
  return hash.includes("autolister") || hash.includes("add-items");
}

/* ---------- Options / History ---------- */

async function loadOptions() {
  // エクステンションコンテキストの有効性をチェック
  if (!isExtensionContextValid()) {
    console.log("[LFP] エクステンションコンテキストが無効です。デフォルト設定を使用します。");
    return;
  }

  try {
    const data = await chrome.storage.sync.get([KEY_OPT]);
    const saved = data?.[KEY_OPT];
    if (saved && typeof saved === "object") STORE.opt = { ...STORE.opt, ...saved };
  } catch (err) {
    // エラーメッセージのチェックをより堅牢に
    const errMsg = err.message || "";
    if (errMsg.includes("Extension context invalidated") || errMsg.includes("context_invalidated")) {
      console.log("[LFP] Extension context invalidated 検出。リカバリーを試行します。");
      attemptRecovery();
    } else {
      console.error("[LFP] loadOptions error:", err);
    }
  }
}

// 設定変更をリッスンしてUIを更新
if (isExtensionContextValid()) {
  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'sync' && changes[KEY_OPT]) {
      const newOptions = changes[KEY_OPT].newValue;
      if (newOptions) {
        STORE.opt = { ...STORE.opt, ...newOptions };
        console.log('[LFP] 設定が更新されました:', STORE.opt);
        // ここでUIの更新処理を呼び出す
        updateUIBasedOnSettings();
      }
    }

    // 統計リセットの指示を受け取る
    if (changes[KEY_HIST] && !changes[KEY_HIST].newValue) {
      console.log('[LFP] 履歴がリセットされました');
      refreshHistorySelect(true).catch(() => { });
    }
  });
}

// バックグラウンドからのメッセージを処理
if (isExtensionContextValid()) {
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'LFP_RESET_UI') {
      console.log('[LFP] UIリセット指示を受信');
      refreshListingCountUI().catch(() => { });
      refreshHistorySelect(true).catch(() => { });
      return true;
    }
    // バックグラウンドからの同期放送を受信
    if (msg.type === 'LFP_SYNC_UI') {
      refreshListingCountUI().catch(() => { });
      return true;
    }
  });
}

async function updateUIBasedOnSettings() {
  // Quick MIPボタンの表示/非表示（設定変更時のみ）
  const quickMipBtn = document.getElementById("lfp-quick-mip");
  if (quickMipBtn) {
    quickMipBtn.style.display = STORE.opt.quickMipButton ? "inline-flex" : "none";
  }

  // 最適化ボタンのハイライト表示
  const optimizeBtn = document.getElementById("optimize-button");
  if (optimizeBtn) {
    if (STORE.opt.highlightOptimize) {
      optimizeBtn.classList.add("highlight");
    } else {
      optimizeBtn.classList.remove("highlight");
    }
  }
  // 他のUI要素も必要に応じて更新
}

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
        // 必要に応じてユーザーに通知するロジックを追加することも可能
        // chrome.runtime.sendMessage({ type: "LFP_STORAGE_WARNING", message: "ASIN履歴が肥大化しています。" });
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

/* ---------- DOM helpers ---------- */

function findButtonByText(re) {
  const btns = Array.from(document.querySelectorAll("button, a"));
  return btns.find(b => re.test(normSpace(b.textContent || ""))) || null;
}

function findInputNearButton(btn) {
  if (!btn) return null;
  const root = btn.closest("form, .row, .col, .panel, .card, .container, .form-group") || btn.parentElement;
  if (!root) return null;
  const inputs = Array.from(root.querySelectorAll("input[type='text'], input:not([type]), textarea"));
  if (inputs.length === 1) return inputs[0];
  inputs.sort((a, b) => (a.value || "").length - (b.value || "").length);
  return inputs[0] || null;
}

function findAsinInputSmart(btnGet) {
  const cands = Array.from(document.querySelectorAll("input, textarea"))
    .filter(el => el && el.offsetParent !== null && !el.disabled);

  const hit = cands.find(el => {
    const attrs = [
      el.getAttribute("placeholder") || "",
      el.getAttribute("aria-label") || "",
      el.name || "",
      el.id || "",
      el.getAttribute("data-testid") || ""
    ].join(" ");
    return /asin/i.test(attrs) || /amazon/i.test(attrs) || /ＡＳＩＮ/.test(attrs);
  });

  return hit || findInputNearButton(btnGet);
}

function findLabelInput(labelRe) {
  const labels = Array.from(document.querySelectorAll("label, span, div"));
  const lab = labels.find(el => labelRe.test(normSpace(el.textContent || "")));
  if (!lab) return null;

  const root = lab.closest(".form-group, .row, .col, .panel, .card, form, div") || lab.parentElement;
  if (!root) return null;

  const cands = Array.from(root.querySelectorAll("input[type='text'], input:not([type]), textarea, [contenteditable='true']"))
    .filter(x => x && x.offsetParent !== null && !x.disabled);

  const inp = cands.find(x => x.tagName === "INPUT" || x.tagName === "TEXTAREA") || cands[0] || null;
  return inp;
}

function findTitleFieldSmart(ignoreVisibility = false) {
  let el = findLabelInput(/^(Title|Item Title|タイトル|商品タイトル)$/i);
  if (el) return el;

  const cands = Array.from(document.querySelectorAll("input[type='text'], textarea, [contenteditable='true']"))
    .filter(x => x && (ignoreVisibility || x.offsetParent !== null) && !x.disabled);

  let best = null;
  let bestScore = -1;

  for (const x of cands) {
    const attrs = [
      x.getAttribute("placeholder") || "",
      x.getAttribute("aria-label") || "",
      x.getAttribute("name") || "",
      x.getAttribute("id") || "",
      x.getAttribute("ng-model") || "",
      x.getAttribute("data-testid") || ""
    ].join(" ");

    let score = 0;
    if (/title/i.test(attrs)) score += 6;
    if (/item\s*title/i.test(attrs)) score += 2;
    if (/タイトル/.test(attrs)) score += 7;
    if (x.tagName === "TEXTAREA") score += 1;

    const val = readText(x);
    if (val && val.length >= 10) score += 1;

    if (score > bestScore) { bestScore = score; best = x; }
  }

  if (best && bestScore >= 6) return best;

  el = document.querySelector("input[ng-model*='title'], textarea[ng-model*='title'], div[contenteditable='true'][ng-model*='title']");
  return el || null;
}

function readText(el) {
  if (!el) return "";
  if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") return el.value || "";
  return el.innerText || el.textContent || "";
}

function setNativeValue(el, v) {
  try {
    const value = v ?? "";
    const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, "value");
    const setter = desc && desc.set;
    if (setter) setter.call(el, value);
    else el.value = value;
  } catch (_) {
    try { el.value = v ?? ""; } catch (__) { }
  }
}

function setInputValue(el, value) {
  if (!el) return;
  const v = value ?? "";
  if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
    el.focus({ preventScroll: true });  // スクロールを防止
    setNativeValue(el, v);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.blur();
  } else if (el.getAttribute("contenteditable") === "true") {
    el.focus({ preventScroll: true });  // スクロールを防止
    document.execCommand("selectAll", false, null);
    document.execCommand("insertText", false, v);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.blur();
  }
}

function isInsideLfp(node) {
  const el = (node && node.nodeType === 1) ? node : (node && node.parentElement) ? node.parentElement : null;
  if (!el) return false;
  return !!el.closest("#lfp-root, #lfp-asinbar, #lfp-quick-mip, #lfp-status-box");
}

/* ---------- Insert below Title ---------- */

function insertBeforeVeroWarnings(statusBox) {
  // div.asin-actionsを直接探す（Get Itemボタンを含む親コンテナ）
  const asinActions = document.querySelector('div.asin-actions');

  if (!asinActions) {
    console.warn('[ListerFlow Pro] div.asin-actions not found, appending to body');
    document.body.appendChild(statusBox);
    return;
  }

  // asin-actionsの次の兄弟要素を取得
  const nextSibling = asinActions.nextElementSibling;

  if (nextSibling) {
    // asin-actionsの直後に挿入（Get Itemボタンのすぐ下）
    asinActions.parentElement.insertBefore(statusBox, nextSibling);
  } else {
    // 次の兄弟がない場合はasin-actionsの直後に追加
    asinActions.parentElement.appendChild(statusBox);
  }
}

function insertBelowTitle(titleEl, root) {
  const container =
    titleEl.closest(".form-group, .form-row, .row, .field, .form-item, .ng-scope, .col, .card, .panel") ||
    titleEl.closest("div") ||
    titleEl.parentElement;

  if (container && container.parentElement) {
    if (container.nextSibling) container.parentElement.insertBefore(root, container.nextSibling);
    else container.parentElement.appendChild(root);
    return;
  }
  titleEl.parentElement?.appendChild(root);
}

/* ---------- Vero / protected / brand / adult ---------- */

function extractWarningBlockText() {
  const nodes = Array.from(document.querySelectorAll("div, pre, span, p"))
    .filter(n => (n.textContent || "").includes("Vero Warnings:"));
  if (nodes.length) {
    nodes.sort((a, b) => (b.textContent || "").length - (a.textContent || "").length);
    return nodes[0].textContent || "";
  }
  const all = document.body?.innerText || "";
  const idx = all.indexOf("Vero Warnings:");
  if (idx >= 0) return all.slice(idx, idx + 800);
  return "";
}

function extractProtectedText() {
  let all = document.body?.innerText || "";

  try {
    // 自前UIの文言が残っていると自己検出してしまうので除外
    const uiTexts = [];
    if (typeof UI !== "undefined") {
      if (UI?.root?.isConnected) uiTexts.push(UI.root.innerText || "");
      if (UI?.asinBar?.isConnected) uiTexts.push(UI.asinBar.innerText || "");
      if (UI?.quickMipBtn?.isConnected) uiTexts.push(UI.quickMipBtn.innerText || "");
    }
    for (const t of uiTexts) {
      if (t && t.length) all = all.split(t).join(" ");
    }

    // 文字列ベースでも除外（揺れ対策）
    all = all.replace(/×出品不可：[^\n]+/g, " ");
    all = all.replace(/出品：NG\([^\)]+\)/g, " ");
    all = all.replace(/NG\([^\)]+\)/g, " ");
    all = all.replace(/\blfp\b/ig, " ");
  } catch (_) {
  }

  if (/protected mode/i.test(all) || /\bprotected\b/i.test(all)) {
    const m = all.match(/.{0,40}protected.{0,200}/i);
    return m ? m[0] : "protected";
  }
  return "";
}

function extractDuplicationError() {
  let all = document.body?.innerText || "";

  try {
    // 自前UIの文言が残っていると自己検出してしまうので除外
    const uiTexts = [];
    if (typeof UI !== "undefined") {
      if (UI?.root?.isConnected) uiTexts.push(UI.root.innerText || "");
      if (UI?.asinBar?.isConnected) uiTexts.push(UI.asinBar.innerText || "");
      if (UI?.quickMipBtn?.isConnected) uiTexts.push(UI.quickMipBtn.innerText || "");
    }
    for (const t of uiTexts) {
      if (t && t.length) all = all.split(t).join(" ");
    }

    // 文字列ベースでも除外（揺れ対策）
    all = all.replace(/×出品不可：[^\n]+/g, " ");
    all = all.replace(/出品：NG\([^\)]+\)/g, " ");
    all = all.replace(/NG\([^\)]+\)/g, " ");
    all = all.replace(/\blfp\b/ig, " ");
  } catch (_) {
  }

  if (/SourceID already monitored/i.test(all) || /Duplications are not possible/i.test(all)) {
    const m = all.match(/.{0,40}(SourceID already monitored|Duplications are not possible).{0,200}/i);
    return m ? m[0] : "SourceID already monitored";
  }
  return "";
}

function parseVeroTerms(blockText) {
  const text = blockText || "";
  const lines = text.split("\n").map(x => x.trim()).filter(Boolean);
  const terms = [];
  for (const line of lines) {
    const m = line.match(/^(title|brand)\s*:\s*(.+)$/i);
    if (m) {
      const kind = lc(m[1]);
      const term = normSpace(m[2]);
      if (term) terms.push({ kind, term });
    }
  }
  return terms;
}

function buildVeroMatchers(terms) {
  return terms.map(t => {
    const term = normSpace(t.term);
    const isPhrase = /\s/.test(term);
    const esc = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    let reCount;
    let reRemove;

    if (isPhrase) {
      // フレーズ型：連続した並びで出現した場合のみ検出
      // ハイフン等の軽い区切りを許容（例: zodiac-blade survival）
      const parts = esc.split(/\s+/).join("[\\s\\-]+");
      reCount = new RegExp(parts, "ig");
      reRemove = new RegExp(parts, "ig");
    } else {
      // 単語型：case-insensitive + 語尾変化対応
      if (term.length <= 3) {
        // 短い単語は完全一致のみ
        reCount = new RegExp(`\\b${esc}\\b`, "ig");
        reRemove = new RegExp(`\\b${esc}\\b`, "ig");
      } else {
        // 長い単語は語尾変化を許容（dove/doves等）
        reCount = new RegExp(`\\b${esc}\\w*\\b`, "ig");
        reRemove = new RegExp(`\\b${esc}\\w*\\b`, "ig");
      }
    }
    return { reCount, reRemove };
  });
}

function countVeroInText(text, matchers) {
  const s = text || "";
  let count = 0;
  for (const m of matchers) {
    const hits = s.match(m.reCount);
    if (hits && hits.length) count += 1;
  }
  return count;
}

function removeVeroFromTitle(title, matchers) {
  let t = title || "";
  for (const m of matchers) t = t.replace(m.reRemove, " ");
  t = t.replace(/[|]+/g, " ");
  t = t.replace(/\s+/g, " ").trim();
  t = t.replace(/\s+([,.;:!?])/g, "$1");
  t = t.replace(/([,.;:!?])([A-Za-z0-9])/g, "$1 $2");
  t = t.replace(/\s+/g, " ").trim();
  return t;
}

/* ローカル事前短縮関数（80文字超の時のみ適用） */
function localShortenTitle(title) {
  const originalLen = (title || "").length;

  // 80文字以下の場合は短縮不要
  if (originalLen <= 80) return title;

  let t = title;

  // 1. with → w/ (大小文字無視)
  t = t.replace(/\bwith\b/gi, "w/");

  // 2. 単独語 for を削除（before等は残す）
  t = t.replace(/\s+\bfor\b\s+/gi, " ");

  // 3. 省略辞書（安全に短縮できる範囲のみ）
  // inches/inch → in（数字に続く場合のみ）
  t = t.replace(/(\d+\.?\d*)\s*(inches|inch)\b/gi, "$1 in");

  // pounds/lbs → lb
  t = t.replace(/\b(pounds|lbs)\b/gi, "lb");

  // ounce/ounces → oz（fl ozは維持）
  t = t.replace(/\b(?<!fl\s)(ounces|ounce)\b/gi, "oz");

  // millimeter → mm、centimeter → cm（数字に続く場合のみ）
  t = t.replace(/(\d+\.?\d*)\s*millimeters?\b/gi, "$1 mm");
  t = t.replace(/(\d+\.?\d*)\s*centimeters?\b/gi, "$1 cm");

  // set of → set
  t = t.replace(/\bset\s+of\b/gi, "set");

  // pack of → pk（タイトル長次第でpk優先）
  if (t.length > 85) {
    t = t.replace(/\bpack\s+of\b/gi, "pk");
  } else {
    t = t.replace(/\bpack\s+of\b/gi, "pack");
  }

  // 4. 品番が複数なら1つ減らす（モデル番号っぽいトークン判定）
  const modelNumberPattern = /\b[A-Z0-9][\w\-\/]{3,}\b/g;
  const modelNumbers = t.match(modelNumberPattern);
  if (modelNumbers && modelNumbers.length > 1) {
    // 最後の品番を削除
    const lastModel = modelNumbers[modelNumbers.length - 1];
    const lastIndex = t.lastIndexOf(lastModel);
    t = t.substring(0, lastIndex) + t.substring(lastIndex + lastModel.length);
  }

  // 5. 不要空白/記号周り整形
  t = t.replace(/\s+/g, " ").trim();
  t = t.replace(/\s+([,.;:!?])/g, "$1");
  t = t.replace(/([,.;:!?])([A-Za-z0-9])/g, "$1 $2");
  t = t.replace(/\s+/g, " ").trim();

  // 自然で読みやすい構文を維持（不自然な詰め込み禁止）
  // 極端に短くなりすぎた場合は元に戻す
  if (t.length < 50 && originalLen > 70) {
    return title;  // 短縮しすぎた場合は元のタイトルを返す
  }

  return t;
}

/* ターゲット文字数判定関数 */
function determineTargetLength(title) {
  const len = (title || "").length;

  // 基本ターゲットは78文字
  let target = 78;

  // 条件1: 入力タイトルが78文字以上
  if (len >= 78) {
    target = 75;
    return target;
  }

  // 条件2: 品番っぽいトークンが3個以上（英数字4文字以上かつ数字を含むトークン）
  const modelPattern = /\b[A-Za-z0-9]*\d+[A-Za-z0-9]{3,}\b/g;
  const models = (title || "").match(modelPattern) || [];
  if (models.length >= 3) {
    target = 75;
    return target;
  }

  // 条件3: 寸法・規格トークンが多い（in, mm, cm, lb, oz, V, W, Ah, mAh, rpm, psi, NPT, M6等が合計3個以上）
  const unitPattern = /\b(in|mm|cm|lb|oz|V|W|Ah|mAh|rpm|psi|NPT|M\d+)\b/gi;
  const units = (title || "").match(unitPattern) || [];
  if (units.length >= 3) {
    target = 75;
    return target;
  }

  return target;
}

function detectAdultGoods(descText) {
  const d = lc(descText || "");
  if (!d) return false;
  const kws = [
    "dildo", "vibrator", "sex toy", "adult toy", "masturbat", "bdsm",
    "anal", "butt plug", "penis", "vagina", "clitoris", "fetish",
    "vibrating", "love toy"
  ];
  return kws.some(k => d.includes(k));
}

function computeShipReasons({ blockText, protectedText, descText, duplicationError }) {
  const reasons = [];
  if (protectedText) reasons.push("protected");
  if (duplicationError) reasons.push("already listed");
  const terms = parseVeroTerms(blockText);
  if (terms.some(x => x.kind === "brand")) reasons.push("brand");
  if (detectAdultGoods(descText)) reasons.push("adult goods");
  return Array.from(new Set(reasons));
}

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

/* ---------- OpenAI ---------- */

async function callOpenAI({ apiKey, model, messages }, retryCount = 0) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: "LFP_OPENAI", messages }, async (res) => {
      if (chrome.runtime.lastError) {
        // ネットワークエラー等の場合は1回だけリトライ
        if (retryCount === 0) {
          console.log("⚠️ [LFP] API呼び出し失敗。リトライします...", chrome.runtime.lastError.message);
          await sleep(1000);
          try {
            const retryRes = await callOpenAI({ apiKey, model, messages }, retryCount + 1);
            return resolve(retryRes);
          } catch (e) {
            return reject(e);
          }
        }
        return reject(new Error(chrome.runtime.lastError.message));
      }

      if (res && res.ok) {
        resolve(res.text);
      } else {
        // 5xx系やタイムアウト等の場合もリトライ検討（SW側で制御されている場合を想定）
        const isTransient = res?.error?.includes("timeout") || res?.error?.includes("500") || res?.error?.includes("fetch");
        if (isTransient && retryCount === 0) {
          console.log("⚠️ [LFP] API一時的エラー。リトライします...", res.error);
          await sleep(1000);
          try {
            const retryRes = await callOpenAI({ apiKey, model, messages }, retryCount + 1);
            return resolve(retryRes);
          } catch (e) {
            return reject(e);
          }
        }
        reject(new Error(res?.error || "OpenAI呼び出しに失敗しました"));
      }
    });
  });
}

function buildOptimizePrompt({ title, desc, forbiddenTerms, targetLen, tryNum, prevOutput, prevLen, rejectedOutputs }) {
  const forb = forbiddenTerms.length ? forbiddenTerms.join(", ") : "(none)";

  let sys = [
    "You are a high-speed and high-accuracy eBay product title optimization engine.",
    "Return exactly ONE optimized English title only (single line).",
    `Target length: ${targetLen} characters (must be 70–80 characters inclusive).`,
    "SEO-first, buyer-oriented, concise, natural phrasing.",
    "No brand names unless explicitly present in the input title/description.",
    "Avoid claims: genuine, official, certified, OEM, warranty.",
    "Never include any extra lines, counts, labels, quotes, or punctuation-only output.",
    `CRITICAL: Forbidden terms (must NEVER appear in ANY form, case-insensitive): ${forb}`,
    "If any forbidden term appears in the input, REMOVE it completely from the output.",
    "If you detect a forbidden term might appear, remove it and optimize naturally.",
    "Double-check your output: scan every word to ensure NO forbidden term is present."
  ];

  // 過去に却下されたタイトルがある場合、異なるタイトル生成を強制
  if (rejectedOutputs && rejectedOutputs.length > 0) {
    sys.push("IMPORTANT: The following titles have already been generated and REJECTED because they contained forbidden terms or were duplicates.");
    sys.push("You MUST output a COMPLETELY DIFFERENT title that avoids all forbidden terms:");
    rejectedOutputs.forEach((t, i) => sys.push(`  Rejected #${i + 1}: ${t}`));
    sys.push("Use different word choices, different structure, and different phrasing.");
  }

  let user = [];

  if (tryNum === 1) {
    // Try1: 通常最適化
    sys.push("If title is short, you may pull a few relevant words from the description to reach 70–80.");
    sys.push("If description is empty, use natural SEO keywords to supplement (no keyword stuffing, readability first).");
    user = [
      `INPUT TITLE:\n${title}`,
      `DESCRIPTION (may use to extend if needed):\n${desc || "(empty)"}`,
      "OUTPUT: one line title only."
    ];
  } else if (tryNum === 2) {
    // Try2: 前回結果を評価して分岐
    sys.push("IMPORTANT: You must output a DIFFERENT title from the previous attempt.");

    if (prevLen > 80) {
      // 長すぎる：削減指示
      sys.push(`Previous output was ${prevLen} chars (too long). You MUST shorten it by 2-6 characters.`);
      sys.push("凗長語削除、語順短縮、省略形、括弧整理、品番削減 to reach target.");
      user = [
        `PREVIOUS OUTPUT (${prevLen} chars, too long):\n${prevOutput}`,
        `DESCRIPTION:\n${desc || "(empty)"}`,
        `OUTPUT: Shortened version targeting ${targetLen} chars (70-80 range).`
      ];
    } else if (prevLen < 70) {
      // 短すぎる：補足指示
      sys.push(`Previous output was ${prevLen} chars (too short). You MUST extend it by 2-10 characters.`);
      sys.push("Pull relevant info from description, or add natural SEO keywords if description is empty.");
      user = [
        `PREVIOUS OUTPUT (${prevLen} chars, too short):\n${prevOutput}`,
        `DESCRIPTION:\n${desc || "(empty)"}`,
        `OUTPUT: Extended version targeting ${targetLen} chars (70-80 range).`
      ];
    } else {
      // 70〜80だが不自然：自然化指示
      sys.push(`Previous output was ${prevLen} chars (within range but may be unnatural).`);
      sys.push("キーワード詰め込み抑制、読みやすい構文 to improve readability.");
      user = [
        `PREVIOUS OUTPUT (${prevLen} chars):\n${prevOutput}`,
        `DESCRIPTION:\n${desc || "(empty)"}`,
        `OUTPUT: More natural version targeting ${targetLen} chars (70-80 range).`
      ];
    }
  } else if (tryNum === 3) {
    // Try3: 最終調整
    sys.push("FINAL ATTEMPT: You must output a DIFFERENT title from the previous two attempts.");

    if (prevLen > 80) {
      // さらに短縮
      sys.push(`Previous output was ${prevLen} chars (still too long). You MUST shorten it further.`);
      sys.push("必須語を残し、装飾語や重複表現を落とす、型番を最大2に制限.");
      user = [
        `PREVIOUS OUTPUT (${prevLen} chars, still too long):\n${prevOutput}`,
        `DESCRIPTION:\n${desc || "(empty)"}`,
        `OUTPUT: Final shortened version targeting ${targetLen} chars (70-80 range).`
      ];
    } else if (prevLen < 70) {
      // 最小限の補足
      sys.push(`Previous output was ${prevLen} chars (still too short). You MUST extend it minimally.`);
      sys.push("カテゴリ一般語を2語まで追加、自然文維持.");
      user = [
        `PREVIOUS OUTPUT (${prevLen} chars, still too short):\n${prevOutput}`,
        `DESCRIPTION:\n${desc || "(empty)"}`,
        `OUTPUT: Final extended version targeting ${targetLen} chars (70-80 range).`
      ];
    } else {
      // 70〜80だが再度不自然
      sys.push(`Previous output was ${prevLen} chars (within range but needs improvement).`);
      sys.push("Final polish: ensure natural flow, no keyword stuffing, buyer-friendly.");
      user = [
        `PREVIOUS OUTPUT (${prevLen} chars):\n${prevOutput}`,
        `DESCRIPTION:\n${desc || "(empty)"}`,
        `OUTPUT: Final polished version targeting ${targetLen} chars (70-80 range).`
      ];
    }
  }

  return { messages: [{ role: "system", content: sys.join("\n") }, { role: "user", content: user.join("\n\n") }] };
}

/* ---------- Evaluate / Optimize ---------- */

async function evaluateAndRender({ titleEl, btnGet }) {
  const modal = document.querySelector('.modal, [role="dialog"]');
  if (modal && !modal.dataset.lfpModal && modal.offsetParent !== null) {
    // 競合防止：ここでは判定のみを行い、自動クリック等の副作用はMutationObserver（setupListingSuccessObserver / setupNoListingsObserver）に任せる
    return;
  }

  const title = readText(titleEl);
  const len = (title || "").length;

  const block = extractWarningBlockText();
  const terms = parseVeroTerms(block);
  const titleTerms = terms.filter(t => t.kind === "title");
  const matchers = buildVeroMatchers(titleTerms);

  // 判定用のveroCount（従来通り）
  const veroCountForCheck = STORE.opt.veroEnabled ? countVeroInText(title, matchers) : 0;
  let veroCountForDisplay = veroCountForCheck;

  const descEl =
    findLabelInput(/^(Description|説明|商品説明)$/i) ||
    document.querySelector("textarea[ng-model*='description'], div[contenteditable='true'][ng-model*='description']") ||
    null;
  const descText = readText(descEl);

  const protectedText = extractProtectedText();
  const duplicationError = extractDuplicationError();
  const reasons = computeShipReasons({ blockText: block, protectedText, descText, duplicationError });

  if (reasons.length) setBadge(`×出品不可：${reasons.join(" / ")}`);
  else setBadge("");

  // title: のチェック（案7）
  let hasTitleVeroWarning = false;
  const fullText = block || "";
  const veroTitleMatch = fullText.match(/Vero Warnings:[\s\S]*?title:\s*(.+?)(?:\n|$)/i);
  if (veroTitleMatch) {
    const veroWords = veroTitleMatch[1].trim().split(/\s+/);
    const currentTitle = (title || "").toLowerCase();

    // title: 内の単語がタイトルに含まれている数をカウント（表示用）
    const titleVeroCount = veroWords.filter(word => {
      const esc = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const re = new RegExp(`\\b${esc}\\b`, "i");
      return re.test(currentTitle);
    }).length;

    veroCountForDisplay += titleVeroCount;  // 表示用のみ加算

    // すべてのVero単語がタイトルに「単語として」含まれているかチェック（判定用）
    const allVeroWordsPresent = veroWords.every(word => {
      const esc = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const re = new RegExp(`\\b${esc}\\b`, "i");
      return re.test(currentTitle);
    });

    // Yaballe公式ルール：「FOR」「COMPATIBLE WITH」「FITS」があれば許容
    const hasCompatibilityPhrase = /\b(for|compatible\s+with|fits)\b/i.test(currentTitle);

    if (allVeroWordsPresent) {
      // すべての単語が残っている場合
      if (hasCompatibilityPhrase) {
        // 互換性を示す言い回しがあればOK
        hasTitleVeroWarning = false;
        console.log(`✅ [Vero Title] 互換性表現あり。VeRO単語: ${veroWords.join(', ')}`);
      } else {
        // 互換性表現がなければNG
        hasTitleVeroWarning = true;
        console.log(`⚠️ [Vero Title] すべてのVero単語が残っており、互換性表現なし: ${veroWords.join(', ')}`);
      }
    } else {
      // 一部でも削除されていればOK
      const remainingWords = veroWords.filter(word => {
        const esc = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const re = new RegExp(`\\b${esc}\\b`, "i");
        return re.test(currentTitle);
      });
      hasTitleVeroWarning = false;
      console.log(`✅ [Vero Title] 最適化済み。残っている単語: ${remainingWords.join(', ')}`);
    }
  }

  let shipText = "-";
  let highlight = false;

  if (reasons.length) {
    shipText = `NG（${reasons.join(" / ")}）`;
  } else {
    // MIP実行済み（出品開始後）の場合は、強制的に「OK」として表示を安定させる
    if (STORE.turboExecuted.mip) {
      shipText = "OK";
      highlight = false;
    } else if (len >= 70 && len <= 80 && veroCountForCheck === 0 && !hasTitleVeroWarning) {
      shipText = "OK";
      highlight = false;
    } else {
      shipText = "OK（最適化後）";
      highlight = true;
    }
  }

  // 出品NGの場合、または既にMIP実行済みの場合は最適化ボタンを無効化
  if (UI.btnOpt) {
    UI.btnOpt.disabled = (reasons.length > 0 || STORE.turboExecuted.mip);
  }

  setStatusLine(len, veroCountForDisplay, shipText, highlight);

  // Quick MIPボタンの表示・有効化制御：常に表示、「出品：OK」の時のみクリック可能
  if (STORE.opt.quickMipButton && btnGet) {
    // MIPボタンが存在しない場合は生成
    if (!UI.quickMipBtn || !UI.quickMipBtn.isConnected) {
      ensureQuickMipButton(btnGet);
    }

    if (UI.quickMipBtn) {
      const shouldEnable = (reasons.length === 0 && len >= 70 && len <= 80 && veroCountForCheck === 0 && !hasTitleVeroWarning);

      // 点滅防止: 一度有効になったボタンを無効に戻さない（新しいASIN取得時にresetUIStateでリセット済み）
      if (shouldEnable || !UI.quickMipBtn._wasEnabled) {
        UI.quickMipBtn.disabled = !shouldEnable;
        if (shouldEnable) UI.quickMipBtn._wasEnabled = true;
      }

      UI.quickMipBtn.style.display = "inline-flex";
      UI.quickMipBtn.style.width = `${btnGet.getBoundingClientRect().width}px`;
    }
  }

  // フラグ判定とASIN履歴更新
  if (STORE.lastRequestedAsin) {
    // まず、現在の履歴を確認してno_listingsフラグが立っているかチェック
    const history = await loadHistory();
    const currentEntry = history.find(entry => entry.asin === STORE.lastRequestedAsin);
    const hasNoListingsFlag = currentEntry && currentEntry.flags && currentEntry.flags.no_listings;

    // 画面が更新されたかどうかをチェック（前回のタイトルと現在のタイトルが異なるか）
    const currentTitle = normSpace(title || "");
    const titleChanged = !STORE.lastTitle || currentTitle !== STORE.lastTitle;

    // no_listingsフラグが立っている場合、または画面が更新されていない場合、他のフラグ判定をスキップ
    if (!hasNoListingsFlag && titleChanged) {
      const flags = {};

      // protected検出
      if (protectedText && protectedText.length > 0) {
        flags.protected = true;
      }

      // brand検出（VeRO Warningsのkindがbrandを含む場合）
      const brandTerms = terms.filter(t => t.kind === "brand");
      if (brandTerms.length > 0) {
        flags.brand = true;
      }

      // already_listed検出
      if (duplicationError && duplicationError.length > 0) {
        flags.already_listed = true;
      }

      // 履歴を更新（フラグがなくても更新して、lastSeenを記録）
      await updateHistoryFlags(STORE.lastRequestedAsin, flags);
    }
  }
}

let optimizeRunning = false;

async function onOptimizeClick({ titleEl }) {
  // すでに出品中（MIP後）なら一切動作させない
  if (STORE.turboExecuted.mip) return;

  // 連打防止（APIリクエスト中のみ）
  if (optimizeRunning) return;
  optimizeRunning = true;

  try {
    await loadOptions();

    if (!STORE.opt.apiKey) {
      setBadge("API key未設定");
      return;
    }

    const block = extractWarningBlockText();
    const terms = parseVeroTerms(block);
    const titleTerms = terms.filter(t => t.kind === "title");
    const matchers = buildVeroMatchers(titleTerms);
    const forbidden = STORE.opt.veroEnabled ? titleTerms.map(t => normSpace(t.term)) : [];

    const descEl =
      findLabelInput(/^(Description|説明|商品説明)$/i) ||
      document.querySelector("textarea[ng-model*='description'], div[contenteditable='true'][ng-model*='description']") ||
      null;
    const descText = readText(descEl);

    const protectedText = extractProtectedText();
    const duplicationError = extractDuplicationError();
    const reasons = computeShipReasons({ blockText: block, protectedText, descText, duplicationError });
    if (reasons.length) {
      setBadge(`×出品不可：${reasons.join(" / ")}`);
      // return; // ロックを排除するため継続
    }

    let srcTitle = readText(titleEl);
    if (!srcTitle) return;

    // ターゲット文字数を判定
    const targetLen = determineTargetLength(srcTitle);

    // ローカル事前短縮（80文字超の時のみ適用）
    srcTitle = localShortenTitle(srcTitle);

    // Vero除去もローカルで実施（GPTに投げる前に保険）
    if (STORE.opt.veroEnabled && matchers.length) {
      srcTitle = removeVeroFromTitle(srcTitle, matchers);
    }

    setBusy(true);

    let finalTitle = "";
    let finalVero = 999;
    let finalLen = 0;
    let prevOutput = "";
    let prevLen = 0;

    // 1クリック = 最大3リクエスト
    for (let tryNum = 1; tryNum <= 3; tryNum++) {
      const prompt = buildOptimizePrompt({
        title: tryNum === 1 ? srcTitle : prevOutput,
        desc: descText,
        forbiddenTerms: forbidden,
        targetLen: targetLen,
        tryNum: tryNum,
        prevOutput: prevOutput,
        prevLen: prevLen,
        rejectedOutputs: STORE.optimizeState.lastOutputs
      });

      try {
        const raw = await callOpenAI({ apiKey: STORE.opt.apiKey, model: STORE.opt.model, messages: prompt.messages });
        let out = normSpace((raw || "").split("\n")[0] || "");

        // GPT出力後もVero除去を実施（保険）
        if (STORE.opt.veroEnabled && matchers.length) out = removeVeroFromTitle(out, matchers);
        if (!out) continue;

        // 同一出力対策：Try2以降で前回と同じ場合はスキップ
        if (tryNum > 1 && out === prevOutput) {
          continue;
        }

        finalTitle = out;
        finalLen = finalTitle.length;
        finalVero = STORE.opt.veroEnabled ? countVeroInText(finalTitle, matchers) : 0;

        prevOutput = finalTitle;
        prevLen = finalLen;

        // 70〜80に収束したら終了
        if (finalLen >= 70 && finalLen <= 80) break;
      } catch (e) {
        console.error('[LFP] OpenAI API Error:', e);

        // Extension context invalidated エラーのハンドリング
        if (e.message && (e.message.includes('Extension context invalidated') || e.message.includes('context_invalidated'))) {
          alert('拡張機能が更新されました。正常に動作させるためにページを再読み込みしてください。');
        }

        setBusy(false);
        optimizeRunning = false;
        return;
      }
    }

    if (finalTitle) {
      // 出力を履歴に記録（同一タイトル生成防止用）
      STORE.optimizeState.lastOutputs.push(finalTitle);
      // 最大5件まで保持
      if (STORE.optimizeState.lastOutputs.length > 5) {
        STORE.optimizeState.lastOutputs.shift();
      }

      setInputValue(titleEl, finalTitle);
      await sleep(120);
      const btnGet = findButtonByText(/^Get Item$/i);
      await evaluateAndRender({ titleEl, btnGet });

      // === Vero残存リトライループ ===
      // evaluateAndRender後にVeroが残っていないか再チェックし、
      // 残っている場合は自動で再最適化を試みる（最大2回）
      const MAX_VERO_RETRIES = 2;
      for (let veroRetry = 0; veroRetry < MAX_VERO_RETRIES; veroRetry++) {
        // 現在のステータスを確認
        const currentStatus = UI.status?.textContent || "";
        const isShipOk = currentStatus.includes("出品：OK") && !currentStatus.includes("（最適化後）");
        if (isShipOk) break; // 出品OKなら終了

        // Veroワード残存チェック: Yaballeの警告ブロックを再パース
        const retryBlock = extractWarningBlockText();
        const retryTerms = parseVeroTerms(retryBlock);
        const retryTitleTerms = retryTerms.filter(t => t.kind === "title");
        const retryMatchers = buildVeroMatchers(retryTitleTerms);
        const retryForbidden = STORE.opt.veroEnabled ? retryTitleTerms.map(t => normSpace(t.term)) : [];
        const currentTitle = readText(titleEl);
        const retryVeroCount = STORE.opt.veroEnabled ? countVeroInText(currentTitle, retryMatchers) : 0;

        if (retryVeroCount === 0 && retryForbidden.length === 0) break; // Veroなしなら終了

        console.log(`🔄 [LFP] Vero残存リトライ ${veroRetry + 1}/${MAX_VERO_RETRIES}: Vero ${retryVeroCount}件検出、再最適化します`);
        setBadge(`Vero残存を検出、再最適化中... (${veroRetry + 1}/${MAX_VERO_RETRIES})`);

        // まずローカルでVero除去を試みる
        let retryTitle = currentTitle;
        if (retryMatchers.length) {
          retryTitle = removeVeroFromTitle(retryTitle, retryMatchers);
        }

        // ローカル除去後もVeroが残っている、または文字数条件を満たさない場合はAPI再最適化
        const localVeroCount = countVeroInText(retryTitle, retryMatchers);
        const localLen = retryTitle.length;

        if (localVeroCount === 0 && localLen >= 70 && localLen <= 80) {
          // ローカル除去で解決
          setInputValue(titleEl, retryTitle);
          await sleep(120);
          await evaluateAndRender({ titleEl, btnGet });
        } else {
          // API再最適化が必要
          const allForbidden = [...new Set([...forbidden, ...retryForbidden])];
          const retryPrompt = buildOptimizePrompt({
            title: retryTitle,
            desc: descText,
            forbiddenTerms: allForbidden,
            targetLen: targetLen,
            tryNum: 2,
            prevOutput: retryTitle,
            prevLen: retryTitle.length,
            rejectedOutputs: STORE.optimizeState.lastOutputs
          });

          try {
            const raw = await callOpenAI({ apiKey: STORE.opt.apiKey, model: STORE.opt.model, messages: retryPrompt.messages });
            let out = normSpace((raw || "").split("\n")[0] || "");
            // Vero除去（新旧両方のmatcherで）
            const allMatchers = [...matchers, ...retryMatchers];
            if (STORE.opt.veroEnabled && allMatchers.length) out = removeVeroFromTitle(out, allMatchers);
            if (out && out !== finalTitle) {
              finalTitle = out;
              finalLen = finalTitle.length;
              STORE.optimizeState.lastOutputs.push(finalTitle);
              if (STORE.optimizeState.lastOutputs.length > 5) STORE.optimizeState.lastOutputs.shift();
              setInputValue(titleEl, finalTitle);
              await sleep(120);
              await evaluateAndRender({ titleEl, btnGet });
            }
          } catch (e) {
            console.error('[LFP] Veroリトライ中のAPIエラー:', e);
            break;
          }
        }
      }
    }


    // 最終的に70〜80文字に収束したかどうかで状態を切り替え
    if (!(finalLen >= 70 && finalLen <= 80)) {
      // 収束失敗：「再実行」表示に切り替え
      STORE.optimizeState.needsRetry = true;
      setBadge("70〜80文字に収束しない。「再実行」を押すか手動調整してください。");
    } else {
      // 収束成功：「最適化」表示に戻す
      STORE.optimizeState.needsRetry = false;
    }

    // 最終ステータスチェック
    const finalStatus = UI.status?.textContent || "";
    const isFinalOk = finalStatus.includes("出品：OK") && !finalStatus.includes("（最適化後）");

    if (STORE.opt.autoMipAfterOptimize && isFinalOk) {
      if (finalLen >= 70 && finalLen <= 80 && finalVero === 0) {
        // ターボモードと重複しないように、ターボモードがOFFの時だけ実行
        if (!STORE.opt.turboListingMode) {
          await sleep(250);
          clickRealMipButton();
        }
      }
    }

  } finally {
    // 成功・失敗・中断に関わらず、必ずフラグと表示をリセットする
    optimizeRunning = false;
    setBusy(false);
  }
}

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

/* ---------- History UI ---------- */

async function refreshHistorySelect(force = false) {
  if (!UI.histSel || !UI.histSel.isConnected) return;

  // ドロップダウンが開いている場合は再構築をスキップ（閉じてしまう問題の防止）
  // ただし force=true の場合はデータ変更があるため強制リフレッシュ
  if (!force) {
    const openDropdown = document.getElementById('lfp-custom-dropdown');
    if (openDropdown && openDropdown.style.display === 'block') return;
  }

  const hist = await loadHistory();

  // 件数カウントを表示
  const count = hist.length;
  const maxCount = 1000;

  // 既存のselectを更新（件数カウント付き）
  UI.histSel.innerHTML = `<option value="">ASIN履歴（直近1000件） ${count}/${maxCount}</option>`;
  for (const entry of hist) {
    const opt = document.createElement("option");
    opt.value = entry.asin;
    opt.textContent = entry.asin;
    UI.histSel.appendChild(opt);
  }

  // カスタムドロップダウンを更新
  refreshCustomDropdown(hist);
  // 注意: ここでrefreshListingCountUIを呼ばない（1秒タイマーと二重になりカクつくため）
}

async function refreshListingCountUI() {
  if (!UI.listingCountLabel || !UI.listingCountLabel.isConnected) return;
  if (!isExtensionContextValid()) return;

  try {
    const stats = await chrome.runtime.sendMessage({ type: "LFP_GET_STATS" });
    if (!stats) return;

    // 本日の作業時間（バックグラウンドで計算された累積秒数を使用）
    const totalMs = stats ? (stats.totalWorkTimeToday || 0) : 0;
    let sessionWorkTime = "0時間00分00秒";

    if (totalMs > 0) {
      const totalSec = Math.floor(totalMs / 1000);
      const hours = Math.floor(totalSec / 3600);
      const mins = Math.floor((totalSec % 3600) / 60);
      const secs = totalSec % 60;
      sessionWorkTime = `${hours}時間${String(mins).padStart(2, '0')}分${String(secs).padStart(2, '0')}秒`;
    }

    // ランク判定
    let rankContent = "";
    let color = "#6c757d";
    let bgColor = "#f8f9fa";

    if (totalMs > 0) {
      const speedVal = (stats.todayListings / (totalMs / 3600000));
      let feedback = "ゆったり";
      let emoji = "🐢";

      if (speedVal >= 120) {
        feedback = "爆速";
        emoji = "🚀";
        color = "#6f42c1";
        bgColor = "#f3e5f5";
      } else if (speedVal >= 60) {
        feedback = "高速";
        emoji = "🏎️";
        color = "#007bff";
        bgColor = "#e7f3ff";
      } else if (speedVal >= 30) {
        feedback = "着実";
        emoji = "💪";
        color = "#28a745";
        bgColor = "#e8f5e9";
      } else if (speedVal >= 10) {
        feedback = "のんびり";
        emoji = "🚲";
        color = "#ffc107";
        bgColor = "#fffde7";
      }

      // トロフィー判定に遊び（バッファ）を持たせる（点滅防止）
      const maxSpeed = stats?.todayMaxSpeed || 0;
      const hasTrophy = speedVal > 0 && speedVal >= (maxSpeed - 2);
      const trophyStr = hasTrophy ? " 🏆" : "";

      rankContent = `${feedback} ${emoji}${trophyStr}`;
    }

    const showPanel = STORE.opt.showWorkTimePanel !== false;
    const panelDisplay = showPanel ? 'inline' : 'none';
    const flexDisplay = showPanel ? 'inline-flex' : 'none';
    const rankDisplay = (showPanel && rankContent) ? 'inline-block' : 'none';

    // 初回構築
    if (!UI.listingCountLabel.querySelector('.lfp-count-val')) {
      UI.listingCountLabel.innerHTML = `
      <span class="lfp-count-val" style="font-weight: bold; color: #111;">出品完了: ${stats.todayListings || 0}件</span>
      <span class="lfp-time-val" style="margin-left: 15px; color: #111; font-weight: bold; display: ${panelDisplay};">本日の作業時間: ${sessionWorkTime}</span>
      <span id="lfp-pause-resume-btn-placeholder" style="margin-left: 4px; display: ${flexDisplay}; align-items: center;"></span>
      <span class="lfp-rank-badge" style="margin-left: 10px; display: ${rankDisplay}; color: ${color}; background-color: ${bgColor}; border-color: ${color}44;">${rankContent}</span>
    `;
      await createPauseResumeButton();
    } else {
      // 部分更新
      const countSpan = UI.listingCountLabel.querySelector('.lfp-count-val');
      const timeSpan = UI.listingCountLabel.querySelector('.lfp-time-val');
      const rankSpan = UI.listingCountLabel.querySelector('.lfp-rank-badge');

      if (countSpan) {
        countSpan.textContent = `出品完了: ${stats.todayListings || 0}件`;
        countSpan.style.color = "#111";
        countSpan.style.fontWeight = "bold";
      }
      if (timeSpan) {
        timeSpan.textContent = `本日の作業時間: ${sessionWorkTime}`;
        timeSpan.style.color = "#111";
        timeSpan.style.fontWeight = "bold";
        timeSpan.style.display = panelDisplay;
      }

      // ボタンのコンテナも制御
      const btnPlaceholder = document.getElementById('lfp-pause-resume-btn-placeholder');
      if (btnPlaceholder) {
        btnPlaceholder.style.display = flexDisplay;
      }

      if (rankSpan) {
        rankSpan.style.display = rankDisplay;
        rankSpan.textContent = rankContent;
        rankSpan.style.color = color;
        rankSpan.style.backgroundColor = bgColor;
        rankSpan.style.borderColor = `${color}44`;
      }

      // ボタンの状態も同期
      if (UI.pauseResumeBtn) {
        updatePauseResumeButtonUI(UI.pauseResumeBtn, stats.isCounterPaused);
      }
    }
  } catch (err) {
    if (err.message && (err.message.includes('Extension context invalidated') || err.message.includes('context_invalidated'))) {
      stopWorkTimeUpdateTimer();
    } else if (err.message && err.message.includes('message channel closed')) {
      // transient message channel errors are normal during page transitions/unloads, suppress log
      console.log('[LFP] refreshListingCountUI: Message channel closed (transient)');
    } else {
      console.error('[LFP] refreshListingCountUI error:', err);
    }
  }
}

function refreshCustomDropdown(hist) {
  if (!UI.histSel || !UI.histSel.isConnected) return;

  // 既存のカスタムドロップダウンの状態を取得
  const existingDropdown = document.getElementById('lfp-custom-dropdown');
  let currentDisplay = 'none';
  if (existingDropdown) {
    currentDisplay = existingDropdown.style.display;
    existingDropdown.remove();
  }

  // カスタムドロップダウンを作成
  const dropdown = document.createElement('div');
  dropdown.id = 'lfp-custom-dropdown';
  dropdown.className = 'lfp-custom-dropdown';
  dropdown.style.display = currentDisplay;

  // プレースホルダーは削除（ASINを上に詰める）

  // 履歴アイテム
  for (const entry of hist) {
    const itemWrapper = document.createElement('div');
    itemWrapper.className = 'lfp-dropdown-item-wrapper';

    const item = document.createElement('div');
    item.className = 'lfp-dropdown-item';
    item.dataset.asin = entry.asin;

    // フラグに応じて表示を変える
    let flagText = '';
    let isBad = false;

    // no_listings または no_item フラグが立っている場合は最優先で表示
    if (entry.flags.no_listings) {
      flagText = 'No listings';
      isBad = true;
    } else if (entry.flags.no_item) {
      flagText = 'No item';
      isBad = true;
    } else {
      // 複数のフラグを配列で収集
      const flagLabels = [];
      if (entry.flags.protected) flagLabels.push("protected");
      if (entry.flags.brand) flagLabels.push("brand");
      if (entry.flags.already_listed) flagLabels.push("already_listed");

      if (flagLabels.length > 0) {
        flagText = flagLabels.join(" / ");
        isBad = true;
      }
    }

    // ASIN表示用のspan
    const asinSpan = document.createElement('span');
    asinSpan.className = 'lfp-dropdown-asin';
    asinSpan.textContent = isBad ? `${entry.flags.no_listings || entry.flags.no_item ? '!' : '×'} ${entry.asin}` : entry.asin;

    item.appendChild(asinSpan);

    // エラータグがある場合は別のspanとして中央に配置
    if (flagText) {
      const flagSpan = document.createElement('span');
      flagSpan.className = 'lfp-dropdown-flag';
      flagSpan.textContent = flagText;
      item.appendChild(flagSpan);
    }

    if (isBad) item.classList.add('lfp-dropdown-item-bad');

    // クリックイベント
    item.addEventListener('click', () => {
      selectHistoryAsin(entry.asin);
      dropdown.style.display = 'none';
    });

    // 削除ボタンを追加
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'lfp-dropdown-delete-btn';
    deleteBtn.textContent = '×';
    deleteBtn.title = 'この履歴を削除';
    deleteBtn.addEventListener('click', async (e) => {
      e.stopPropagation();

      // 先にDOMからスムーズに消す（視覚的フィードバック即座）
      itemWrapper.style.transition = 'opacity 0.15s ease-out, max-height 0.2s ease-out';
      itemWrapper.style.opacity = '0';
      itemWrapper.style.maxHeight = itemWrapper.offsetHeight + 'px';
      itemWrapper.style.overflow = 'hidden';

      // アニメーション開始
      requestAnimationFrame(() => {
        itemWrapper.style.maxHeight = '0';
        itemWrapper.style.paddingTop = '0';
        itemWrapper.style.paddingBottom = '0';
        itemWrapper.style.marginTop = '0';
        itemWrapper.style.marginBottom = '0';
      });

      // ストレージ更新は非同期で行う（UIをブロックしない）
      await deleteHistoryItemFromContent(entry.asin);

      // アニメーション完了後にDOMから削除
      setTimeout(() => {
        if (itemWrapper.isConnected) itemWrapper.remove();
      }, 200);

      // selectの件数表示も更新（ドロップダウンは再構築しない）
      const currentCount = document.querySelectorAll('.lfp-dropdown-item-wrapper').length - 1;
      if (UI.histSel) {
        UI.histSel.innerHTML = `<option value="">ASIN履歴（直近1000件） ${currentCount}/1000</option>`;
      }
    });

    itemWrapper.appendChild(item);
    itemWrapper.appendChild(deleteBtn);
    dropdown.appendChild(itemWrapper);
  }

  // selectの親要素に追加
  UI.histSel.parentElement.style.position = 'relative';
  UI.histSel.parentElement.appendChild(dropdown);

  // 既存のイベントリスナーを削除（メモリリーク防止）
  if (dropdownMousedownHandler) {
    UI.histSel.removeEventListener('mousedown', dropdownMousedownHandler);
  }
  if (dropdownClickHandler) {
    document.removeEventListener('click', dropdownClickHandler);
  }

  // selectのクリックでカスタムドロップダウンを表示
  dropdownMousedownHandler = (e) => {
    e.preventDefault();
    const currentDropdown = document.getElementById('lfp-custom-dropdown');
    if (!currentDropdown) return;
    const isVisible = currentDropdown.style.display === 'block';
    currentDropdown.style.display = isVisible ? 'none' : 'block';

    // ポジションを調整
    if (UI.histSel) {
      const rect = UI.histSel.getBoundingClientRect();
      currentDropdown.style.top = `${rect.height}px`;
      currentDropdown.style.left = '0';
      currentDropdown.style.width = `${rect.width}px`;
    }
  };
  UI.histSel.addEventListener('mousedown', dropdownMousedownHandler);

  // 外側クリックで閉じる
  dropdownClickHandler = (e) => {
    const currentDropdown = document.getElementById('lfp-custom-dropdown');
    if (!currentDropdown) return;
    if (!UI.histSel?.contains(e.target) && !currentDropdown.contains(e.target)) {
      currentDropdown.style.display = 'none';
    }
  };
  document.addEventListener('click', dropdownClickHandler);
}

async function selectHistoryAsin(asin) {
  // ASIN入力欄にセット
  const btnGet = findButtonByText(/^Get Item$/i);
  const asinInput = findAsinInputSmart(btnGet);
  if (asinInput) {
    setInputValue(asinInput, asin);

    // UI.histSelの表示をリセット（プレースホルダーに戻す）
    if (UI.histSel) {
      UI.histSel.selectedIndex = 0;
    }

    // autoGetOnHistoryがONならGet Itemを自動クリック
    if (STORE.opt.autoGetOnHistory && btnGet) {
      await sleep(100);
      btnGet.click();
    }
  }
}
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

  const statusText = UI.status?.textContent || "";

  // 1. 最適化が必要な場合（最大3回まで自動リトライ）
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
  // 2. 出品可能な場合（かつ、まだ自動MIPしていない場合）
  else if (statusText.includes("出品：OK") && !statusText.includes("（最適化後）")) {
    if (UI.quickMipBtn && !UI.quickMipBtn.disabled && !STORE.turboExecuted.mip) {
      // 最適化実行中（API待ち）ならスキップ
      if (optimizeRunning) return;

      console.log("[LFP] Turbo: 自動MIPボタンをクリック");
      STORE.turboExecuted.mip = true; // 実行済みフラグを先に立てる

      // 既存のautoMipAfterOptimizeと同様に、少し待機してから実行
      setTimeout(() => {
        clickRealMipButton();
      }, 250);
    }
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
      copyBtn.className = "lfp-copy-btn";
      copyBtn.textContent = "📋コピー";
      copyBtn.title = "ASIN履歴をクリップボードにコピー";
      bar.appendChild(copyBtn);

      // CSVボタンを追加
      const csvBtn = document.createElement("button");
      csvBtn.className = "lfp-csv-btn";
      csvBtn.textContent = "📊CSV";
      csvBtn.title = "ASIN履歴をCSVでダウンロード";
      bar.appendChild(csvBtn);

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
function handlePotentialErrorModal(modal) {
  if (!modal || modal.dataset.lfpModal || modal.dataset.lfpHandled) return false;

  const modalText = modal.textContent || '';

  // 1. エラーの種類を特定
  const isNoListings = /no listings for this product in amazon|could not fetch details/i.test(modalText);
  const isNoItem = /no item found in Amazon/i.test(modalText);
  const isAlreadyListed = /already listed|already monitored|Duplications are not possible/i.test(modalText);

  if (isAlreadyListed || isNoListings || isNoItem) {
    // 処理済みマークと出現時刻を付与
    modal.dataset.lfpHandled = "1";
    if (!modal.dataset.lfpCreatedAt) {
      modal.dataset.lfpCreatedAt = Date.now().toString();
    }
    console.log(`⚠️ [LFP] エラーモーダルを検知: Listed=${isAlreadyListed}, NoListings=${isNoListings}, NoItem=${isNoItem}`);

    // 2. 履歴フラグを更新
    if (STORE.lastRequestedAsin) {
      updateHistoryFlags(STORE.lastRequestedAsin, {
        already_listed: isAlreadyListed,
        no_listings: isNoListings,
        no_item: isNoItem,
        protected: false,
        brand: false
      }).then(() => refreshHistorySelect(true));
    }

    // 3. 自動クローズ処理
    // ターボリストモード、または自動Get Item設定（貼り付け/履歴）がONの場合は自動で閉じる

    const isAutoMode = STORE.opt.turboListingMode || STORE.opt.autoGetOnPaste || STORE.opt.autoGetOnHistory;

    if (isAutoMode) {
      // 現在のASINと時刻を確認
      const currentAsin = STORE.lastRequestedAsin;
      const now = Date.now();
      const isRecurrent = (currentAsin === STORE.errorHandling.lastAsin) &&
        (now - STORE.errorHandling.timestamp < 5000); // 5秒以内の再発は同一とみなす（短縮して精度向上）

      if (isRecurrent) {
        console.log('🔥 [LFP] エラー再発（ゾンビ）を検知: 待機なしで即座に焼却します');
        // 待機なしで即座に閉じる試行
        attemptCloseErrorModal(modal);
      } else {
        console.log('✅ [LFP] 初回エラー検知: 1秒後に処理を開始します');

        // 状態を更新
        STORE.errorHandling.lastAsin = currentAsin;
        STORE.errorHandling.timestamp = now;

        // 1.5秒後に実行
        setTimeout(() => {
          // ボタンを探してクリック
          attemptCloseErrorModal(modal);
          // 以降、5秒間は掃討モード（定期監視）に入り、復活するモーダルを潰し続ける
          startAggressiveCleaner();
        }, 1500);
      }
    }
    return true;
  }
  return false;
}

/**
 * モーダル内のクローズボタン/OKボタンを探してクリックする
 */
function attemptCloseErrorModal(modalOrDocument) {
  // モーダル自体が渡されていない場合はdocumentから探す
  const root = modalOrDocument || document;

  const closeBtn = Array.from(root.querySelectorAll('.modal button, [role="dialog"] button, .cdk-overlay-pane button, button[class*="close"], [role="button"]')).find(btn => {
    // 保護ロジック: 出現から1.5秒経っていないモーダル内のボタンは（掃討モードからは）無視する
    const modalParent = btn.closest('.modal, [role="dialog"], .cdk-overlay-pane');
    if (modalParent && modalParent.dataset.lfpCreatedAt) {
      const age = Date.now() - parseInt(modalParent.dataset.lfpCreatedAt);
      if (age < 1400) return false; // 1.4秒の安全マージン
    }

    return /ok|確定|確認|閉じる|close|×|キャンセル|cancel|got it/i.test(btn.textContent.trim()) ||
      btn.classList.contains('close') ||
      /close|dismiss/i.test(btn.getAttribute('aria-label') || '') ||
      btn.querySelector('i.fa-times, .close-icon');
  });

  if (closeBtn && closeBtn.isConnected) {
    console.log('💥 [LFP] エラークローズ実行');
    closeBtn.click();
    return true;
  }
  return false;
}

/**
 * 積極的クローズ機能（掃討モード）
 * エラー発生後の数秒間、定期的にボタンを探してクリックし続ける
 */
function startAggressiveCleaner() {
  stopAggressiveCleaner(); // 既存のものをクリア

  console.log('🧹 [LFP] 掃討モード開始（5秒間）');
  let count = 0;

  STORE.errorHandling.cleanerInterval = setInterval(() => {
    count++;
    // DOM全体からエラーっぽいモーダルのボタンを探して押す
    const hit = attemptCloseErrorModal(document);
    if (hit) console.log(`🧹 [LFP] 掃討ヒット (${count})`);

    if (count >= 10) { // 500ms * 10 = 5秒
      stopAggressiveCleaner();
    }
  }, 500);
}

function stopAggressiveCleaner() {
  if (STORE.errorHandling.cleanerInterval) {
    clearInterval(STORE.errorHandling.cleanerInterval);
    STORE.errorHandling.cleanerInterval = null;
  }
}

function setupNoListingsObserver() {
  if (noListingsObserver) return; // 既に初期化済み
  noListingsObserver = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.addedNodes.length === 0) continue;
      for (const node of mutation.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;

        // モーダルの検出（Yaballeのモーダル構造を想定）
        const modal = node.matches('.modal, [role="dialog"], .cdk-overlay-pane') ? node : node.querySelector('.modal, [role="dialog"], .cdk-overlay-pane');
        if (modal) {
          handlePotentialErrorModal(modal);
        }
      }
    }
  });

  const container = document.body;
  console.log(`[LFP] Error Observer を開始します: 全体`);
  noListingsObserver.observe(container, {
    childList: true,
    subtree: true
  });
}

/* Listing SuccessモーダルのOKボタン自動クリック */
/**
 * 成功モーダルの検知と自動処理（カウント・OKクリック）の統合関数
 */
function handlePotentialSuccessModal(modal) {
  if (!modal || modal.dataset.lfpModal || modal.dataset.lfpHandled) return false;

  const modalText = modal.textContent || '';
  // 成功を意味するキーワードを幅広く検知
  const isListingSuccess = /Listing Success|Success|Listed|完了|成功/i.test(modalText);

  if (isListingSuccess) {
    // 処理済みマークを速やかに付与
    modal.dataset.lfpHandled = "1";

    // 1. カウント処理（未カウントの場合のみ）
    if (!listingCounted) {
      listingCounted = true;
      console.log('✅ [LFP] 成功モーダルを検知: カウントを実行します');
      incrementListingCount();

      // 5秒後にフラグをリセット（タイムアウトによるバックアップ）
      setTimeout(() => {
        listingCounted = false;
      }, 5000);
    }

    // 2. OKボタン自動クリック処理（オプションONの場合のみ）
    if (STORE.opt.autoClickOkAfterMip) {
      console.log('✅ [LFP] 成功モーダルを検知: OKボタンを探して自動クリックします');

      // 少し待ってから（DOMの安定とボタンの出現を待つ）検索とクリックを実行
      setTimeout(() => {
        const okButton = Array.from(modal.querySelectorAll('button, [role="button"]')).find(btn =>
          /ok|確定|確認|閉じる|close|success/i.test(btn.textContent.trim()) ||
          btn.classList.contains('btn-primary') // 成功時のメインボタンは大抵primary
        );

        if (okButton && okButton.offsetParent !== null && okButton.isConnected) {
          if (okButtonClicked) return;
          okButtonClicked = true;

          okButton.click();
          console.log('✅ [Auto OK] OKボタンを直接クリックしました');

          // 500ms後にフラグをリセット
          setTimeout(() => { okButtonClicked = false; }, 500);
        } else if (!okButtonCheckInterval) {
          // 見つからない場合は既存のインターバル監視にフォールバック（最大3秒）
          let checkCount = 0;
          okButtonCheckInterval = setInterval(() => {
            checkCount++;
            const currentModal = document.querySelector('.modal, [role="dialog"]');
            if (!currentModal || currentModal.dataset.lfpModal) {
              if (checkCount >= 30) {
                clearInterval(okButtonCheckInterval);
                okButtonCheckInterval = null;
              }
              return;
            }
            const currentOk = Array.from(currentModal.querySelectorAll('button, [role="button"]')).find(btn =>
              /ok|確定|確認|閉じる|close/i.test(btn.textContent.trim())
            );
            if (currentOk && currentOk.offsetParent !== null) {
              clearInterval(okButtonCheckInterval);
              okButtonCheckInterval = null;
              if (!okButtonClicked) {
                okButtonClicked = true;
                currentOk.click();
                console.log(`✅ [Auto OK] 監視によりOKボタンを自動クリックしました（${checkCount * 100}ms後）`);
                setTimeout(() => { okButtonClicked = false; }, 500);
              }
            } else if (checkCount >= 30) {
              clearInterval(okButtonCheckInterval);
              okButtonCheckInterval = null;
              console.log('⚠️ [Auto OK] OKボタンが3秒以内に見つかりませんでした');
            }
          }, 100);
        }
      }, 150);
    }
    return true;
  }
  return false;
}

function setupListingSuccessObserver() {
  if (listingSuccessObserver) return; // 既に初期化済み
  listingSuccessObserver = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.addedNodes.length === 0) continue;
      for (const node of mutation.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;

        // モーダルの検出
        const modal = node.matches('.modal, [role="dialog"], .cdk-overlay-pane') ? node : node.querySelector('.modal, [role="dialog"], .cdk-overlay-pane');
        if (modal) {
          handlePotentialSuccessModal(modal);
        }
      }
    }
  });

  const container = getOverlayContainer();
  console.log(`[LFP] Success Observer を開始します: ${container === document.body ? '全体' : '.cdk-overlay-container'}`);
  listingSuccessObserver.observe(container, {
    childList: true,
    subtree: true
  });
}

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

/* ---------- SPA Navigation Detection ---------- */

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
let listerPageObserver = null;
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



/* ========== 新規: 作業時間計測ロジック（ASIN入力起点） ========== */

// グローバル変数: リアルタイムカウンター更新用
let workTimeUpdateInterval = null;

/**
 * 統計情報の読み込み（バックグラウンドから取得）
 */
async function loadStatistics() {
  return await chrome.runtime.sendMessage({ type: "LFP_GET_STATS" });
}

/**
 * 統計情報の保存（バックグラウンドは自動保存するため、ここでは同期のみ）
 */
async function saveStatistics(stats) {
  // バックグラウンドの stats を更新するメッセージがないため、
  // 必要な操作（タイマー開始/停止等）をメッセージで送る運用にする
  return true;
}

/**
 * 作業時間計測の開始（ASIN入力時）
 */
async function startWorkTimeSession() {
  // SW側のタイマーを開始させる
  await chrome.runtime.sendMessage({ type: "LFP_TIMER_CONTROL", action: "start" });
  console.log('[LFP] 作業時間計測セッション開始');
}

/**
 * リアルタイムカウンター更新（1秒ごと）
 * 廃止: startWorkTimeUpdateTimer に一本化
 */
function startRealtimeCounter() {
  startWorkTimeUpdateTimer();
}

/**
 * 作業時間表示の更新（出品作業画面）
 * 廃止: refreshListingCountUI に一本化
 */
async function updateWorkTimeDisplay() {
  await refreshListingCountUI();
}

/**
 * 作業時間の確定（出品完了時）
 */
async function confirmWorkTime() {
  // 本来は出品成功時に呼ぶが、現在はバックグラウンドのタイマーで完結
  console.log('[LFP] confirmWorkTime はバックグラウンドで処理されます');
}

/**
 * 一時停止/再開ボタンの切り替え
 */
async function togglePauseResume() {
  const stats = await loadStatistics();
  if (!stats) return;

  const now = Date.now();
  const isPaused = !stats.isCounterPaused;
  stats.isCounterPaused = isPaused;

  if (isPaused) {
    console.log('[LFP] カウンター一時停止');
    if (stats.currentSessionStartTime) {
      const elapsed = now - stats.currentSessionStartTime;
      stats.totalWorkTimeToday = (stats.totalWorkTimeToday || 0) + elapsed;
      stats.currentSessionStartTime = null;
      stats.currentSessionElapsedMs = 0;
    }
    // バックグラウンドタイマー停止通知
    chrome.runtime.sendMessage({ type: "LFP_TIMER_CONTROL", action: "stop" });
  } else {
    console.log('[LFP] カウンター再開');
    stats.currentSessionStartTime = now;
    stats.currentSessionElapsedMs = 0;
    stats.lastAsinInputTime = now;
    // バックグラウンドタイマー開始通知
    chrome.runtime.sendMessage({ type: "LFP_TIMER_CONTROL", action: "start" });
    startRealtimeCounter();
  }

  await saveStatistics(stats);
  await refreshListingCountUI();
}

/**
 * ASIN入力時の処理（セッション開始）
 */
async function onAsinInput() {
  try {
    // 即座にUIを ⏸️ 表示に更新（ラグを視覚的にゼロにする）
    if (UI.pauseResumeBtn) {
      updatePauseResumeButtonUI(UI.pauseResumeBtn, false); // isPaused = false (作業中)
    }
    // バックグラウンドに通知
    await chrome.runtime.sendMessage({ type: "LFP_UPDATE_INPUT_TIME" });
    // 最新状態を反映
    await refreshListingCountUI();
  } catch (err) {
    if (err.message && err.message.includes('Extension context invalidated')) return;
    console.error('[LFP] onAsinInput error:', err);
  }
}


/**
 * 再生/一時停止トグルボタンを作成
 */
async function createPauseResumeButton() {
  const placeholder = document.getElementById('lfp-pause-resume-btn-placeholder');
  if (!placeholder || placeholder.querySelector('.lfp-pause-resume-btn')) {
    return; // 既に作成済み
  }

  // ボタン要素を作成
  const btn = document.createElement('button');
  btn.className = 'lfp-pause-resume-btn';
  btn.id = 'lfp-pause-resume-btn';
  btn.type = 'button';
  btn.title = 'クリックで再開/一時停止';

  // 初期状態を取得
  const stats = await loadStatistics();
  const isPaused = stats?.isCounterPaused || false;

  // アイコンと色を設定
  updatePauseResumeButtonUI(btn, isPaused);

  // クリックイベントを追加
  btn.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();

    await togglePauseResume();

    // ボタンのUI更新
    const updatedStats = await loadStatistics();
    updatePauseResumeButtonUI(btn, updatedStats?.isCounterPaused || false);
  });

  placeholder.appendChild(btn);
  UI.pauseResumeBtn = btn;

  console.log('[LFP] 再生/一時停止ボタンを作成しました');
}

/**
 * 再生/一時停止ボタンのUI更新
 */
function updatePauseResumeButtonUI(btn, isPaused) {
  if (isPaused) {
    // 一時停止中 → ▶️ボタン（再開待機）
    btn.innerHTML = '▶️';
    btn.style.backgroundColor = 'transparent';
    btn.title = 'クリックで再開';
  } else {
    // 作業中 → ⏸️ボタン（一時停止可能）
    btn.innerHTML = '⏸️';
    btn.style.backgroundColor = 'transparent';
    btn.title = 'クリックで一時停止';
  }
}

/* ---------- リアルタイムカウンター更新 ---------- */

/**
 * 出品作業画面のカウンターをリアルタイム更新（1秒ごと）
 */
function startWorkTimeUpdateTimer() {
  if (workTimeUpdateInterval) {
    clearInterval(workTimeUpdateInterval);
  }

  workTimeUpdateInterval = setInterval(async () => {
    // ASIN入力フィールドが存在する場合のみ更新
    const asinInput = findAsinInputSmart();
    if (!asinInput || !asinInput.isConnected) {
      return;
    }

    // 出品作業画面のカウンターを更新
    await refreshListingCountUI();
  }, 1000);

  console.log('[LFP] リアルタイムカウンター更新タイマーを開始しました');
}

function stopWorkTimeUpdateTimer() {
  if (workTimeUpdateInterval) {
    clearInterval(workTimeUpdateInterval);
    workTimeUpdateInterval = null;
    console.log('[LFP] リアルタイムカウンター更新タイマーを停止しました');
  }
}

// エクステンションコンテキストが無効化された際のクリーンアップ
window.addEventListener('unload', () => {
  stopWorkTimeUpdateTimer();
  if (observersInitialized) {
    // MutationObserverの停止などは必要に応じて追加
  }
});

// 定期的にコンテキストの有効性をチェックし、無効ならタイマーを止める
setInterval(() => {
  if (!isExtensionContextValid()) {
    stopWorkTimeUpdateTimer();
  }
}, 5000);
