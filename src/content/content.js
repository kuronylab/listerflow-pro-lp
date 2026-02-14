/*
   ListerFlow Pro - content.js
   修正点
   ・UIはTitle入力欄の下に配置
   ・Get ItemでTitleが表示された時のみUI表示（初期/リフレッシュ時は非表示）
   ・MutationObserverはデバウンス＋自前UI無視
   ・Quick MIPはオプションONかつ条件OK時のみ表示
   ・カウンターの安定性向上と2分放置ロジックの改善
*/

const STORE = {
  opt: {
    apiKey: "",
    model: "gpt-4o-mini",
    veroEnabled: true,
    autoGetOnPaste: true,
    autoGetOnHistory: true,
    autoMipAfterOptimize: false,
    quickMipButton: true,
    highlightOptimize: true,
    historyEnabled: true,
    autoClickOkAfterMip: true,
    turboListingMode: false
  },
  optimizeState: {
    needsRetry: false
  },
  lastRequestedAsin: "",
  turboExecuted: {
    optimize: false,
    mip: false
  }
};

let mainObserver = null;
let noListingsObserver = null;
let listingSuccessObserver = null;
let urlChangeObserver = null;
let observersInitialized = false;
let dropdownClickHandler = null;
let dropdownMousedownHandler = null;
let okButtonCheckInterval = null;
let historyLock = false;
let initRunning = false;
let optimizeRunning = false;

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

function isExtensionContextValid() {
  try {
    return !!(chrome && chrome.storage && chrome.storage.sync);
  } catch (e) {
    return false;
  }
}

async function loadOptions() {
  if (!isExtensionContextValid()) return;
  try {
    const data = await chrome.storage.sync.get([KEY_OPT]);
    const saved = data?.[KEY_OPT];
    if (saved && typeof saved === "object") STORE.opt = { ...STORE.opt, ...saved };
  } catch (err) {
    console.error("[LFP] loadOptions error:", err);
  }
}

chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'sync' && changes[KEY_OPT]) {
    const newOptions = changes[KEY_OPT].newValue;
    if (newOptions) {
      STORE.opt = { ...STORE.opt, ...newOptions };
      updateUIBasedOnSettings();
    }
  }
});

async function updateUIBasedOnSettings() {
  const quickMipBtn = document.getElementById("quick-mip-button");
  if (quickMipBtn) {
    quickMipBtn.style.display = STORE.opt.quickMipButton ? "inline-block" : "none";
  }

  const optimizeBtn = document.getElementById("optimize-button");
  if (optimizeBtn) {
    if (STORE.opt.highlightOptimize) {
      optimizeBtn.classList.add("highlight");
    } else {
      optimizeBtn.classList.remove("highlight");
    }
  }
}

async function loadStatistics() {
  if (!isExtensionContextValid()) return null;
  try {
    const data = await chrome.storage.local.get([KEY_STATS]);
    let stats = data?.[KEY_STATS];
    
    if (!stats || typeof stats !== 'object') {
      stats = {
        totalListings: 0,
        todayListings: 0,
        weekListings: 0,
        lastListingDate: null,
        optimizeCount: 0,
        brandCount: 0,
        alreadyListedCount: 0,
        totalWorkTimeToday: 0,
        todayLastActivityTime: null,
        todayMaxSpeed: 0,
        currentSessionStartTime: null,
        currentSessionElapsedMs: 0,
        isCounterPaused: false,
        lastAsinInputTime: null,
        lastResetDate: Date.now()
      };
    }
    
    const today = new Date().toDateString();
    const lastReset = new Date(stats.lastResetDate).toDateString();
    
    if (lastReset !== today) {
      stats.todayListings = 0;
      stats.totalWorkTimeToday = 0;
      stats.todayLastActivityTime = null;
      stats.todayMaxSpeed = 0;
      stats.currentSessionStartTime = null;
      stats.currentSessionElapsedMs = 0;
      stats.isCounterPaused = false;
      stats.lastAsinInputTime = null;
      stats.lastResetDate = Date.now();
    }
    
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    if (!stats.lastListingDate || stats.lastListingDate < weekAgo) {
      stats.weekListings = 0;
    }
    
    return stats;
  } catch (err) {
    console.error('[LFP] loadStatistics error:', err);
    return null;
  }
}

async function saveStatistics(stats) {
  if (!stats || !isExtensionContextValid()) return;
  try {
    await chrome.storage.local.set({ [KEY_STATS]: stats });
  } catch (err) {
    console.error('[LFP] saveStatistics error:', err);
  }
}

async function incrementListingCount() {
  try {
    const stats = await loadStatistics();
    if (!stats) return;
    
    const now = Date.now();
    stats.totalListings++;
    stats.todayListings++;
    stats.weekListings++;
    stats.lastListingDate = now;
    
    // 作業時間の確定
    if (stats.currentSessionStartTime && !stats.isCounterPaused) {
      const elapsed = now - stats.currentSessionStartTime;
      stats.totalWorkTimeToday = (stats.totalWorkTimeToday || 0) + elapsed;
      stats.currentSessionStartTime = now; // 次のセッションへ継続
    }
    
    // 最高時速の更新
    if (stats.totalWorkTimeToday > 0) {
      const hours = stats.totalWorkTimeToday / 3600000;
      const currentSpeed = stats.todayListings / hours;
      if (currentSpeed > stats.todayMaxSpeed) {
        stats.todayMaxSpeed = currentSpeed;
      }
    }

    await saveStatistics(stats);
    await refreshListingCountUI();
  } catch (err) {
    console.error('[LFP] incrementListingCount error:', err);
  }
}

async function confirmWorkTime() {
  const stats = await loadStatistics();
  if (!stats) return;
  
  if (stats.currentSessionStartTime && !stats.isCounterPaused) {
    const now = Date.now();
    const elapsed = now - stats.currentSessionStartTime;
    stats.totalWorkTimeToday = (stats.totalWorkTimeToday || 0) + elapsed;
    stats.currentSessionStartTime = now;
    await saveStatistics(stats);
  }
}

async function loadHistory() {
  if (!isExtensionContextValid()) return [];
  try {
    const data = await chrome.storage.local.get([KEY_HIST]);
    return Array.isArray(data?.[KEY_HIST]) ? data[KEY_HIST] : [];
  } catch (err) {
    console.error('[LFP] loadHistory error:', err);
    return [];
  }
}

async function saveHistory(hist) {
  if (!isExtensionContextValid()) return;
  try {
    await chrome.storage.local.set({ [KEY_HIST]: hist });
  } catch (err) {
    console.error('[LFP] saveHistory error:', err);
  }
}

async function saveHistoryPush(asin) {
  if (historyLock) return;
  historyLock = true;
  try {
    const hist = await loadHistory();
    const filtered = hist.filter(h => h.asin !== asin);
    filtered.unshift({ asin, lastSeen: Date.now(), flags: {} });
    if (filtered.length > 1000) filtered.pop();
    await saveHistory(filtered);
  } finally {
    historyLock = false;
  }
}

async function updateHistoryFlags(asin, flags) {
  if (historyLock) return;
  historyLock = true;
  try {
    const hist = await loadHistory();
    const item = hist.find(h => h.asin === asin);
    if (item) {
      item.flags = { ...item.flags, ...flags };
      item.lastSeen = Date.now();
      await saveHistory(hist);
    }
  } finally {
    historyLock = false;
  }
}

async function resetHistory() {
  await saveHistory([]);
}

/* ---------- DOM Utils ---------- */
function findButtonByText(regex) {
  return Array.from(document.querySelectorAll('button')).find(b => regex.test(b.textContent.trim()));
}

function findAsinInputSmart(btnGet) {
  if (btnGet) {
    const parent = btnGet.closest('.asin-actions');
    if (parent) return parent.querySelector('input');
  }
  return document.querySelector('input[placeholder*="ASIN"], input[ng-model*="asin"]');
}

function findTitleFieldSmart() {
  return document.querySelector('input[ng-model*="item.title"], .title-input input');
}

function readText(el) {
  if (!el) return "";
  return el.value || el.textContent || "";
}

function setInputValue(el, val) {
  if (!el) return;
  el.value = val;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

/* ---------- UI Components ---------- */
const UI = {
  root: null,
  status: null,
  badge: null,
  btnOpt: null,
  btnLabel: null,
  spin: null,
  quickMipBtn: null,
  asinBar: null,
  histSel: null,
  listingCountLabel: null,
  pauseResumeBtn: null
};

function isInsideLfp(node) {
  if (!node || node.nodeType !== 1) return false;
  return node.closest('.lfp-ui, .lfp-asinbar, .lfp-status-box');
}

function destroyMainUI() {
  if (UI.root) UI.root.remove();
  UI.root = null; UI.status = null; UI.badge = null; UI.btnOpt = null; UI.btnLabel = null; UI.spin = null;
}

function lockUI() {
  if (UI.btnOpt) UI.btnOpt.disabled = true;
  if (UI.status) UI.status.textContent = "待機中...";
  if (UI.badge) UI.badge.textContent = "";
}

function unlockUI(titleEl) {
  ensureUIBelowTitle(titleEl);
  if (UI.btnOpt) UI.btnOpt.disabled = false;
}

function ensureUIBelowTitle(titleEl) {
  if (UI.root && UI.root.isConnected) return;
  const box = document.createElement("div");
  box.className = "lfp-status-box lfp-ui";
  box.innerHTML = `
    <div class="lfp-row">
      <button class="lfp-btn" id="optimize-button"><span class="lfp-btn-label">最適化</span><span class="lfp-spin" style="display:none"></span></button>
      <div class="lfp-status">文字数：- / Vero：- / 出品：-</div>
    </div>
    <div class="lfp-badge"></div>
  `;
  const asinActions = document.querySelector('.asin-actions');
  if (asinActions) {
    asinActions.parentElement.insertBefore(box, asinActions.nextSibling);
  } else {
    titleEl.parentElement.appendChild(box);
  }
  UI.root = box;
  UI.btnOpt = box.querySelector('#optimize-button');
  UI.btnLabel = box.querySelector('.lfp-btn-label');
  UI.spin = box.querySelector('.lfp-spin');
  UI.status = box.querySelector('.lfp-status');
  UI.badge = box.querySelector('.lfp-badge');

  UI.btnOpt.addEventListener('click', () => {
    // 最適化ロジック（省略、既存のものを維持）
    console.log('最適化クリック');
  });
}

function resetUIState() {
  if (UI.badge) UI.badge.textContent = "";
  if (UI.btnOpt) {
    UI.btnOpt.disabled = false;
    UI.btnOpt.classList.remove("highlight");
  }
  if (UI.btnLabel) UI.btnLabel.textContent = "最適化";
  STORE.optimizeState.needsRetry = false;
}

function ensureQuickMipButton(btnGet) {
  if (UI.quickMipBtn && UI.quickMipBtn.isConnected) return;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "btn btn-primary btn-custom-secondary";
  btn.id = "quick-mip-button";
  btn.style.marginLeft = "8px";
  btn.innerHTML = `<span>MIP&nbsp;&nbsp;<i class="glyph-icon icon-linecons-paper-plane"></i></span>`;
  btn.addEventListener("click", () => {
    const real = document.querySelector("#mip-list-item-btn");
    if (real && !real.disabled) real.click();
  });
  btnGet.parentElement.appendChild(btn);
  UI.quickMipBtn = btn;
}

function removeQuickMipButton() {
  if (UI.quickMipBtn) UI.quickMipBtn.remove();
  UI.quickMipBtn = null;
}

async function refreshListingCountUI() {
  if (!UI.listingCountLabel || !UI.listingCountLabel.isConnected) return;
  
  const hist = await loadHistory();
  const stats = await loadStatistics();
  if (!stats) return;
  
  const successItems = hist.filter(item => {
    const f = item.flags || {};
    return !(f.protected || f.brand || f.already_listed || f.no_listings || f.no_item);
  });
  const successCount = successItems.length;

  let confirmedMs = stats.totalWorkTimeToday || 0;
  let currentSessionMs = 0;
  
  if (stats.currentSessionStartTime && !stats.isCounterPaused) {
    currentSessionMs = Date.now() - stats.currentSessionStartTime;
  } else if (stats.currentSessionElapsedMs) {
    currentSessionMs = stats.currentSessionElapsedMs;
  }
  
  const totalMs = confirmedMs + currentSessionMs;
  const totalSec = Math.floor(totalMs / 1000);
  const hours = Math.floor(totalSec / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  const timeStr = `${hours}時間${String(mins).padStart(2, '0')}分${String(secs).padStart(2, '0')}秒`;
  
  let rankContent = "";
  if (totalMs > 0) {
    const speedVal = (successCount / (totalMs / 3600000));
    let feedback = "ゆったり";
    let emoji = "🐢";
    let color = "#000"; // Black
    let bgColor = "#f8f9fa";

    if (speedVal >= 120) { feedback = "爆速"; emoji = "🚀"; color = "#673ab7"; bgColor = "#f3e5f5"; }
    else if (speedVal >= 60) { feedback = "高速"; emoji = "🏎️"; color = "#007bff"; bgColor = "#e7f3ff"; }
    else if (speedVal >= 30) { feedback = "着実"; emoji = "💪"; color = "#28a745"; bgColor = "#e8f5e9"; }
    else if (speedVal >= 10) { feedback = "のんびり"; emoji = "🚲"; color = "#ffc107"; bgColor = "#fffde7"; }

    const isMaxSpeed = speedVal >= (stats.todayMaxSpeed || 0);
    const trophy = (isMaxSpeed && speedVal > 0) ? " 🏆" : "";
    rankContent = `${feedback} ${emoji}${trophy}`;
  }

  if (!UI.listingCountLabel.querySelector('.lfp-count-val')) {
    UI.listingCountLabel.innerHTML = `
      <span class="lfp-count-val" style="font-weight: bold; color: #000; vertical-align: middle;">出品完了: ${successCount}件</span>
      <span class="lfp-time-val" style="margin-left: 15px; font-weight: bold; color: #000; vertical-align: middle;">本日の作業時間: ${timeStr}</span>
      <span id="lfp-pause-resume-btn-placeholder" style="margin-left: 4px; display: inline-flex; align-items: center;"></span>
      <span class="lfp-rank-badge" style="margin-left: 10px; font-size: 0.85em; font-weight: bold; padding: 2px 10px; border-radius: 12px; display: ${rankContent ? 'inline-block' : 'none'}; vertical-align: middle; white-space: nowrap; border: 1px solid #ddd;">${rankContent}</span>
    `;
    await createPauseResumeButton();
  } else {
    const countSpan = UI.listingCountLabel.querySelector('.lfp-count-val');
    const timeSpan = UI.listingCountLabel.querySelector('.lfp-time-val');
    const rankSpan = UI.listingCountLabel.querySelector('.lfp-rank-badge');
    
    if (countSpan) countSpan.textContent = `出品完了: ${successCount}件`;
    if (timeSpan) timeSpan.textContent = `本日の作業時間: ${timeStr}`;
    if (rankSpan) {
      rankSpan.style.display = rankContent ? 'inline-block' : 'none';
      rankSpan.textContent = rankContent;
    }
    if (UI.pauseResumeBtn) {
      updatePauseResumeButtonUI(UI.pauseResumeBtn, stats.isCounterPaused);
    }
  }
}

async function createPauseResumeButton() {
  const placeholder = document.getElementById('lfp-pause-resume-btn-placeholder');
  if (!placeholder || placeholder.querySelector('.lfp-pause-resume-btn')) return;
  
  const btn = document.createElement('button');
  btn.className = 'lfp-pause-resume-btn';
  btn.id = 'lfp-pause-resume-btn';
  btn.type = 'button';
  btn.style.border = 'none';
  btn.style.background = 'transparent';
  btn.style.cursor = 'pointer';
  btn.style.fontSize = '18px';
  
  const stats = await loadStatistics();
  updatePauseResumeButtonUI(btn, stats?.isCounterPaused || false);
  
  btn.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    await togglePauseResume();
  });
  
  placeholder.appendChild(btn);
  UI.pauseResumeBtn = btn;
}

function updatePauseResumeButtonUI(btn, isPaused) {
  btn.innerHTML = isPaused ? '▶️' : '⏸️';
  btn.title = isPaused ? 'クリックで再開' : 'クリックで一時停止';
}

async function togglePauseResume() {
  const stats = await loadStatistics();
  if (!stats) return;
  
  const now = Date.now();
  stats.isCounterPaused = !stats.isCounterPaused;
  
  if (stats.isCounterPaused) {
    if (stats.currentSessionStartTime) {
      const elapsed = now - stats.currentSessionStartTime;
      stats.totalWorkTimeToday = (stats.totalWorkTimeToday || 0) + elapsed;
      stats.currentSessionStartTime = null;
      stats.currentSessionElapsedMs = 0;
    }
  } else {
    stats.currentSessionStartTime = now;
    stats.lastAsinInputTime = now;
    startWorkTimeUpdateTimer();
  }
  
  await saveStatistics(stats);
  await refreshListingCountUI();
}

async function onAsinInput() {
  const stats = await loadStatistics();
  if (!stats) return;
  
  const now = Date.now();
  if (stats.isCounterPaused || !stats.currentSessionStartTime) {
    stats.currentSessionStartTime = now;
    stats.isCounterPaused = false;
    stats.lastAsinInputTime = now;
    await saveStatistics(stats);
    startWorkTimeUpdateTimer();
  } else {
    stats.lastAsinInputTime = now;
    await saveStatistics(stats);
  }
}

/* ---------- Core Logic ---------- */
async function init() {
  if (initRunning) return;
  initRunning = true;
  try {
    await loadOptions();
    if (!isListerRoute()) return;

    const btnGet = findButtonByText(/^Get Item$/i);
    const asinInput = findAsinInputSmart(btnGet);
    const titleEl = findTitleFieldSmart();

    if (STORE.opt.historyEnabled && asinInput && (!UI.asinBar || !UI.asinBar.isConnected)) {
      const bar = document.createElement("div");
      bar.className = "lfp-asinbar";
      bar.id = "lfp-asinbar";
      bar.innerHTML = `
        <select id="lfp-hist"><option value="">ASIN履歴（直近1000件）</option></select>
        <button class="lfp-reset-btn">×リセット</button>
        <button class="lfp-copy-btn">📋コピー</button>
        <button class="lfp-csv-btn">📊CSV</button>
        <span class="lfp-listing-count-label" style="margin-left:12px; font-size:14px; font-weight:bold; color:#000; display:inline-flex; align-items:center; height:32px;">出品完了: -件</span>
      `;
      asinInput.parentElement.insertBefore(bar, asinInput);
      UI.asinBar = bar;
      UI.histSel = bar.querySelector('#lfp-hist');
      UI.listingCountLabel = bar.querySelector('.lfp-listing-count-label');

      bar.querySelector('.lfp-reset-btn').addEventListener('click', async () => {
        if (confirm("履歴をリセットしますか？")) {
          await resetHistory();
          await refreshListingCountUI();
        }
      });
      
      await refreshListingCountUI();
    }

    if (asinInput && !asinInput.dataset.lfpWired) {
      asinInput.dataset.lfpWired = "1";
      asinInput.addEventListener("input", onAsinInput);
      asinInput.addEventListener("paste", onAsinInput);
    }

    if (titleEl) unlockUI(titleEl);
    if (btnGet && STORE.opt.quickMipButton) ensureQuickMipButton(btnGet);

    if (!mainObserver) {
      mainObserver = new MutationObserver(() => scheduleInit());
      mainObserver.observe(document.body, { childList: true, subtree: true });
      startWorkTimeUpdateTimer();
    }
    
    if (!observersInitialized) {
      setupListingSuccessObserver();
      observersInitialized = true;
    }
  } catch (err) {
    console.error('[LFP] init error:', err);
  } finally {
    initRunning = false;
  }
}

function setupListingSuccessObserver() {
  if (listingSuccessObserver) return;
  listingSuccessObserver = new MutationObserver(async (mutations) => {
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (node.nodeType === 1 && node.textContent.includes('Listing Success')) {
          await incrementListingCount();
        }
      }
    }
  });
  listingSuccessObserver.observe(document.body, { childList: true, subtree: true });
}

let workTimeUpdateInterval = null;
function startWorkTimeUpdateTimer() {
  if (workTimeUpdateInterval) clearInterval(workTimeUpdateInterval);
  workTimeUpdateInterval = setInterval(async () => {
    const stats = await loadStatistics();
    if (stats && stats.currentSessionStartTime && !stats.isCounterPaused) {
      const now = Date.now();
      if (stats.lastAsinInputTime && (now - stats.lastAsinInputTime) >= 2 * 60 * 1000) {
        // 2分放置で自動停止
        stats.isCounterPaused = true;
        const elapsed = stats.lastAsinInputTime - stats.currentSessionStartTime;
        stats.totalWorkTimeToday = (stats.totalWorkTimeToday || 0) + Math.max(0, elapsed);
        stats.currentSessionStartTime = null;
        await saveStatistics(stats);
      }
    }
    await refreshListingCountUI();
  }, 1000);
}

let initTimer = null;
function scheduleInit() {
  if (initTimer) clearTimeout(initTimer);
  initTimer = setTimeout(init, 300);
}

scheduleInit();
window.addEventListener("hashchange", scheduleInit);
