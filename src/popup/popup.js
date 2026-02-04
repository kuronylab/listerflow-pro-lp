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
    historyCount: document.getElementById('historyCount'),
    protectedCount: document.getElementById('protectedCount'),
    brandCount: document.getElementById('brandCount'),
    noListingsCount: document.getElementById('noListingsCount')
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
  menuBtn.addEventListener('click', () => {
    sideMenu.classList.add('open');
  });

  closeMenuBtn.addEventListener('click', () => {
    sideMenu.classList.remove('open');
  });

  // Menu items
  document.querySelectorAll('.menu-item').forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      const page = item.dataset.page;
      switchPage(page);
      sideMenu.classList.remove('open');
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

  // Version page buttons
  // (openOptionsBtn removed - all settings are now in popup)
}

function switchPage(page) {
  // Update menu items
  document.querySelectorAll('.menu-item').forEach(item => {
    item.classList.remove('active');
    if (item.dataset.page === page) {
      item.classList.add('active');
    }
  });

  // Update pages
  document.querySelectorAll('.page').forEach(p => {
    p.classList.remove('active');
  });

  const pageMap = {
    stats: { element: 'statsPage', title: '統計情報' },
    basic: { element: 'basicPage', title: '基本設定' },
    automation: { element: 'automationPage', title: '自動化設定' },
    history: { element: 'historyPage', title: 'ASIN履歴管理' },
    version: { element: 'versionPage', title: 'バージョン情報' },
    links: { element: 'linksPage', title: '各種リンク' }
  };

  const pageInfo = pageMap[page];
  if (pageInfo) {
    document.getElementById(pageInfo.element).classList.add('active');
    pageTitle.textContent = pageInfo.title;

    // Load page-specific data
    if (page === 'history') {
      loadHistoryList();
    }
  }
}

// Statistics functions
async function loadAndDisplayStats() {
  try {
    const stats = await loadStatistics();
    const history = await loadHistory();

    // Display stats
    statsElements.todayListings.textContent = `${stats.todayListings}件`;
    statsElements.weekListings.textContent = `${stats.weekListings}件`;
    statsElements.totalListings.textContent = `${stats.totalListings}件`;
    statsElements.optimizeCount.textContent = `${stats.optimizeCount}回`;

    // Last listing time
    if (stats.lastListingDate) {
      const date = new Date(stats.lastListingDate);
      const now = new Date();
      const diffMs = now - date;
      const diffMins = Math.floor(diffMs / 60000);
      const diffHours = Math.floor(diffMs / 3600000);
      const diffDays = Math.floor(diffMs / 86400000);

      let timeStr = '';
      if (diffMins < 60) {
        timeStr = `${diffMins}分前`;
      } else if (diffHours < 24) {
        timeStr = `${diffHours}時間前`;
      } else {
        timeStr = `${diffDays}日前`;
      }
      statsElements.lastListing.textContent = timeStr;
    } else {
      statsElements.lastListing.textContent = 'なし';
    }

    // History stats
    statsElements.historyCount.textContent = `${history.length}件`;

    const protectedCount = history.filter(h => h.flags?.protected).length;
    const noListingsCount = history.filter(h => h.flags?.no_listings).length;

    statsElements.protectedCount.textContent = `${protectedCount}件`;
    statsElements.brandCount.textContent = `${stats.brandCount || 0}件`;
    statsElements.noListingsCount.textContent = `${noListingsCount}件`;

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
        brandCount: 0,
        lastResetDate: Date.now()
      };
    }

    return stats;
  } catch (err) {
    console.error('[Popup] loadStatistics error:', err);
    return {
      totalListings: 0,
      todayListings: 0,
      weekListings: 0,
      lastListingDate: null,
      optimizeCount: 0,
      brandCount: 0,
      lastResetDate: Date.now()
    };
  }
}

async function resetStats() {
  if (!confirm('統計情報をリセットしますか？この操作は取り消せません。')) {
    return;
  }

  try {
    const stats = {
      totalListings: 0,
      todayListings: 0,
      weekListings: 0,
      lastListingDate: null,
      optimizeCount: 0,
      brandCount: 0,
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
    // デフォルト値を定義
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
    const saved = data?.[KEY_OPT] || {};
    
    // デフォルト値とマージ
    const options = { ...DEFAULTS, ...saved };

    // Basic settings
    if (settingElements.apiKey) settingElements.apiKey.value = options.apiKey;
    if (settingElements.model) settingElements.model.value = options.model;

    // Automation settings
    if (settingElements.autoGetOnPaste) settingElements.autoGetOnPaste.checked = options.autoGetOnPaste;
    if (settingElements.autoGetOnHistory) settingElements.autoGetOnHistory.checked = options.autoGetOnHistory;
    if (settingElements.autoMipAfterOptimize) settingElements.autoMipAfterOptimize.checked = options.autoMipAfterOptimize;
    if (settingElements.autoClickOkAfterMip) settingElements.autoClickOkAfterMip.checked = options.autoClickOkAfterMip;
    if (settingElements.quickMipButton) settingElements.quickMipButton.checked = options.quickMipButton;
    if (settingElements.highlightOptimize) settingElements.highlightOptimize.checked = options.highlightOptimize;
    if (settingElements.historyEnabled) settingElements.historyEnabled.checked = options.historyEnabled;
    if (settingElements.veroEnabled) settingElements.veroEnabled.checked = options.veroEnabled;
    if (settingElements.turboListingMode) settingElements.turboListingMode.checked = options.turboListingMode;
  } catch (err) {
    console.error('[Popup] loadSettings error:', err);
  }
}

function toggleApiKeyVisibility() {
  const apiKeyInput = settingElements.apiKey;
  const showKeyBtn = document.getElementById('showKeyBtn');

  if (apiKeyInput.type === 'password') {
    apiKeyInput.type = 'text';
    showKeyBtn.textContent = '非表示';
  } else {
    apiKeyInput.type = 'password';
    showKeyBtn.textContent = '表示';
  }
}

async function saveBasicSettings() {
  try {
    const data = await chrome.storage.sync.get([KEY_OPT]);
    const saved = data?.[KEY_OPT] || {};

    saved.apiKey = settingElements.apiKey.value;
    saved.model = settingElements.model.value;

    await chrome.storage.sync.set({ [KEY_OPT]: saved });
    alert('基本設定を保存しました。');
  } catch (err) {
    console.error('[Popup] saveBasicSettings error:', err);
    alert('設定の保存に失敗しました。');
  }
}

async function saveAutomationSettings() {
  try {
    const data = await chrome.storage.sync.get([KEY_OPT]);
    const saved = data?.[KEY_OPT] || {};

    saved.autoGetOnPaste = settingElements.autoGetOnPaste.checked;
    saved.autoGetOnHistory = settingElements.autoGetOnHistory.checked;
    saved.autoMipAfterOptimize = settingElements.autoMipAfterOptimize.checked;
    saved.autoClickOkAfterMip = settingElements.autoClickOkAfterMip.checked;
    saved.quickMipButton = settingElements.quickMipButton.checked;
    saved.highlightOptimize = settingElements.highlightOptimize.checked;
    saved.historyEnabled = settingElements.historyEnabled.checked;
    saved.veroEnabled = settingElements.veroEnabled.checked;
    saved.turboListingMode = settingElements.turboListingMode.checked;

    await chrome.storage.sync.set({ [KEY_OPT]: saved });
    alert('自動化設定を保存しました。');
  } catch (err) {
    console.error('[Popup] saveAutomationSettings error:', err);
    alert('設定の保存に失敗しました。');
  }
}

// History functions
async function loadHistory() {
  try {
    const data = await chrome.storage.local.get([KEY_HIST]);
    let list = Array.isArray(data?.[KEY_HIST]) ? data[KEY_HIST] : [];
    return list;
  } catch (err) {
    console.error('[Popup] loadHistory error:', err);
    return [];
  }
}

async function loadHistoryList() {
  const historyList = document.getElementById('historyList');
  const historyCountDetail = document.getElementById('historyCountDetail');

  try {
    const history = await loadHistory();
    historyCountDetail.textContent = `${history.length}件`;

    if (history.length === 0) {
      historyList.innerHTML = '<div class="loading">履歴がありません</div>';
      return;
    }

    historyList.innerHTML = '';
    history.forEach((item, index) => {
      const div = document.createElement('div');
      div.className = 'history-item';

      const asinDiv = document.createElement('div');
      asinDiv.className = 'history-asin';
      asinDiv.textContent = item.asin;

      const flagsDiv = document.createElement('div');
      flagsDiv.className = 'history-flags';
      const flags = [];
      if (item.flags?.protected) flags.push('Protected');
      if (item.flags?.brand) flags.push('Brand');
      if (item.flags?.already_listed) flags.push('Already listed');
      if (item.flags?.no_listings) flags.push('No listings');
      flagsDiv.textContent = flags.length > 0 ? flags.join(', ') : '-';

      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'history-delete-btn';
      deleteBtn.textContent = '×';
      deleteBtn.title = 'この履歴を削除';
      deleteBtn.addEventListener('click', async () => {
        await deleteHistoryItem(item.asin);
        await loadHistoryList();
      });

      div.appendChild(asinDiv);
      div.appendChild(flagsDiv);
      div.appendChild(deleteBtn);
      historyList.appendChild(div);
    });
  } catch (err) {
    console.error('[Popup] loadHistoryList error:', err);
    historyList.innerHTML = '<div class="loading">エラーが発生しました</div>';
  }
}

async function deleteHistoryItem(asin) {
  try {
    const data = await chrome.storage.local.get([KEY_HIST]);
    let history = Array.isArray(data?.[KEY_HIST]) ? data[KEY_HIST] : [];
    history = history.filter(item => item.asin !== asin);
    await chrome.storage.local.set({ [KEY_HIST]: history });
    await loadAndDisplayStats();
  } catch (err) {
    console.error('[Popup] deleteHistoryItem error:', err);
    alert('履歴の削除に失敗しました。');
  }
}

async function clearHistory() {
  if (!confirm('ASIN履歴をすべて削除しますか？この操作は取り消せません。')) {
    return;
  }

  try {
    await chrome.storage.local.remove([KEY_HIST]);
    await loadHistoryList();
    await loadAndDisplayStats();
    alert('ASIN履歴を削除しました。');
  } catch (err) {
    console.error('[Popup] clearHistory error:', err);
    alert('履歴の削除に失敗しました。');
  }
}

async function exportToSpreadsheet() {
  // 新しいタブでエクスポート用ページを開く
  chrome.tabs.create({ url: chrome.runtime.getURL('src/popup/export.html') });
}

// Other functions
// openOptionsPage function removed - all settings are now in popup
