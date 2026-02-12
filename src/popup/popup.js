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

  // Stats elements (nullチェックを容易にするため)
  const getEl = (id) => document.getElementById(id);
  statsElements = {
    todayListings: getEl('todayListings'),
    weekListings: getEl('weekListings'),
    totalListings: getEl('totalListings'),
    lastListing: getEl('lastListing'),
    completedListingsCount: getEl('completedListingsCount'),
    protectedCount: getEl('protectedCount'),
    brandCount: getEl('brandCount'),
    noListingsCount: getEl('noListingsCount'),
    alreadyListedCount: getEl('alreadyListedCount'),
    noItemCount: getEl('noItemCount'),
    todayWorkingHours: getEl('todayWorkingHours'),
    listingSpeed: getEl('listingSpeed'),
    errorRateLabel: getEl('errorRateLabel')
  };

  // Setting elements
  settingElements = {
    apiKey: getEl('apiKey'),
    model: getEl('model'),
    autoGetOnPaste: getEl('autoGetOnPaste'),
    autoGetOnHistory: getEl('autoGetOnHistory'),
    autoMipAfterOptimize: getEl('autoMipAfterOptimize'),
    autoClickOkAfterMip: getEl('autoClickOkAfterMip'),
    quickMipButton: getEl('quickMipButton'),
    highlightOptimize: getEl('highlightOptimize'),
    historyEnabled: getEl('historyEnabled'),
    veroEnabled: getEl('veroEnabled'),
    turboListingMode: getEl('turboListingMode')
  };

  // Version elements
  const versionNumber = getEl('versionNumber');
  const releaseDate = getEl('releaseDate');
  
  const manifest = chrome.runtime.getManifest();
  if (versionNumber) versionNumber.textContent = `v${manifest.version}`;
  if (releaseDate) releaseDate.textContent = '2026年1月26日';
}

function setupEventListeners() {
  menuBtn?.addEventListener('click', () => sideMenu?.classList.add('open'));
  closeMenuBtn?.addEventListener('click', () => sideMenu?.classList.remove('open'));

  document.querySelectorAll('.menu-item').forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      const page = item.dataset.page;
      switchPage(page);
      sideMenu?.classList.remove('open');
    });
  });

  getEl('resetStatsBtn')?.addEventListener('click', resetStats);
  getEl('showKeyBtn')?.addEventListener('click', toggleApiKeyVisibility);
  getEl('saveBasicBtn')?.addEventListener('click', saveBasicSettings);
  getEl('saveAutomationBtn')?.addEventListener('click', saveAutomationSettings);

  settingElements.turboListingMode?.addEventListener('change', (e) => {
    if (e.target.checked) {
      ['autoGetOnPaste', 'autoGetOnHistory', 'autoMipAfterOptimize', 'autoClickOkAfterMip', 'quickMipButton'].forEach(id => {
        if (settingElements[id]) settingElements[id].checked = true;
      });
    }
  });

  getEl('exportSpreadsheetBtn')?.addEventListener('click', exportToSpreadsheet);
  getEl('clearHistoryBtn')?.addEventListener('click', clearHistory);
}

function switchPage(page) {
  document.querySelectorAll('.menu-item').forEach(item => {
    item.classList.toggle('active', item.dataset.page === page);
  });

  document.querySelectorAll('.page').forEach(p => {
    p.classList.toggle('active', p.id === `${page}Page`);
  });

  const titles = { stats: '統計情報', basic: '基本設定', automation: '自動化設定', history: 'ASIN履歴管理', version: 'バージョン情報', links: '各種リンク' };
  if (pageTitle) pageTitle.textContent = titles[page] || '設定';

  if (page === 'history') loadHistoryList();
  if (page === 'stats') loadAndDisplayStats();
}

async function loadAndDisplayStats() {
  try {
    const stats = await loadStatistics();
    const history = await loadHistory();

    // Basic stats
    if (statsElements.todayListings) statsElements.todayListings.textContent = `${stats.todayListings || 0}件`;
    if (statsElements.weekListings) statsElements.weekListings.textContent = `${stats.weekListings || 0}件`;
    if (statsElements.totalListings) statsElements.totalListings.textContent = `${stats.totalListings || 0}件`;

    if (statsElements.lastListing) {
      if (stats.lastListingDate) {
        const d = new Date(stats.lastListingDate);
        statsElements.lastListing.textContent = `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
      } else {
        statsElements.lastListing.textContent = '-';
      }
    }

    // Efficiency
    if (statsElements.todayWorkingHours) {
      const ms = stats.totalWorkTimeToday || 0;
      statsElements.todayWorkingHours.textContent = `${Math.floor(ms / 3600000)}時間${Math.floor((ms % 3600000) / 60000)}分`;
    }

    if (statsElements.listingSpeed) {
      const hours = (stats.totalWorkTimeToday || 0) / 3600000;
      const speed = hours > 0 ? ((stats.todayListings || 0) / hours).toFixed(1) : "0.0";
      let rank = "rank-very-slow", text = "ゆったり🐢";
      const s = parseFloat(speed);
      if (s >= 100) { rank = "rank-fastest"; text = "爆速🚀"; }
      else if (s >= 60) { rank = "rank-fast"; text = "高速🏎️"; }
      else if (s >= 30) { rank = "rank-normal"; text = "普通🛵"; }
      else if (s >= 10) { rank = "rank-slow"; text = "のんびり🚲"; }
      statsElements.listingSpeed.innerHTML = `<span>${speed}品/時</span> <span class="rank-badge ${rank}">${text}</span>`;
    }

    // History counters
    const completed = history.filter(h => !h.flags || Object.values(h.flags).every(v => !v)).length;
    const getCount = (key) => history.filter(h => h.flags?.[key]).length;

    if (statsElements.completedListingsCount) statsElements.completedListingsCount.textContent = `${completed}件`;
    if (statsElements.protectedCount) statsElements.protectedCount.textContent = `${getCount('protected')}件`;
    if (statsElements.brandCount) statsElements.brandCount.textContent = `${getCount('brand')}件`;
    if (statsElements.noListingsCount) statsElements.noListingsCount.textContent = `${getCount('no_listings')}件`;
    if (statsElements.alreadyListedCount) statsElements.alreadyListedCount.textContent = `${getCount('already_listed')}件`;
    if (statsElements.noItemCount) statsElements.noItemCount.textContent = `${getCount('no_item')}件`;

    if (statsElements.errorRateLabel) {
      const rate = history.length > 0 ? ((history.length - completed) / history.length * 100).toFixed(0) : 0;
      statsElements.errorRateLabel.textContent = `エラー率: ${rate}%`;
      statsElements.errorRateLabel.className = rate > 50 ? "error-rate-high" : (rate > 20 ? "error-rate-mid" : "error-rate-low");
    }
  } catch (err) {
    console.error('[Popup] Error loading stats:', err);
  }
}

async function loadStatistics() {
  const data = await chrome.storage.local.get([KEY_STATS]);
  let stats = data?.[KEY_STATS] || { totalListings: 0, todayListings: 0, weekListings: 0, totalWorkTimeToday: 0, lastResetDate: Date.now() };
  const now = new Date(), last = new Date(stats.lastResetDate);
  if (now.toDateString() !== last.toDateString()) {
    stats.todayListings = 0; stats.totalWorkTimeToday = 0;
    if (now.getDay() < last.getDay() || (now.getDay() === 0 && last.getDay() !== 0)) stats.weekListings = 0;
    stats.lastResetDate = now.getTime();
    await chrome.storage.local.set({ [KEY_STATS]: stats });
  }
  return stats;
}

async function resetStats() {
  if (!confirm('統計情報をリセットしますか？')) return;
  const stats = { totalListings: 0, todayListings: 0, weekListings: 0, totalWorkTimeToday: 0, lastResetDate: Date.now() };
  await chrome.storage.local.set({ [KEY_STATS]: stats });
  await loadAndDisplayStats();
}

async function loadSettings() {
  const DEFAULTS = { apiKey: "", model: "gpt-4o-mini", veroEnabled: true, autoGetOnPaste: true, autoGetOnHistory: true, autoMipAfterOptimize: false, quickMipButton: true, highlightOptimize: true, historyEnabled: true, autoClickOkAfterMip: true, turboListingMode: false };
  const data = await chrome.storage.sync.get([KEY_OPT]);
  const opt = { ...DEFAULTS, ...(data?.[KEY_OPT] || {}) };
  Object.keys(settingElements).forEach(k => {
    if (!settingElements[k]) return;
    if (settingElements[k].type === 'checkbox') settingElements[k].checked = opt[k];
    else settingElements[k].value = opt[k];
  });
}

async function saveBasicSettings() {
  const data = await chrome.storage.sync.get([KEY_OPT]);
  const opt = { ...(data?.[KEY_OPT] || {}), apiKey: settingElements.apiKey?.value.trim(), model: settingElements.model?.value };
  await chrome.storage.sync.set({ [KEY_OPT]: opt });
  alert('設定を保存しました。');
}

async function saveAutomationSettings() {
  const data = await chrome.storage.sync.get([KEY_OPT]);
  const opt = { ...(data?.[KEY_OPT] || {}) };
  Object.keys(settingElements).forEach(k => {
    if (settingElements[k]?.type === 'checkbox') opt[k] = settingElements[k].checked;
  });
  await chrome.storage.sync.set({ [KEY_OPT]: opt });
  alert('設定を保存しました。');
}

function toggleApiKeyVisibility() {
  const input = settingElements.apiKey;
  if (!input) return;
  input.type = input.type === 'password' ? 'text' : 'password';
  document.getElementById('showKeyBtn').textContent = input.type === 'password' ? '表示' : '隠す';
}

async function loadHistory() {
  const data = await chrome.storage.local.get([KEY_HIST]);
  return Array.isArray(data?.[KEY_HIST]) ? data[KEY_HIST] : [];
}

async function loadHistoryList() {
  const list = getEl('historyList');
  if (!list) return;
  list.innerHTML = '<div class="loading">読み込み中...</div>';
  const history = await loadHistory();
  if (getEl('historyCountDetail')) getEl('historyCountDetail').textContent = `${history.length}件`;
  if (history.length === 0) { list.innerHTML = '<div class="loading">履歴がありません</div>'; return; }
  list.innerHTML = '';
  [...history].reverse().forEach((item, i) => {
    const idx = history.length - 1 - i;
    const div = document.createElement('div');
    div.className = 'history-item';
    const flags = [];
    if (item.flags?.protected) flags.push('Protected');
    if (item.flags?.brand) flags.push('Brand');
    if (item.flags?.already_listed) flags.push('Already listed');
    if (item.flags?.no_listings) flags.push('No listings');
    if (item.flags?.no_item) flags.push('No item');
    div.innerHTML = `<div class="history-asin">${item.asin}</div><div class="history-flags">${flags.length > 0 ? flags.join(', ') : '-'}</div><button class="history-delete-btn" data-index="${idx}">✕</button>`;
    div.querySelector('.history-delete-btn').addEventListener('click', (e) => deleteHistoryItem(parseInt(e.target.dataset.index)));
    list.appendChild(div);
  });
}

async function deleteHistoryItem(idx) {
  const history = await loadHistory();
  history.splice(idx, 1);
  await chrome.storage.local.set({ [KEY_HIST]: history });
  await loadHistoryList();
  await loadAndDisplayStats();
}

async function clearHistory() {
  if (!confirm('すべての履歴を削除しますか？')) return;
  await chrome.storage.local.set({ [KEY_HIST]: [] });
  await loadHistoryList();
  await loadAndDisplayStats();
}

function exportToSpreadsheet() {
  chrome.tabs.create({ url: chrome.runtime.getURL('src/popup/export.html') });
}
function getEl(id) { return document.getElementById(id); }
