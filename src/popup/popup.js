// popup.js - ListerFlow Pro Popup Logic

const KEY_OPT = 'lfp_options';
const KEY_STATS = 'lfp_stats';
const KEY_HIST = 'lfp_history';

// Elements
const pageTitle = document.getElementById('pageTitle');
const statsElements = {
  todayListings: document.getElementById('todayListings'),
  weekListings: document.getElementById('weekListings'),
  totalListings: document.getElementById('totalListings'),
  lastListing: document.getElementById('lastListing'),
  todayWorkingHours: document.getElementById('todayWorkingHours'),
  listingSpeed: document.getElementById('listingSpeed'),
  completedListingsCount: document.getElementById('completedListingsCount'),
  protectedCount: document.getElementById('protectedCount'),
  brandCount: document.getElementById('brandCount'),
  noListingsCount: document.getElementById('noListingsCount'),
  alreadyListedCount: document.getElementById('alreadyListedCount'),
  noItemCount: document.getElementById('noItemCount'),
  errorRateLabel: document.getElementById('errorRateLabel')
};

const settingElements = {
  apiKey: document.getElementById('apiKey'),
  model: document.getElementById('model'),
  autoGetOnPaste: document.getElementById('autoGetOnPaste'),
  autoGetOnHistory: document.getElementById('autoGetOnHistory'),
  autoMipAfterOptimize: document.getElementById('autoMipAfterOptimize'),
  autoClickOkAfterMip: document.getElementById('autoClickOkAfterMip'),
  veroEnabled: document.getElementById('veroEnabled'),
  turboListingMode: document.getElementById('turboListingMode')
};

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  setupEventListeners();
  await loadSettings();
  await loadAndDisplayStats();
  
  // 1秒ごとに表示を更新（リアルタイムカウンター用）
  setInterval(async () => {
    const stats = await loadStatistics();
    updateWorkTimeDisplay(stats);
  }, 1000);
});

function setupEventListeners() {
  // Menu navigation
  document.querySelectorAll('.menu-item').forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      const page = item.dataset.page;
      switchPage(page);
      
      // Close side menu on mobile if needed
      document.getElementById('sideMenu').classList.remove('open');
    });
  });

  // Hamburger menu
  document.getElementById('menuBtn')?.addEventListener('click', () => {
    document.getElementById('sideMenu').classList.add('open');
  });

  document.getElementById('closeMenuBtn')?.addEventListener('click', () => {
    document.getElementById('sideMenu').classList.remove('open');
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
      settingElements.autoGetOnPaste.checked = true;
      settingElements.autoMipAfterOptimize.checked = true;
      settingElements.autoClickOkAfterMip.checked = true;
    }
  });

  // History page buttons
  document.getElementById('exportSpreadsheetBtn')?.addEventListener('click', exportToSpreadsheet);
  document.getElementById('clearHistoryBtn')?.addEventListener('click', clearHistory);

  // Load history on page switch
  document.querySelectorAll('.menu-item[data-page="history"]').forEach(item => {
    item.addEventListener('click', () => {
      setTimeout(() => loadHistoryList(), 100);
    });
  });
}

function switchPage(page) {
  // Update menu items
  document.querySelectorAll('.menu-item').forEach(item => {
    item.classList.toggle('active', item.dataset.page === page);
  });

  // Update pages
  document.querySelectorAll('.page').forEach(p => {
    p.classList.remove('active');
  });
  const targetPage = document.getElementById(`${page}Page`);
  if (targetPage) targetPage.classList.add('active');

  // Update title
  const titles = {
    stats: '統計情報',
    history: 'ASIN履歴管理',
    automation: '自動化設定',
    basic: '基本設定',
    version: 'バージョン情報',
    links: '各種リンク'
  };
  if (pageTitle) pageTitle.textContent = titles[page] || 'ListerFlow Pro';

  // Reload stats when switching to stats page
  if (page === 'stats') loadAndDisplayStats();
}

// Statistics functions
// 作業時間のリアルタイムカウント開始
function updateWorkTimeDisplay(stats) {
  // 確定済み時間 + 現在進行中のセッション経過時間
  let confirmedMs = stats.totalWorkTimeToday || 0;
  let currentSessionMs = 0;
  
  if (stats.currentSessionStartTime && !stats.isCounterPaused) {
    currentSessionMs = Date.now() - stats.currentSessionStartTime;
  } else if (stats.currentSessionElapsedMs) {
    currentSessionMs = stats.currentSessionElapsedMs;
  }
  
  const totalMs = confirmedMs + currentSessionMs;

  if (statsElements.todayWorkingHours) {
    const totalSec = Math.floor(totalMs / 1000);
    const hours = Math.floor(totalSec / 3600);
    const minutes = Math.floor((totalSec % 3600) / 60);
    const seconds = totalSec % 60;
    statsElements.todayWorkingHours.textContent = `${hours}時間${String(minutes).padStart(2, '0')}分${String(seconds).padStart(2, '0')}秒`;
  }
  
  if (statsElements.listingSpeed) {
    const count = stats.todayListings || 0;
    const hours = totalMs / 3600000;
    const speedVal = hours > 0 ? (count / hours) : 0;
    const speedDisplay = speedVal.toFixed(1);
    
    let rank = "rank-very-slow";
    let rankText = "ゆったり🐢";
    if (speedVal >= 120) { rank = "rank-fastest"; rankText = "爆速🚀"; }
    else if (speedVal >= 60) { rank = "rank-fast"; rankText = "高速🏎️"; }
    else if (speedVal >= 30) { rank = "rank-normal"; rankText = "着実💪"; }
    else if (speedVal >= 10) { rank = "rank-slow"; rankText = "のんびり🚲"; }
    
    // トロフィー判定（content.jsと同期）
    const isMaxSpeed = speedVal >= (stats?.todayMaxSpeed || 0);
    if (isMaxSpeed && speedVal > 0) rankText += " 🏆";

    // バッジの種類または数値が変わった場合に更新
    const currentSpeedText = statsElements.listingSpeed.querySelector('span')?.textContent || '';
    const currentBadge = statsElements.listingSpeed.querySelector('.rank-badge')?.textContent || '';
    
    if (currentBadge !== rankText || currentSpeedText !== `${speedDisplay}品/時`) {
      statsElements.listingSpeed.innerHTML = `
        <span>${speedDisplay}品/時</span>
        <span class="rank-badge ${rank}">${rankText}</span>
      `;
    }
  }
}

async function loadAndDisplayStats() {
  try {
    const stats = await loadStatistics();
    const history = await loadHistory();

    // Display stats
    if (statsElements.todayListings) statsElements.todayListings.textContent = `${stats.todayListings || 0}件`;
    if (statsElements.weekListings) statsElements.weekListings.textContent = `${stats.weekListings || 0}件`;
    if (statsElements.totalListings) statsElements.totalListings.textContent = `${stats.totalListings || 0}件`;

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
    updateWorkTimeDisplay(stats);

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
      const rate = total > 0 ? Math.round(errors / total * 100) : 0;
      
      let color = "rgb(40, 167, 69)";
      let bgColor = "rgba(40, 167, 69, 0.1)";
      let emoji = "✨";
      
      if (rate > 50) { color = "rgb(220, 53, 69)"; bgColor = "rgba(220, 53, 69, 0.1)"; emoji = "😱"; }
      else if (rate > 20) { color = "rgb(253, 126, 20)"; bgColor = "rgba(253, 126, 20, 0.1)"; emoji = "🧐"; }
      
      statsElements.errorRateLabel.textContent = `${emoji} ${rate}%`;
      statsElements.errorRateLabel.style.color = color;
      statsElements.errorRateLabel.style.backgroundColor = bgColor;
      statsElements.errorRateLabel.style.borderColor = color.replace('rgb', 'rgba').replace(')', ', 0.2)');
    }
  } catch (err) {
    console.error('Failed to load stats:', err);
  }
}

async function loadStatistics() {
  const data = await chrome.storage.local.get([KEY_STATS]);
  let stats = data?.[KEY_STATS];

  if (!stats) {
    stats = {
      totalListings: 0,
      todayListings: 0,
      weekListings: 0,
      lastListingDate: null,
      totalWorkTimeToday: 0,
      lastResetDate: Date.now()
    };
  }

  // Daily reset
  const now = new Date();
  const lastReset = new Date(stats.lastResetDate || 0);
  if (now.toDateString() !== lastReset.toDateString()) {
    stats.todayListings = 0;
    stats.totalWorkTimeToday = 0;
    stats.lastResetDate = now.getTime();
    
    // Weekly reset (Monday)
    if (now.getDay() === 1) {
      stats.weekListings = 0;
    }
    await chrome.storage.local.set({ [KEY_STATS]: stats });
  }

  return stats;
}

async function resetStats() {
  if (!confirm('統計情報をリセットしますか？')) return;
  const stats = {
    totalListings: 0,
    todayListings: 0,
    weekListings: 0,
    lastListingDate: null,
    totalWorkTimeToday: 0,
    lastResetDate: Date.now(),
    isCounterPaused: true,
    currentSessionStartTime: null,
    currentSessionElapsedMs: 0
  };
  await chrome.storage.local.set({ [KEY_STATS]: stats });
  await loadAndDisplayStats();
  
  // 出品作業画面のUIを即座に更新させるためのメッセージ送信
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]) {
      chrome.tabs.sendMessage(tabs[0].id, { type: 'LFP_STATS_UPDATED' }).catch(() => {});
    }
  });
}

// Settings functions
async function loadSettings() {
  const data = await chrome.storage.sync.get([KEY_OPT]);
  const opt = data?.[KEY_OPT] || {};

  if (settingElements.apiKey) settingElements.apiKey.value = opt.apiKey || '';
  if (settingElements.model) settingElements.model.value = opt.model || 'gpt-4o-mini';
  
  // Automation & UI toggles
  if (settingElements.autoGetOnPaste) settingElements.autoGetOnPaste.checked = !!opt.autoGetOnPaste;
  if (settingElements.autoGetOnHistory) settingElements.autoGetOnHistory.checked = !!opt.autoGetOnHistory;
  if (settingElements.autoMipAfterOptimize) settingElements.autoMipAfterOptimize.checked = !!opt.autoMipAfterOptimize;
  if (settingElements.autoClickOkAfterMip) settingElements.autoClickOkAfterMip.checked = !!opt.autoClickOkAfterMip;
  if (settingElements.veroEnabled) settingElements.veroEnabled.checked = !!opt.veroEnabled;
  if (settingElements.turboListingMode) settingElements.turboListingMode.checked = !!opt.turboListingMode;
}

async function saveBasicSettings() {
  const opt = (await chrome.storage.sync.get([KEY_OPT]))[KEY_OPT] || {};
  opt.apiKey = settingElements.apiKey.value.trim();
  opt.model = settingElements.model.value;
  
  await chrome.storage.sync.set({ [KEY_OPT]: opt });
  alert('基本設定を保存しました');
}

async function saveAutomationSettings() {
  const opt = (await chrome.storage.sync.get([KEY_OPT]))[KEY_OPT] || {};
  opt.autoGetOnPaste = settingElements.autoGetOnPaste.checked;
  opt.autoGetOnHistory = settingElements.autoGetOnHistory.checked;
  opt.autoMipAfterOptimize = settingElements.autoMipAfterOptimize.checked;
  opt.autoClickOkAfterMip = settingElements.autoClickOkAfterMip.checked;
  opt.veroEnabled = settingElements.veroEnabled.checked;
  opt.turboListingMode = settingElements.turboListingMode.checked;
  
  await chrome.storage.sync.set({ [KEY_OPT]: opt });
  alert('自動化設定を保存しました');
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
async function loadHistory() {
  const data = await chrome.storage.local.get([KEY_HIST]);
  return data?.[KEY_HIST] || [];
}

async function loadHistoryList() {
  const history = await loadHistory();
  const listEl = document.getElementById('historyList');
  const countEl = document.getElementById('historyCountDetail');
  
  if (countEl) countEl.textContent = `${history.length}件`;
  if (!listEl) return;

  if (history.length === 0) {
    listEl.innerHTML = '<div class="no-data">履歴がありません</div>';
    return;
  }

  listEl.innerHTML = '';
  history.forEach((item, index) => {
    const card = document.createElement('div');
    card.className = 'history-card';
    
    let status = '出品完了';
    let isError = false;
    if (item.flags?.protected) { status = 'Protected'; isError = true; }
    else if (item.flags?.brand) { status = 'Brand Warning'; isError = true; }
    else if (item.flags?.no_listings) { status = 'No listings'; isError = true; }
    else if (item.flags?.already_listed) { status = 'Already Listed'; isError = true; }
    else if (item.flags?.no_item) { status = 'No Item'; isError = true; }

    const statusSpan = document.createElement('span');
    statusSpan.className = 'history-status';
    statusSpan.textContent = status;
    if (isError) {
      statusSpan.style.color = '#E07167';
      statusSpan.style.fontWeight = '600';
    } else {
      statusSpan.style.color = '#2e7d32';
      statusSpan.style.fontWeight = '600';
    }

    card.innerHTML = `
      <div class="history-main">
        <span class="history-asin">${item.asin}</span>
        <span class="history-status-inline"></span>
      </div>
      <button class="history-delete" data-index="${index}">✕</button>
    `;
    card.querySelector('.history-status-inline').appendChild(statusSpan);
    listEl.appendChild(card);
  });

  // Add delete events
  document.querySelectorAll('.history-delete').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const idx = parseInt(e.target.dataset.index);
      await deleteHistoryItem(idx);
    });
  });

  // 統計情報を更新
  await updateHistoryStats(history);
}

async function deleteHistoryItem(index) {
  const history = await loadHistory();
  history.splice(index, 1);
  await chrome.storage.local.set({ [KEY_HIST]: history });
  await loadHistoryList();
}

async function clearHistory() {
  if (!confirm('すべての履歴を削除しますか？')) return;
  // 履歴だけを削除し、統計情報（本日の作業時間など）は保持
  await chrome.storage.local.set({ [KEY_HIST]: [] });
  // 統計情報を再読み込みして表示を更新
  await loadAndDisplayStats();
  
  // 出品作業画面のUIを即座に更新させるためのメッセージ送信
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]) {
      chrome.tabs.sendMessage(tabs[0].id, { type: 'LFP_STATS_UPDATED' }).catch(() => {});
    }
  });
}

async function updateHistoryStats(history) {
  // 統計情報を更新（出品完了とエラーの件数）
  const completedCount = history.filter(h => {
    const f = h.flags || {};
    return !f.protected && !f.brand && !f.already_listed && !f.no_listings && !f.no_item;
  }).length;
  
  const errorCount = history.length - completedCount;
  
  if (statsElements.completedListingsCount) statsElements.completedListingsCount.textContent = `${completedCount}件`;
  // 他のエラー統計も必要に応じて更新
}

// Export functions
function exportToSpreadsheet() {
  chrome.storage.local.get([KEY_HIST], (data) => {
    const history = data[KEY_HIST] || [];
    if (history.length === 0) {
      alert('エクスポートする履歴がありません');
      return;
    }

    let csv = 'ASIN,Status,Date\n';
    history.forEach(item => {
      let status = 'Success';
      if (item.flags?.protected) status = 'Protected';
      else if (item.flags?.brand) status = 'Brand';
      else if (item.flags?.no_listings) status = 'No Listings';
      else if (item.flags?.already_listed) status = 'Already Listed';
      else if (item.flags?.no_item) status = 'No Item';
      
      const date = new Date(item.timestamp || Date.now()).toLocaleString();
      csv += `${item.asin},${status},"${date}"\n`;
    });

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `listerflow_history_${new Date().toISOString().slice(0,10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  });
}
