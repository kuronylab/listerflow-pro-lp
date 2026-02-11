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
    listingSpeed: document.getElementById('listingSpeed'),
    todayWorkingHours: document.getElementById('todayWorkingHours'),
    errorRateLabel: document.getElementById('errorRateLabel'),
    lastListing: document.getElementById('lastListing'),
    completedListingsCount: document.getElementById('completedListingsCount'),
    protectedCount: document.getElementById('protectedCount'),
    brandCount: document.getElementById('brandCount'),
    noListingsCount: document.getElementById('noListingsCount'),
    alreadyListedCount: document.getElementById('alreadyListedCount'),
    noItemCount: document.getElementById('noItemCount')
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
  }
}

// Stats functions
async function loadAndDisplayStats() {
  try {
    const stats = await loadStatistics();
    const history = await loadHistory();

    // Display stats
    statsElements.todayListings.textContent = `${stats.todayListings}件`;
    statsElements.weekListings.textContent = `${stats.weekListings}件`;
    statsElements.totalListings.textContent = `${stats.totalListings}件`;

    // Last listing time (Absolute format: M/D HH:mm)
    if (stats.lastListingDate) {
      const d = new Date(stats.lastListingDate);
      const timeStr = `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
      statsElements.lastListing.textContent = timeStr;
    } else {
      statsElements.lastListing.textContent = '-';
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

    statsElements.completedListingsCount.textContent = `${completedCount}件`;
    statsElements.protectedCount.textContent = `${protectedCount}件`;
    statsElements.brandCount.textContent = `${brandCount}件`;
    statsElements.noListingsCount.textContent = `${noListingsCount}件`;
    statsElements.alreadyListedCount.textContent = `${alreadyListedCount}件`;
    statsElements.noItemCount.textContent = `${noItemCount}件`;

    // エラー率の表示
    if (statsElements.errorRateLabel) {
      if (history.length > 0) {
        const errorCount = history.length - completedCount;
        const errorRate = Math.round((errorCount / history.length) * 100);
        statsElements.errorRateLabel.textContent = `(エラー率: ${errorRate}%)`;
      } else {
        statsElements.errorRateLabel.textContent = "";
      }
    }

    // 作業時間と出品速度の表示
    try {
      const workingHours = formatWorkingHoursFromMs(stats.todayTotalWorkMs);
      if (statsElements.todayWorkingHours) {
        statsElements.todayWorkingHours.textContent = workingHours;
      }

      if (statsElements.listingSpeed) {
        if (stats.todayTotalWorkMs > 0 && stats.todayListings > 0) {
          const hours = stats.todayTotalWorkMs / (1000 * 60 * 60);
          const speed = Math.round(stats.todayListings / hours);
          
          let feedback = "";
          let emoji = "";
          
          if (speed >= 120) {
            feedback = "爆速です";
            emoji = "🚀";
          } else if (speed >= 60) {
            feedback = "スピーディ";
            emoji = "🏃‍♂️‍➡️";
          } else {
            feedback = "着実です";
            emoji = "💪";
          }
          
          // 最高速度更新のチェック
          const isMaxSpeed = speed >= (stats.todayMaxSpeed || 0);
          const trophy = isMaxSpeed ? " 🏆" : "";
          
          statsElements.listingSpeed.textContent = `時速：${speed}品/時 (${feedback} ${emoji}${trophy})`;
        } else {
          statsElements.listingSpeed.textContent = "時速：-品/時";
        }
      }
    } catch (whErr) {
      console.error("[Popup] Error calculating performance stats:", whErr);
    }

  } catch (err) {
    console.error("[Popup] Error loading stats:", err);
  }
}

function formatWorkingHoursFromMs(totalMs) {
  if (!totalMs) {
    return "0時間00分";
  }

  const diffMinutes = Math.floor(totalMs / (1000 * 60));
  const hours = Math.floor(diffMinutes / 60);
  const minutes = diffMinutes % 60;

  return `${hours}時間${String(minutes).padStart(2, '0')}分`;
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
        alreadyListedCount: 0,
        noItemCount: 0,
        todayTotalWorkMs: 0,
        todayLastActivityTime: null,
        todayMaxSpeed: 0,
        lastResetDate: Date.now()
      };
    }

    // 日付が変わった場合に日次データをリセット
    const today = new Date().toDateString();
    const lastReset = new Date(stats.lastResetDate).toDateString();

    if (lastReset !== today) {
      stats.todayListings = 0;
      stats.todayTotalWorkMs = 0;
      stats.todayLastActivityTime = null;
      stats.todayMaxSpeed = 0;
      stats.lastResetDate = Date.now();
    }

    return stats;
  } catch (err) {
    console.error('[Popup] loadStatistics error:', err);
    return null;
  }
}

async function loadHistory() {
  try {
    const data = await chrome.storage.local.get([KEY_HIST]);
    return data?.[KEY_HIST] || [];
  } catch (err) {
    console.error('[Popup] loadHistory error:', err);
    return [];
  }
}

async function resetStats() {
  if (confirm('統計情報をすべてリセットしますか？')) {
    try {
      const stats = {
        totalListings: 0,
        todayListings: 0,
        weekListings: 0,
        lastListingDate: null,
        optimizeCount: 0,
        brandCount: 0,
        alreadyListedCount: 0,
        noItemCount: 0,
        todayTotalWorkMs: 0,
        todayLastActivityTime: null,
        todayMaxSpeed: 0,
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
}

// Settings functions
async function loadSettings() {
  try {
    const data = await chrome.storage.local.get([KEY_OPT]);
    const options = data?.[KEY_OPT] || {};

    // Apply to UI
    if (settingElements.apiKey) settingElements.apiKey.value = options.apiKey || "";
    if (settingElements.model) settingElements.model.value = options.model || "gpt-4o-mini";
    if (settingElements.autoGetOnPaste) settingElements.autoGetOnPaste.checked = options.autoGetOnPaste !== false;
    if (settingElements.autoGetOnHistory) settingElements.autoGetOnHistory.checked = options.autoGetOnHistory !== false;
    if (settingElements.autoMipAfterOptimize) settingElements.autoMipAfterOptimize.checked = options.autoMipAfterOptimize !== false;
    if (settingElements.autoClickOkAfterMip) settingElements.autoClickOkAfterMip.checked = options.autoClickOkAfterMip !== false;
    if (settingElements.quickMipButton) settingElements.quickMipButton.checked = options.quickMipButton !== false;
    if (settingElements.highlightOptimize) settingElements.highlightOptimize.checked = options.highlightOptimize !== false;
    if (settingElements.historyEnabled) settingElements.historyEnabled.checked = options.historyEnabled !== false;
    if (settingElements.veroEnabled) settingElements.veroEnabled.checked = options.veroEnabled !== false;
    if (settingElements.turboListingMode) settingElements.turboListingMode.checked = options.turboListingMode === true;

  } catch (err) {
    console.error('[Popup] loadSettings error:', err);
  }
}

async function saveBasicSettings() {
  try {
    const data = await chrome.storage.local.get([KEY_OPT]);
    const options = data?.[KEY_OPT] || {};

    options.apiKey = settingElements.apiKey.value;
    options.model = settingElements.model.value;

    await chrome.storage.local.set({ [KEY_OPT]: options });
    alert('基本設定を保存しました。');
  } catch (err) {
    console.error('[Popup] saveBasicSettings error:', err);
    alert('設定の保存に失敗しました。');
  }
}

async function saveAutomationSettings() {
  try {
    const data = await chrome.storage.local.get([KEY_OPT]);
    const options = data?.[KEY_OPT] || {};

    options.autoGetOnPaste = settingElements.autoGetOnPaste.checked;
    options.autoGetOnHistory = settingElements.autoGetOnHistory.checked;
    options.autoMipAfterOptimize = settingElements.autoMipAfterOptimize.checked;
    options.autoClickOkAfterMip = settingElements.autoClickOkAfterMip.checked;
    options.quickMipButton = settingElements.quickMipButton.checked;
    options.highlightOptimize = settingElements.highlightOptimize.checked;
    options.historyEnabled = settingElements.historyEnabled.checked;
    options.veroEnabled = settingElements.veroEnabled.checked;
    options.turboListingMode = settingElements.turboListingMode.checked;

    await chrome.storage.local.set({ [KEY_OPT]: options });
    alert('自動化設定を保存しました。');
  } catch (err) {
    console.error('[Popup] saveAutomationSettings error:', err);
    alert('設定の保存に失敗しました。');
  }
}

function toggleApiKeyVisibility() {
  const input = settingElements.apiKey;
  const btn = document.getElementById('showKeyBtn');
  if (input.type === 'password') {
    input.type = 'text';
    btn.textContent = '隠す';
  } else {
    input.type = 'password';
    btn.textContent = '表示';
  }
}

// History functions
async function exportToSpreadsheet() {
  try {
    const history = await loadHistory();
    if (history.length === 0) {
      alert('履歴がありません。');
      return;
    }

    // Convert to CSV
    let csv = "日付,ASIN,ステータス\n";
    history.forEach(h => {
      const date = new Date(h.lastSeen || h.timestamp).toLocaleString();
      let status = "完了";
      if (h.flags?.protected) status = "Protected";
      if (h.flags?.brand) status = "Brand Warning";
      if (h.flags?.already_listed) status = "Already Listed";
      if (h.flags?.no_listings) status = "No Listings";
      if (h.flags?.no_item) status = "No Item";
      
      csv += `${date},${h.asin},${status}\n`;
    });

    // Download file
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `listerflow_history_${new Date().toISOString().slice(0,10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  } catch (err) {
    console.error('[Popup] exportToSpreadsheet error:', err);
    alert('出力に失敗しました。');
  }
}

async function clearHistory() {
  if (confirm('すべての履歴を削除しますか？この操作は取り消せません。')) {
    try {
      await chrome.storage.local.set({ [KEY_HIST]: [] });
      await loadAndDisplayStats();
      alert('履歴を削除しました。');
    } catch (err) {
      console.error('[Popup] clearHistory error:', err);
      alert('履歴の削除に失敗しました。');
    }
  }
}
