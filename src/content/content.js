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
    needsRetry: false  // trueの時「再実行」表示
  },
  // 最後にリクエストしたASIN（No listingsモーダル検出用）
  lastRequestedAsin: "",
  // ターボモードの実行済みフラグ
  turboExecuted: {
    optimize: false,
    mip: false
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

// 履歴操作のロック（競合状態防止）
let historyLock = false;

// エクステンションコンテキストの有効性チェック
function isExtensionContextValid() {
  try {
    // chrome.storageにアクセスできるかチェック
    return !!(chrome && chrome.storage && chrome.storage.sync);
  } catch (e) {
    return false;
  }
}

// エクステンションコンテキスト無効時のリカバリー処理
let recoveryAttempts = 0;
const MAX_RECOVERY_ATTEMPTS = 3;

async function attemptRecovery() {
  if (recoveryAttempts >= MAX_RECOVERY_ATTEMPTS) {
    console.log('[LFP] リカバリー試行回数上限に達しました。ページをリロードしてください。');
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
    console.log('[LFP] エクステンションコンテキストが復活しました');
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
  okButtonClicked = false;
  
  // setIntervalをクリア
  if (okButtonCheckInterval) {
    clearInterval(okButtonCheckInterval);
    okButtonCheckInterval = null;
  }
  
  console.log('[LFP] 全てのフラグをリセットしました');
}

const KEY_OPT = "lfp_options_v1";
const KEY_HIST = "lfp_asin_history_v1";
const KEY_STATS = "lfp_statistics_v1";

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
    console.log('[LFP] エクステンションコンテキストが無効です。デフォルト設定を使用します。');
    return;
  }
  
  try {
    const data = await chrome.storage.sync.get([KEY_OPT]);
    const saved = data?.[KEY_OPT];
    if (saved && typeof saved === "object") STORE.opt = { ...STORE.opt, ...saved };
  } catch (err) {
    if (err.message && err.message.includes('Extension context invalidated')) {
      // Extension context invalidated - リカバリーを試行
      console.log('[LFP] Extension context invalidated 検出。リカバリーを試行します。');
      attemptRecovery();
    } else {
      console.error('[LFP] loadOptions error:', err);
    }
  }
}

/* ---------- Statistics ---------- */

/* 統計データ形式: {
  totalListings: 0,  // 総出品数
  todayListings: 0,  // 今日の出品数
  weekListings: 0,   // 今週の出品数
  lastListingDate: null,  // 最後の出品日時
  optimizeCount: 0,  // 最適化使用回数
  lastResetDate: Date.now()  // 最後のリセット日時
} */

async function loadStatistics() {
  try {
    const data = await chrome.storage.local.get([KEY_STATS]);
    let stats = data?.[KEY_STATS];
    
    if (!stats || typeof stats !== 'object') {
      // 初期化
      stats = {
        totalListings: 0,
        todayListings: 0,
        weekListings: 0,
        lastListingDate: null,
        optimizeCount: 0,
        lastResetDate: Date.now()
      };
    }
    
    // 日付が変わったらtodayListingsをリセット
    const today = new Date().toDateString();
    const lastDate = stats.lastListingDate ? new Date(stats.lastListingDate).toDateString() : null;
    if (lastDate !== today) {
      stats.todayListings = 0;
    }
    
    // 週が変わったらweekListingsをリセット
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    if (!stats.lastListingDate || stats.lastListingDate < weekAgo) {
      stats.weekListings = 0;
    }
    
    return stats;
  } catch (err) {
    console.error('[LFP] loadStatistics error:', err);
    return {
      totalListings: 0,
      todayListings: 0,
      weekListings: 0,
      lastListingDate: null,
      optimizeCount: 0,
      lastResetDate: Date.now()
    };
  }
}

async function saveStatistics(stats) {
  try {
    await chrome.storage.local.set({ [KEY_STATS]: stats });
  } catch (err) {
    console.error('[LFP] saveStatistics error:', err);
  }
}

async function incrementListingCount() {
  try {
    const stats = await loadStatistics();
    stats.totalListings++;
    stats.todayListings++;
    stats.weekListings++;
    stats.lastListingDate = Date.now();
    await saveStatistics(stats);
    console.log(`📊 [Stats] 出品数を更新: 総計${stats.totalListings}件, 今日${stats.todayListings}件, 今週${stats.weekListings}件`);
  } catch (err) {
    console.error('[LFP] incrementListingCount error:', err);
    // エラーが発生しても処理を継続
  }
}

async function incrementOptimizeCount() {
  try {
    const stats = await loadStatistics();
    stats.optimizeCount++;
    await saveStatistics(stats);
    console.log(`📊 [Stats] 最適化回数を更新: ${stats.optimizeCount}回`);
  } catch (err) {
    console.error('[LFP] incrementOptimizeCount error:', err);
    // エラーが発生しても処理を継続
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
      
      // 100件を超えた場合は古いものから削除
      await chrome.storage.local.set({ [KEY_HIST]: filtered.slice(0, 100) });
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

function findTitleFieldSmart() {
  let el = findLabelInput(/^(Title|Item Title|タイトル|商品タイトル)$/i);
  if (el) return el;

  const cands = Array.from(document.querySelectorAll("input[type='text'], textarea, [contenteditable='true']"))
    .filter(x => x && x.offsetParent !== null && !x.disabled);

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
  quickMipBtn: null
};

function destroyMainUI() {
  if (UI.root && UI.root.isConnected) UI.root.remove();
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
  UI.btnOpt.disabled = isBusy;
  
  // 最適化中の表示
  if (isBusy) {
    if (UI.btnLabel) UI.btnLabel.textContent = "最適化中";
    if (UI.spin) UI.spin.style.display = "inline-block";
  } else {
    // 最適化完了時の表示：needsRetryに応じて「最適化」または「再実行」
    if (UI.btnLabel) UI.btnLabel.textContent = STORE.optimizeState.needsRetry ? "再実行" : "最適化";
    if (UI.spin) UI.spin.style.display = "none";
  }
}

function setStatusLine(len, veroCount, shipText, highlight) {
  if (!UI.status) return;
  UI.status.textContent = `文字数：${len} / Vero：${veroCount} / 出品：${shipText}`;
  if (UI.btnOpt && STORE.opt.highlightOptimize) UI.btnOpt.classList.toggle("highlight", !!highlight);
}

function setBadge(text) {
  if (!UI.badge) return;
  UI.badge.textContent = text || "";
}

function resetUIState() {
  setBadge("");
  if (UI.btnOpt) UI.btnOpt.disabled = false;
  if (UI.btnOpt) UI.btnOpt.classList.remove("highlight");
  // 最適化状態をリセット
  STORE.optimizeState.needsRetry = false;
  if (UI.btnLabel) UI.btnLabel.textContent = "最適化";
}

/* ---------- Quick MIP ---------- */

function findRealMipButton() {
  return document.querySelector("#mip-list-item-btn") || null;
}

function fixMipButtonBgCover() {
  // 本物のMIPボタン（Yaballe側）
  const real = document.querySelector("#mip-list-item-btn");
  if (real) {
    const span = real.querySelector("span");
    let icon = real.querySelector("i.glyph-icon.icon-linecons-paper-plane");
    if (!icon) icon = real.querySelector("i");

    // 背景がspanに乗っていて、iconがspan外にあると途中で背景が切れる
    // なのでiconをspan内に移動して背景の「カバー範囲」を自然に伸ばす
    if (span && icon && icon.parentElement !== span) {
      try {
        // nbsp等のテキストノードが間にあっても崩れないように軽く整形
        const kids = Array.from(real.childNodes || []);
        for (const n of kids) {
          if (n && n.nodeType === 3) {
            const t = (n.nodeValue || "").replace(/\u00a0/g, " ");
            n.nodeValue = t;
          }
        }
      } catch (_) { }

      span.appendChild(icon);
    }

    // 角丸は既存スタイルを維持し、配置だけ整える
    if (span) {
      span.style.display = "inline-flex";
      span.style.alignItems = "center";
      span.style.gap = "10px";
    }
  }

  // Quick MIP（拡張側）
  const quick = document.querySelector("#lfp-quick-mip");
  if (quick) {
    const sp = quick.querySelector("span");
    if (sp) {
      sp.style.display = "inline-flex";
      sp.style.alignItems = "center";
      sp.style.gap = "10px";
    }
  }
}

// Quick MIP（拡張側）
const quick = document.querySelector("#lfp-quick-mip");
if (quick) {
  const sp = quick.querySelector("span");
  if (sp) {
    sp.style.display = "inline-flex";
    sp.style.alignItems = "center";
    sp.style.gap = "10px";
  }
}



function clickRealMipButton() {
  const real = findRealMipButton();
  if (!real) return false;
  const aria = real.getAttribute("aria-disabled");
  if (aria === "true") return false;
  if (real.hasAttribute("disabled")) return false;
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

async function callOpenAI({ apiKey, model, messages }) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`
    },
    body: JSON.stringify({ model, temperature: 0.2, messages })
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`OpenAI APIエラー: ${res.status} ${res.statusText} ${txt}`.slice(0, 400));
  }

  const data = await res.json();
  return data?.choices?.[0]?.message?.content ?? "";
}

function buildOptimizePrompt({ title, desc, forbiddenTerms, targetLen, tryNum, prevOutput, prevLen }) {
  const forb = forbiddenTerms.length ? forbiddenTerms.join(", ") : "(none)";
  
  let sys = [
    "You are a high-speed and high-accuracy eBay product title optimization engine.",
    "Return exactly ONE optimized English title only (single line).",
    `Target length: ${targetLen} characters (must be 70–80 characters inclusive).`,
    "SEO-first, buyer-oriented, concise, natural phrasing.",
    "No brand names unless explicitly present in the input title/description.",
    "Avoid claims: genuine, official, certified, OEM, warranty.",
    "Never include any extra lines, counts, labels, quotes, or punctuation-only output.",
    `CRITICAL: Forbidden terms (must NEVER appear, case-insensitive): ${forb}`,
    "If any forbidden term appears in the input, REMOVE it completely from the output.",
    "If you detect a forbidden term might appear, remove it and optimize naturally."
  ];
  
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
  const title = readText(titleEl);
  const len = (title || "").length;

  const block = extractWarningBlockText();
  const terms = parseVeroTerms(block);
  const titleTerms = terms.filter(t => t.kind === "title");
  const matchers = buildVeroMatchers(titleTerms);
  
  // 判定用のveroCount（従来通り）
  const veroCountForCheck = STORE.opt.veroEnabled ? countVeroInText(title, matchers) : 0;

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

  // 表示用のveroCount（案A''）
  let veroCountForDisplay = veroCountForCheck;
  
  // Vero Warnings: title: のチェック（案7）
  let hasTitleVeroWarning = false;
  const fullText = block || "";
  const veroTitleMatch = fullText.match(/Vero Warnings:[\s\S]*?title:\s*(.+?)(?:\n|$)/i);
  if (veroTitleMatch) {
    const veroWords = veroTitleMatch[1].trim().split(/\s+/);
    const currentTitle = (title || "").toLowerCase();
    
    // title: 内の単語がタイトルに含まれている数をカウント（表示用）
    const titleVeroCount = veroWords.filter(word => 
      currentTitle.includes(word.toLowerCase())
    ).length;
    
    veroCountForDisplay += titleVeroCount;  // 表示用のみ加算
    
    // すべてのVero単語がタイトルに含まれているかチェック（判定用）
    const allVeroWordsPresent = veroWords.every(word => 
      currentTitle.includes(word.toLowerCase())
    );
    
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
      const remainingWords = veroWords.filter(word => 
        currentTitle.includes(word.toLowerCase())
      );
      hasTitleVeroWarning = false;
      console.log(`✅ [Vero Title] 最適化済み。残っている単語: ${remainingWords.join(', ')}`);
    }
  }

  let shipText = "-";
  let highlight = false;

  if (reasons.length) {
    shipText = `NG（${reasons.join(" / ")}）`;
  } else {
    if (len >= 70 && len <= 80 && veroCountForCheck === 0 && !hasTitleVeroWarning) {
      shipText = "OK";
      highlight = false;
    } else {
      shipText = "OK（最適化後）";
      highlight = true;
    }
  }
  
  // 修正: ボタンのdisabled制御を撤廃し、常にクリック可能にする
  if (UI.btnOpt) UI.btnOpt.disabled = false;

  setStatusLine(len, veroCountForDisplay, shipText, highlight);

  // Quick MIPボタンの表示・有効化制御：常に表示、「出品：OK」の時のみクリック可能
  if (STORE.opt.quickMipButton && btnGet) {
    // MIPボタンが存在しない場合は生成
    if (!UI.quickMipBtn || !UI.quickMipBtn.isConnected) {
      ensureQuickMipButton(btnGet);
    }
    
    if (UI.quickMipBtn) {
      const shouldEnable = (reasons.length === 0 && len >= 70 && len <= 80 && veroCountForCheck === 0 && !hasTitleVeroWarning);
      UI.quickMipBtn.style.display = "inline-flex";
      UI.quickMipBtn.disabled = !shouldEnable;
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
      prevLen: prevLen
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
      setBadge((e?.message || "最適化に失敗").slice(0, 160));
      STORE.optimizeState.needsRetry = false;  // エラー時はリセット
      setBusy(false);
      return;
    }
  }

  if (finalTitle) {
    setInputValue(titleEl, finalTitle);
    await sleep(120);
    const btnGet = findButtonByText(/^Get Item$/i);
    await evaluateAndRender({ titleEl, btnGet });

    // ターボモード時は、evaluateAndRenderの結果（MutationObserver経由）で
    // 自然にMIPクリックが誘発されるため、ここでの明示的なclick()は二重実行を避けるため廃止。
  }

  // 最終的に70〜80文字に収束したかどうかで状態を切り替え
  if (!(finalLen >= 70 && finalLen <= 80)) {
    // 収束失敗：「再実行」表示に切り替え
    STORE.optimizeState.needsRetry = true;
    setBadge("70〜80文字に収束しない。「再実行」を押すか手動調整してください。");
    setBusy(false);
    return;
  } else {
    // 収束成功：「最適化」表示に戻す
    STORE.optimizeState.needsRetry = false;
    // 統計情報を更新
    await incrementOptimizeCount();
  }

  if (STORE.opt.autoMipAfterOptimize) {
    if (finalLen >= 70 && finalLen <= 80 && finalVero === 0) {
      await sleep(250);
      clickRealMipButton();
    }
  }

  setBusy(false);
  } finally {
    optimizeRunning = false;
  }
}

/* ---------- State control: show UI only after Get Item populated Title ---------- */

let uiUnlocked = false;
let lastPasteAt = 0;

function lockUI() {
  uiUnlocked = false;
  destroyMainUI();
  removeQuickMipButton();
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
}

function wireOptimizeButton(titleEl) {
  if (!UI.btnOpt) return;
  if (UI.btnOpt.dataset.lfpWired) return;
  UI.btnOpt.dataset.lfpWired = "1";
  UI.btnOpt.addEventListener("click", async () => onOptimizeClick({ titleEl }));
}

/* ---------- History UI ---------- */

async function refreshHistorySelect() {
  if (!UI.histSel || !UI.histSel.isConnected) return;
  const hist = await loadHistory();
  
  // 件数カウントを表示
  const count = hist.length;
  const maxCount = 100;
  
  // 既存のselectを更新（件数カウント付き）
  UI.histSel.innerHTML = `<option value="">ASIN履歴（直近100件） ${count}/${maxCount}</option>`;
  for (const entry of hist) {
    const opt = document.createElement("option");
    opt.value = entry.asin;
    opt.textContent = entry.asin;
    UI.histSel.appendChild(opt);
  }
  
  // カスタムドロップダウンを更新
  refreshCustomDropdown(hist);
}

function refreshCustomDropdown(hist) {
  if (!UI.histSel || !UI.histSel.isConnected) return;
  
  // 既存のカスタムドロップダウンを削除
  const existingDropdown = document.getElementById('lfp-custom-dropdown');
  if (existingDropdown) existingDropdown.remove();
  
  // カスタムドロップダウンを作成
  const dropdown = document.createElement('div');
  dropdown.id = 'lfp-custom-dropdown';
  dropdown.className = 'lfp-custom-dropdown';
  dropdown.style.display = 'none';
  
  // プレースホルダーは削除（ASINを上に詰める）
  
  // 履歴アイテム
  for (const entry of hist) {
    const itemWrapper = document.createElement('div');
    itemWrapper.className = 'lfp-dropdown-item-wrapper';
    
    const item = document.createElement('div');
    item.className = 'lfp-dropdown-item';
    item.dataset.asin = entry.asin;
    
    // フラグに応じて表示を変える
    let displayText = entry.asin;
    let isBad = false;
    
    // no_listingsフラグが立っている場合は最優先で表示
    if (entry.flags.no_listings) {
      displayText = `! ${entry.asin} No listings`;
      isBad = true;
    } else {
      // 複数のフラグを配列で収集
      const flagLabels = [];
      if (entry.flags.protected) flagLabels.push("protected");
      if (entry.flags.already_listed) flagLabels.push("already_listed");
      if (entry.flags.brand) flagLabels.push("brand");
      
      if (flagLabels.length > 0) {
        displayText = `× ${entry.asin} ${flagLabels.join(" / ")}`;
        isBad = true;
      }
    }
    
    item.textContent = displayText;
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
      await deleteHistoryItemFromContent(entry.asin);
      await refreshHistorySelect();
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
  
  const statusText = UI.status?.textContent || "";
  
  // 1. 最適化が必要な場合（かつ、まだ自動最適化していない場合）
  if (statusText.includes("出品：OK（最適化後）")) {
    if (UI.btnOpt && !UI.btnOpt.disabled && !optimizeRunning && !STORE.turboExecuted.optimize) {
      console.log("[LFP] Turbo: 自動最適化ボタンをクリック");
      STORE.turboExecuted.optimize = true; // 実行済みフラグを立てる
      UI.btnOpt.click();
    }
  } 
  // 2. 出品可能な場合（かつ、まだ自動MIPしていない場合）
  else if (statusText.includes("出品：OK")) {
    // "出品：OK（最適化後）" にマッチしないように厳密に判定
    if (statusText.trim().endsWith("出品：OK") || statusText.includes("出品：OK /")) {
      if (UI.quickMipBtn && !UI.quickMipBtn.disabled && !STORE.turboExecuted.mip) {
        console.log("[LFP] Turbo: 自動MIPボタンをクリック");
        STORE.turboExecuted.mip = true; // 実行済みフラグを先に立てる
        UI.quickMipBtn.click();
      }
    }
  }
}



let initRunning = false;

async function init() {
  if (initRunning) return;
  initRunning = true;

  try {

    // MIPボタンの背景が紙飛行機までカバーするようDOMを整形
    fixMipButtonBgCover();
    await loadOptions();
    if (!isListerRoute()) { lockUI(); return; }

    const btnGet = findButtonByText(/^Get Item$/i);
    const asinInput = findAsinInputSmart(btnGet);
    const titleEl = findTitleFieldSmart();

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
        if (confirm("ASIN履歴をすべて削除しますか？")) {
          try {
            await resetHistory();
            // 履歴削除後、即座にドロップダウンを更新
            await refreshHistorySelect();
            alert("ASIN履歴を削除しました");
          } catch (err) {
            console.error('履歴削除エラー:', err);
            alert("履歴削除中にエラーが発生しました。ページをリロードしてください。");
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

      asinInput.parentElement?.insertBefore(bar, asinInput);

      UI.asinBar = bar;
      UI.histSel = sel;

      await refreshHistorySelect();

      // コピーボタンのイベント（スプレッドシート用2カラム形式）
      copyBtn.addEventListener("click", async () => {
        const hist = await loadHistory();
        if (hist.length === 0) {
          alert("コピーする履歴がありません");
          return;
        }
        
        // 履歴を反転（古い順）させてから、スプレッドシート用の2カラム（出品日、エラー日）を作成
        const copyText = [...hist].reverse().map(item => {
          const date = item.lastSeen ? new Date(item.lastSeen) : new Date();
          const dateStr = `${date.getMonth() + 1}/${date.getDate()}`;
          
          let dateCol1 = dateStr; // 出品日
          let dateCol2 = '　';     // エラーにより出品不可（空白の場合は全角スペース）
          
          if (item.flags?.protected || item.flags?.brand || item.flags?.already_listed || item.flags?.no_listings) {
            dateCol1 = '　';       // 空白の場合は全角スペース
            dateCol2 = dateStr;
          }
          return `${dateCol1}\t${dateCol2}`;
        }).join("\n");

        navigator.clipboard.writeText(copyText).then(() => {
          const originalText = copyBtn.textContent;
          copyBtn.textContent = "✅ コピー完了！";
          setTimeout(() => {
            copyBtn.textContent = originalText;
          }, 2000);
        });
      });

      // CSV出力ボタンのイベント（スプレッドシート用2カラム形式）
      csvBtn.addEventListener("click", async () => {
        const hist = await loadHistory();
        if (hist.length === 0) {
          alert("出力する履歴がありません");
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
          else if (item.flags?.protected) result = 'Protected';
          else if (item.flags?.brand) result = 'Brand';
          else if (item.flags?.already_listed) result = 'Already listed';
          
          let dateCol1 = dateStr; // 出品日
          let dateCol2 = ' ';     // エラー日（空白の場合はスペース）
          
          if (item.flags?.protected || item.flags?.brand || item.flags?.already_listed || item.flags?.no_listings) {
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
      else removeQuickMipButton();

      scheduleEvaluate(async () => {
        await evaluateAndRender({ titleEl, btnGet });
      }, 50);  // ラグ解消のため遅延を短縮

      if (!titleNow) lockUI();
    } else {
      destroyMainUI();
      // MIPボタンを常時表示（初期状態はグレーアウト）
      if (STORE.opt.quickMipButton && btnGet) ensureQuickMipButton(btnGet);
      else removeQuickMipButton();

      if (titleNow) {
        unlockUI(titleEl);
        await sleep(30);
        await evaluateAndRender({ titleEl, btnGet });
      }
    }

    if (btnGet && !btnGet.dataset.lfpWired) {
      btnGet.dataset.lfpWired = "1";
      btnGet.addEventListener("click", async () => {
        // 前回の判定結果が残らないように毎回リセット
        resetUIState();
        
        // 前回のタイトルを記録（画面更新検出用）
        let t = findTitleFieldSmart();
        if (t) {
          STORE.lastTitle = normSpace(readText(t));
        }
        
        // 最後にリクエストしたASINを記録（No listingsモーダル検出用）
        const asin = normSpace(asinInput?.value || "");
        if (asin) {
          STORE.lastRequestedAsin = asin;
          // 各種フラグをリセット（新しい商品の取得開始）
          STORE.turboExecuted.optimize = false;
          STORE.turboExecuted.mip = false;
          okButtonClicked = false; // OKボタンクリック済みフラグもリセット
          // Get Itemクリック時に履歴に保存（１件目から確実に反映）
          await saveHistoryPush(asin);
          // 前回のフラグをクリア（Get Item成功時に前回の情報が残らないように）
          await updateHistoryFlags(asin, {
            protected: false,
            brand: false,
            already_listed: false,
            no_listings: false
          });
          await refreshHistorySelect();
        }

        await sleep(250);
        t = findTitleFieldSmart();
        if (!t) { lockUI(); return; }
        const tv = normSpace(readText(t));
        if (!tv) { lockUI(); return; }

      unlockUI(t);
      await evaluateAndRender({ titleEl: t, btnGet });

      // 最速出品モードの自動実行判定
      if (STORE.opt.turboListingMode) {
        handleTurboListing(t, btnGet);
      }

      if (STORE.opt.quickMipButton && btnGet) ensureQuickMipButton(btnGet);
        else removeQuickMipButton();
      }, true);
    }

    if (asinInput && !asinInput.dataset.lfpWired) {
      asinInput.dataset.lfpWired = "1";
      
      // クリック/フォーカス時にUIを復旧させる
      const handleAsinFocus = async () => {
        // UIが存在しない、または接続されていない場合に初期化をスケジュール
        if (!UI.asinBar || !UI.asinBar.isConnected) {
          console.log('🎯 [LFP] ASIN入力欄の操作を検知。UIの復旧を試みます。');
          scheduleInit();
        }
      };
      
      asinInput.addEventListener("click", handleAsinFocus);
      asinInput.addEventListener("focus", handleAsinFocus);

      // ペースト時の自動実行
      asinInput.addEventListener("paste", async () => {
        if (!STORE.opt.autoGetOnPaste) return;
        const t = now();
        if (t - lastPasteAt < 800) return;
        lastPasteAt = t;

        lockUI();
        await sleep(60);
        btnGet?.click();
      });
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
    }
    
    // 各種Observerの初期化（初回のみ）
    if (!observersInitialized) {
      setupNoListingsObserver();
      setupListingSuccessObserver();
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
function setupNoListingsObserver() {
  if (noListingsObserver) return; // 既に初期化済み
  noListingsObserver = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        
        // モーダルの検出（Yaballeのモーダル構造を想定）
        const modal = node.matches('.modal, [role="dialog"]') ? node : node.querySelector('.modal, [role="dialog"]');
        if (!modal) continue;
        
        // 自前UIの文字列は除外（誤検出防止）
        if (modal.dataset.lfpModal) continue;
        
        // モーダル内のテキストを確認
        const modalText = modal.textContent || '';
        // 2パターンのエラーメッセージに対応
        const isNoListings = modalText.includes('There are currently no listings for this product in amazon.') ||
                             modalText.includes('There are currently no listings for this product in amazon or could not fetch details about the product.');
        
        if (isNoListings) {
          // No listingsモーダルを検出
          if (STORE.lastRequestedAsin) {
            // No listingsが検出された場合、他のフラグを全てクリアしてno_listingsのみを設定
            updateHistoryFlags(STORE.lastRequestedAsin, { 
              no_listings: true,
              protected: false,
              brand: false,
              already_listed: false
            }).then(() => {
              refreshHistorySelect();
            });
          }
        }
      }
    }
  });
  
  noListingsObserver.observe(document.body, {
    childList: true,
    subtree: true
  });
}

/* Listing SuccessモーダルのOKボタン自動クリック */
let okButtonClicked = false;

function setupListingSuccessObserver() {
  if (listingSuccessObserver) return; // 既に初期化済み
  listingSuccessObserver = new MutationObserver((mutations) => {
    // オプションがOFFなら何もしない
    if (!STORE.opt.autoClickOkAfterMip) return;
    
    // 連打防止
    if (okButtonClicked) return;
    
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        
        // モーダルの検出
        const modal = node.matches('.modal, [role="dialog"]') ? node : node.querySelector('.modal, [role="dialog"]');
        if (!modal) continue;
        
        // 自前UIの文字列は除外（誤検出防止）
        if (modal.dataset.lfpModal) continue;
        
        // モーダル内のテキストを確認
        const modalText = modal.textContent || '';
        const isListingSuccess = modalText.includes('Listing Success');
        
        if (isListingSuccess) {
          console.log('✅ [Auto OK] Listing Successモーダルを検出しました');
          
          // OKボタンを検出
          const okButton = Array.from(modal.querySelectorAll('button')).find(btn => 
            btn.textContent.trim().toLowerCase() === 'ok'
          );
          
          if (okButton) {
            // 連打防止フラグをセット
            okButtonClicked = true;
            
            // 既存のインターバルをクリア（クリーンアップ）
            if (okButtonCheckInterval) {
              clearInterval(okButtonCheckInterval);
              okButtonCheckInterval = null;
            }
            
            // MIP後のOKボタンを100ms間隔で確認し、見つかったら即座にクリック（最大3秒）
            let checkCount = 0;
            const maxChecks = 30;  // 30回×100ms = 3秒
            okButtonCheckInterval = setInterval(async () => {
              checkCount++;
              
              // OKボタンを再検索（モーダルが再レンダリングされる可能性があるため）
              const currentModal = document.querySelector('.modal, [role="dialog"]');
              if (!currentModal || currentModal.dataset.lfpModal) {
                if (checkCount >= maxChecks) {
                  clearInterval(okButtonCheckInterval);
                  okButtonCheckInterval = null;
                  okButtonClicked = false;
                  console.log('⚠️ [Auto OK] OKボタンが見つかりませんでした');
                }
                return;
              }
              
              const currentOkButton = Array.from(currentModal.querySelectorAll('button')).find(btn => 
                btn.textContent.trim().toLowerCase() === 'ok'
              );
              
              if (currentOkButton && currentOkButton.offsetParent !== null && okButtonClicked) {
                // OKボタンが表示されている（offsetParent !== nullは表示中を意味する）
                // 既にokButtonClickedがtrueの場合にのみ1度だけ実行
                clearInterval(okButtonCheckInterval);
                okButtonCheckInterval = null;
                okButtonClicked = false; // 次回のためにリセット（またはGet Itemでリセット）
                
                // クリック
                currentOkButton.click();
                console.log(`✅ [Auto OK] OKボタンを自動クリックしました（${checkCount * 100}ms後）`);
                
                // 統計情報を更新
                await incrementListingCount();
                
                // バッジ通知（オプション）
                setBadge('✅ 出品完了');
                setTimeout(() => setBadge(''), 2000);
                
                // 出品後の自動リフレッシュ後に拡張機能を再初期化
                // （ページリロードと競合するためコメントアウト）
                // setTimeout(() => {
                //   console.log('🔄 [出品後] 拡張機能を再初期化します');
                //   scheduleInit();
                // }, 2000);  // 2秒後に再初期化
                
                // 5秒後にフラグをリセット（次の出品のため）
                setTimeout(() => {
                  okButtonClicked = false;
                }, 5000);
              } else if (checkCount >= maxChecks) {
                // 3秒経過しても見つからない
                clearInterval(okButtonCheckInterval);
                okButtonCheckInterval = null;
                okButtonClicked = false;
                console.log('⚠️ [Auto OK] OKボタンが3秒以内に見つかりませんでした');
              }
            }, 100);  // 100ms間隔で確認
          }
        }
      }
    }
  });
  
  listingSuccessObserver.observe(document.body, {
    childList: true,
    subtree: true
  });
}

/* ---------- Route ---------- */

let routeTimer = null;
function scheduleInit() {
  if (routeTimer) clearTimeout(routeTimer);
  routeTimer = setTimeout(() => { init().catch(() => { }); }, 250);
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
  
  try{ lfpApplyMipCompactLabel(); }catch(_){}
  scheduleInit();
});

scheduleInit();

/* LFP MIP COMPACT PATCH START */
function lfpCompactMipLabelFor(el){
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

function lfpApplyMipCompactLabel(){
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
    
    // エクステンションコンテキストの有効性をチェック
    if (!isExtensionContextValid()) {
      console.log('⚠️ [Focus Recovery] エクステンションコンテキストが無効です。リカバリーを試行します。');
      await attemptRecovery();
      return;
    }
    
    // Listerページでない場合は何もしない
    if (!isListerRoute()) return;
    
    // UIが存在するかチェック
    const uiExists = document.querySelector('.lfp-ui');
    const titleEl = findTitleFieldSmart();
    
    if (!uiExists && titleEl) {
      // UIが消えている場合は再初期化
      console.log('⚠️ [Focus Recovery] UIが消えています。再初期化します。');
      resetAllFlags();
      observersInitialized = false;
      await sleep(300);
      scheduleInit();
    } else if (uiExists) {
      // UIは存在するが、オプションを再読み込み
      await loadOptions();
      console.log('✅ [Focus Recovery] オプションを再読み込みしました');
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
    // Listerページでない場合はスキップ
    if (!isListerRoute()) return;
    
    // エクステンションコンテキストの有効性をチェック
    if (!isExtensionContextValid()) {
      console.log('⚠️ [Health Check] エクステンションコンテキストが無効です');
      await attemptRecovery();
      return;
    }
    
    // UIが存在するかチェック
    const uiExists = document.querySelector('.lfp-ui');
    const titleEl = findTitleFieldSmart();
    
    if (!uiExists && titleEl) {
      // UIが消えている場合は再初期化
      console.log('⚠️ [Health Check] UIが消えています。再初期化します。');
      resetAllFlags();
      observersInitialized = false;
      scheduleInit();
    }
    
    // フラグのスタック検出（5秒以上フラグが立ったままの場合はリセット）
    // Note: この機能は将来的に追加可能
    
  }, 30000); // 30秒ごと
}

// ヘルスチェックを開始
startHealthCheck();

console.log('✅ [LFP] ListerFlow Pro v1.1.1 が読み込まれました');
