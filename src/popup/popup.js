// Storage keys
const KEY_OPT = "lfp_options_v1";
const KEY_HIST = "lfp_asin_history_v1";
const KEY_STATS = "lfp_statistics_v1";

// DOM elements
let menuBtn, closeMenuBtn, sideMenu, pageTitle, content;
let statsElements = {};
let settingElements = {};

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  initializeElements();
  setupEventListeners();
  await loadAndDisplayStats();
  await loadSettings();
});

function initializeElements() {
  // Menu
  menuBtn = document.getElementById('menuBtn');
  closeMenuBtn = document.getElementById('closeMenuBtn');
  sideMenu = document.getElementById('sideMenu');
  pageTitle = document.getElementById('pageTitle');
  content = document.getElementById('content');

  // Stats elements
  statsElements = {
    todayListings: document.getElementById('todayListings'),
    weekListings: document.getElementById('weekListings'),
    totalListings: document.getElementById('totalListings'),
    optimizeCount: document.getElementById('optimizeCount'),
    lastListing: document.getElementById('lastListing'),
    completedListingsCount: document.getElementById('completedListingsCount'),
    protectedCount: document.getElementById('protectedCount'),
    brandCount: document.getElementById('brandCount'),
    noListingsCount: document.getElementById('noListingsCount'),
    alreadyListedCount: document.getElementById('alreadyListedCount'),
    noItemCount: document.getElementById('noItemCount'),
    todayWorkingHours: document.getElementById('todayWorkingHours'),
    listingSpeed: document.getElementById('listingSpeed'),
    errorRateLabel: document.getElementById('errorRateLabel')
  };

  // Setting elements
  settingElements = {
    apiKey: document.getElementById('apiKey'),
    model: document.getElementById('model'),
    autoGetOnPaste: document.getElementById('autoGetOnPaste'),
    autoGetOnHistory: document.getElementById('autoGetOnHistory'),
    autoMipAfterOptimize: document.getElementById('autoMipAfterOptimize'),
    autoClickOkAfterMip: document.getElementById('autoClickOkAfterMip'),
    quickMipButton: document.getElementById('quickMipButton'),
    highlightOptimize: document.getElementById('highlightOptimize'),
    historyEnabled: document.getElementById('historyEnabled'),
    veroEnabled: document.getElementById('veroEnabled'),
    turboListingMode: document.getElementById('turboListingMode')
  };

  // Version elements
  const versionNumber = document.getElementById('versionNumber');
  const releaseDate = document.getElementById('releaseDate');
  
  // Load version from manifest
  const manifest = chrome.runtime.getManifest();
  if (versionNumber) versionNumber.textContent = `v${manifest.version}`;
  if (releaseDate) releaseDate.textContent = '2026年1月26日';
}

function setupEventListeners() {
  // Menu toggle
  menuBtn?.addEventListener('click', () => {
    sideMenu?.classList.add('open');
  });

  closeMenuBtn?.addEventListener('click', () => {
    sideMenu?.classList.remove('open');
  });

  // Menu items
  document.querySelectorAll('.menu-item').forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      const page = item.dataset.page;
      switchPage(page);
      sideMenu?.classList.remove('open');
    });
  });

  // Stats page buttons
  document.getElementById('resetStatsBtn')?.addEventListener('click', resetStats);

  // Basic settings page buttons
  document.getElementById('showKeyBtn')?.addEventListener('click', toggleApiKeyVisibility);
  document.getElementById('saveBasicBtn')?.addEventListener('click', saveBasicSettings);

  // Automation settings page buttons
  document.getElementById('saveAutomationBtn')?.addEventListener('click', saveAutomationSettings);

  // 最速出品モードの連動処理
  settingElements.turboListingMode?.addEventListener('change', (e) => {
    if (e.target.checked) {
      const targets = [
        'autoGetOnPaste',
        'autoGetOnHistory',
        'autoMipAfterOptimize',
        'autoClickOkAfterMip',
        'quickMipButton'
      ];
      targets.forEach(id => {
        const el = settingElements[id];
        if (el) el.checked = true;
      });
    }
  });

  // History page buttons
  document.getElementById('exportSpreadsheetBtn')?.addEventListener('click', exportToSpreadsheet);
  document.getElementById('clearHistoryBtn')?.addEventListener('click', clearHistory);
}

function switchPage(page) {
  // Update menu items
  document.querySelectorAll('.menu-item').forEach(item => {
    item.classList.toggle('active', item.dataset.page === page);
  });

  // Update pages
  document.querySelectorAll('.page').forEach(p => {
    p.classList.toggle('active', p.id === `${page}Page`);
  });

  const pageMap = {
    stats: '統計情報',
    basic: '基本設定',
    automation: '自動化設定',
    history: 'ASIN履歴管理',
    version: 'バージョン情報',
    links: '各種リンク'
  };

  if (pageTitle) pageTitle.textContent = pageMap[page] || '設定';

  // Load page-specific data
  if (page === 'history') loadHistoryList();
  if (page === 'stats') loadAndDisplayStats();
}

// Statistics functions
async function loadAndDisplayStats() {
  try {
    const stats = await loadStatistics();
    const history = await loadHistory();

    // Display stats
    if (statsElements.todayListings) statsElements.todayListings.textContent = `${stats.todayListings || 0}件`;
    if (statsElements.weekListings) statsElements.weekListings.textContent = `${stats.weekListings || 0}件`;
    if (statsElements.totalListings) statsElements.totalListings.textContent = `${stats.totalListings || 0}件`;
    if (statsElements.optimizeCount) statsElements.optimizeCount.textContent = `${stats.optimizeCount || 0}回`;

    // Last listing time
    if (statsElements.lastListing) {
      if (stats.lastListingDate) {
        const d = new Date(stats.lastListingDate);
        const timeStr = `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
        statsElements.lastListing.textContent = timeStr;
      } else {
        statsElements.lastListing.textContent = '-';
      }
    }

    // Working Hours & Speed
    if (statsElements.todayWorkingHours) {
      const totalMs = stats.totalWorkTimeToday || 0;
      const hours = Math.floor(totalMs / 3600000);
      const minutes = Math.floor((totalMs % 3600000) / 60000);
      statsElements.todayWorkingHours.textContent = `${hours}時間${minutes}分`;
    }

    if (statsElements.listingSpeed) {
      const totalMs = stats.totalWorkTimeToday || 0;
      const count = stats.todayListings || 0;
      const hours = totalMs / 3600000;
      const speed = hours > 0 ? (count / hours).toFixed(1) : "0.0";
      
      let rank = "rank-very-slow";
      let rankText = "ゆったり🐢";
      const s = parseFloat(speed);
      if (s >= 120) { rank = "rank-fastest"; rankText = "爆速🚀"; }
      else if (s >= 60) { rank = "rank-fast"; rankText = "高速🏎️"; }
      else if (s >= 30) { rank = "rank-normal"; rankText = "着実💪"; }
      else if (s >= 10) { rank = "rank-slow"; rankText = "のんびり🚲"; }

      statsElements.listingSpeed.innerHTML = `
        <span>${speed}品/時</span>
        <span class="rank-badge ${rank}">${rankText}</span>
      `;
    }

    // History stats
    const completedCount = history.filter(h => {
      const f = h.flags || {};
      return !f.protected && !f.brand && !f.already_listed && !f.no_listings && !f.no_item;
    }).length;

    const protectedCount = history.filter(h => h.flags?.protected === true).length;
    const brandCount = history.filter(h => h.flags?.brand === true).length;
    const noListingsCount = history.filter(h => h.flags?.no_listings === true).length;
    const alreadyListedCount = history.filter(h => h.flags?.already_listed === true).length;
    const noItemCount = history.filter(h => h.flags?.no_item === true).length;

    if (statsElements.completedListingsCount) statsElements.completedListingsCount.textContent = `${completedCount}件`;
    if (statsElements.protectedCount) statsElements.protectedCount.textContent = `${protectedCount}件`;
    if (statsElements.brandCount) statsElements.brandCount.textContent = `${brandCount}件`;
    if (statsElements.noListingsCount) statsElements.noListingsCount.textContent = `${noListingsCount}件`;
    if (statsElements.alreadyListedCount) statsElements.alreadyListedCount.textContent = `${alreadyListedCount}件`;
    if (statsElements.noItemCount) statsElements.noItemCount.textContent = `${noItemCount}件`;

    // Error Rate
    if (statsElements.errorRateLabel) {
      const total = history.length;
      const errors = total - completedCount;
      const rate = total > 0 ? (errors / total * 100).toFixed(1) : 0;
      
      let rateClass = "error-rate-low";
      if (rate > 50) rateClass = "error-rate-high";
      else if (rate > 20) rateClass = "error-rate-mid";
      
      statsElements.errorRateLabel.textContent = `エラー率: ${rate}%`;
      statsElements.errorRateLabel.className = rateClass;
    }

  } catch (err) {
    console.error('[Popup] Error loading stats:', err);
  }
}

async function loadStatistics() {
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
        totalWorkTimeToday: 0,
        lastResetDate: Date.now()
      };
    }

    const now = new Date();
    const lastReset = new Date(stats.lastResetDate);

    if (now.toDateString() !== lastReset.toDateString()) {
      stats.todayListings = 0;
      stats.totalWorkTimeToday = 0;
      if (now.getDay() < lastReset.getDay() || (now.getDay() === 0 && lastReset.getDay() !== 0)) {
        stats.weekListings = 0;
      }
      stats.lastResetDate = now.getTime();
      await chrome.storage.local.set({ [KEY_STATS]: stats });
    }

    return stats;
  } catch (err) {
    console.error('[Popup] loadStatistics error:', err);
    return { todayListings: 0, weekListings: 0, totalListings: 0 };
  }
}

async function resetStats() {
  if (!confirm('統計情報をリセットしますか？')) return;
  try {
    const stats = {
      totalListings: 0,
      todayListings: 0,
      weekListings: 0,
      lastListingDate: null,
      optimizeCount: 0,
      totalWorkTimeToday: 0,
      lastResetDate: Date.now()
    };
    await chrome.storage.local.set({ [KEY_STATS]: stats });
    await loadAndDisplayStats();
    alert('統計情報をリセットしました。');
  } catch (err) {
    console.error('[Popup] resetStats error:', err);
    alert('統計情報のリセットに失敗しました。');
  }
}

// Settings functions
async function loadSettings() {
  try {
    const DEFAULTS = {
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
    };

    const data = await chrome.storage.sync.get([KEY_OPT]);
    const options = { ...DEFAULTS, ...(data?.[KEY_OPT] || {}) };

    if (settingElements.apiKey) settingElements.apiKey.value = options.apiKey || "";
    if (settingElements.model) settingElements.model.value = options.model || "gpt-4o-mini";
    if (settingElements.autoGetOnPaste) settingElements.autoGetOnPaste.checked = !!options.autoGetOnPaste;
    if (settingElements.autoGetOnHistory) settingElements.autoGetOnHistory.checked = !!options.autoGetOnHistory;
    if (settingElements.autoMipAfterOptimize) settingElements.autoMipAfterOptimize.checked = !!options.autoMipAfterOptimize;
    if (settingElements.autoClickOkAfterMip) settingElements.autoClickOkAfterMip.checked = !!options.autoClickOkAfterMip;
    if (settingElements.quickMipButton) settingElements.quickMipButton.checked = !!options.quickMipButton;
    if (settingElements.highlightOptimize) settingElements.highlightOptimize.checked = !!options.highlightOptimize;
    if (settingElements.historyEnabled) settingElements.historyEnabled.checked = !!options.historyEnabled;
    if (settingElements.veroEnabled) settingElements.veroEnabled.checked = !!options.veroEnabled;
    if (settingElements.turboListingMode) settingElements.turboListingMode.checked = !!options.turboListingMode;

  } catch (err) {
    console.error('[Popup] loadSettings error:', err);
  }
}

async function saveBasicSettings() {
  try {
    const data = await chrome.storage.sync.get([KEY_OPT]);
    const options = data?.[KEY_OPT] || {};
    
    options.apiKey = settingElements.apiKey?.value.trim();
    options.model = settingElements.model?.value;

    await chrome.storage.sync.set({ [KEY_OPT]: options });
    alert('基本設定を保存しました。');
  } catch (err) {
    alert('保存に失敗しました。');
  }
}

async function saveAutomationSettings() {
  try {
    const data = await chrome.storage.sync.get([KEY_OPT]);
    const options = data?.[KEY_OPT] || {};
    
    options.autoGetOnPaste = settingElements.autoGetOnPaste?.checked;
    options.autoGetOnHistory = settingElements.autoGetOnHistory?.checked;
    options.autoMipAfterOptimize = settingElements.autoMipAfterOptimize?.checked;
    options.autoClickOkAfterMip = settingElements.autoClickOkAfterMip?.checked;
    options.quickMipButton = settingElements.quickMipButton?.checked;
    options.highlightOptimize = settingElements.highlightOptimize?.checked;
    options.historyEnabled = settingElements.historyEnabled?.checked;
    options.veroEnabled = settingElements.veroEnabled?.checked;
    options.turboListingMode = settingElements.turboListingMode?.checked;

    await chrome.storage.sync.set({ [KEY_OPT]: options });
    alert('自動化設定を保存しました。');
  } catch (err) {
    alert('保存に失敗しました。');
  }
}

function toggleApiKeyVisibility() {
  const input = settingElements.apiKey;
  const btn = document.getElementById('showKeyBtn');
  if (!input || !btn) return;
  if (input.type === 'password') {
    input.type = 'text';
    btn.textContent = '隠す';
  } else {
    input.type = 'password';
    btn.textContent = '表示';
  }
}

// History functions
async function loadHistory() {
  const data = await chrome.storage.local.get([KEY_HIST]);
  return Array.isArray(data?.[KEY_HIST]) ? data[KEY_HIST] : [];
}

async function loadHistoryList() {
  const historyList = document.getElementById('historyList');
  const historyCountDetail = document.getElementById('historyCountDetail');
  if (!historyList) return;

  historyList.innerHTML = '<div class="loading">読み込み中...</div>';

  try {
    const history = await loadHistory();
    if (historyCountDetail) historyCountDetail.textContent = `${history.length}件`;

    if (history.length === 0) {
      historyList.innerHTML = '<div class="loading">履歴がありません</div>';
      return;
    }

    historyList.innerHTML = '';
    [...history].reverse().forEach((item, index) => {
      const originalIndex = history.length - 1 - index;
      const div = document.createElement('div');
      div.className = 'history-item';
      
      const flags = [];
      if (item.flags?.protected) flags.push('Protected');
      if (item.flags?.brand) flags.push('Brand');
      if (item.flags?.already_listed) flags.push('Already listed');
      if (item.flags?.no_listings) flags.push('No listings');
      if (item.flags?.no_item) flags.push('No item');
      
      const statusText = flags.length > 0 ? flags.join(', ') : '-';

      div.innerHTML = `
        <div class="history-asin">${item.asin}</div>
        <div class="history-flags">${statusText}</div>
        <button class="history-delete-btn" data-index="${originalIndex}">✕</button>
      `;
      
      div.querySelector('.history-delete-btn').addEventListener('click', (e) => {
        deleteHistoryItem(parseInt(e.target.dataset.index));
      });
      
      historyList.appendChild(div);
    });
  } catch (err) {
    historyList.innerHTML = '<div class="loading">エラーが発生しました</div>';
  }
}

async function deleteHistoryItem(index) {
  try {
    const history = await loadHistory();
    history.splice(index, 1);
    await chrome.storage.local.set({ [KEY_HIST]: history });
    await loadHistoryList();
    await loadAndDisplayStats();
  } catch (err) {
    alert('削除に失敗しました。');
  }
}

async function clearHistory() {
  if (!confirm('すべての履歴を削除しますか？')) return;
  try {
    await chrome.storage.local.set({ [KEY_HIST]: [] });
    await loadHistoryList();
    await loadAndDisplayStats();
    alert('履歴をすべて削除しました。');
  } catch (err) {
    alert('削除に失敗しました。');
  }
}

function exportToSpreadsheet() {
  chrome.tabs.create({
    url: chrome.runtime.getURL('src/popup/export.html')
  });
}
