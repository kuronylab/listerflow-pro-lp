// popup.js - ListerFlow Pro

const KEY_STATS = 'lfp_stats';

document.addEventListener('DOMContentLoaded', async () => {
  // メニュー制御の初期化
  initMenu();
  
  // 初期表示
  await updateDisplay();
  
  // 1秒ごとに表示を更新
  setInterval(updateDisplay, 1000);
  
  // リセットボタン
  document.getElementById('resetStatsBtn')?.addEventListener('click', resetStats);
  document.getElementById('clearHistoryBtn')?.addEventListener('click', clearHistory);
  
  // 設定保存ボタン（既存のページ遷移に合わせて必要なら追加）
  document.getElementById('saveAutomationBtn')?.addEventListener('click', () => alert('設定を保存しました（デモ）'));
  document.getElementById('saveBasicBtn')?.addEventListener('click', () => alert('設定を保存しました（デモ）'));
});

function initMenu() {
  const menuBtn = document.getElementById('menuBtn');
  const closeMenuBtn = document.getElementById('closeMenuBtn');
  const sideMenu = document.getElementById('sideMenu');
  const menuItems = document.querySelectorAll('.menu-item');
  const pages = document.querySelectorAll('.page');
  const pageTitle = document.getElementById('pageTitle');

  menuBtn?.addEventListener('click', () => sideMenu?.classList.add('active'));
  closeMenuBtn?.addEventListener('click', () => sideMenu?.classList.remove('active'));

  menuItems.forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      const targetPage = item.getAttribute('data-page');
      
      // アクティブ状態の切り替え
      menuItems.forEach(i => i.classList.remove('active'));
      item.classList.add('active');
      
      pages.forEach(page => {
        if (page.id === `${targetPage}Page`) {
          page.classList.add('active');
          pageTitle.textContent = item.querySelector('.menu-text')?.textContent || 'ListerFlow Pro';
        } else {
          page.classList.remove('active');
        }
      });
      
      sideMenu?.classList.remove('active');
    });
  });
}

async function updateDisplay() {
  const data = await chrome.storage.local.get([KEY_STATS]);
  const stats = data[KEY_STATS];
  if (!stats) return;

  // 統計情報ページの要素更新（ガード節付き）
  const setEl = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  };

  setEl('todayListings', `${stats.todayListings || 0}件`);
  setEl('weekListings', `${stats.weekListings || 0}件`);
  setEl('totalListings', `${stats.totalListings || 0}件`);
  setEl('completedListingsCount', `${stats.todayListings || 0}件`); // ASIN履歴セクション用

  // 時間表示
  let totalMs = stats.totalWorkTimeToday || 0;
  if (!stats.isCounterPaused && stats.currentSessionStartTime) {
    totalMs += (Date.now() - stats.currentSessionStartTime);
  }
  
  const totalSec = Math.floor(totalMs / 1000);
  const hours = Math.floor(totalSec / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  const timeStr = `${hours}時間${String(mins).padStart(2, '0')}分${String(secs).padStart(2, '0')}秒`;
  
  setEl('todayWorkingHours', timeStr);

  // 時速とバッジ
  const hoursFloat = totalMs / (1000 * 60 * 60);
  const speed = hoursFloat > 0 ? (stats.todayListings / hoursFloat) : 0;
  
  const speedEl = document.getElementById('listingSpeed');
  if (speedEl) {
    const speedVal = speedEl.querySelector('span:first-child');
    const badge = speedEl.querySelector('.rank-badge');
    if (speedVal) speedVal.textContent = `${speed.toFixed(1)}品/時`;
    if (badge) updateBadgeUI(badge, speed);
  }

  // 最後の出品
  if (stats.lastListingDate) {
    const date = new Date(stats.lastListingDate);
    setEl('lastListing', `${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}`);
  }
}

function updateBadgeUI(badge, speed) {
  let text = '準備中...';
  let className = 'rank-very-slow';

  if (speed >= 50) {
    text = '爆速🚀';
    className = 'rank-speedy';
  } else if (speed >= 30) {
    text = '着実💪';
    className = 'rank-steady';
  } else if (speed >= 10) {
    text = 'のんびり🚲';
    className = 'rank-slow';
  }

  badge.textContent = text;
  badge.className = `rank-badge ${className}`;
}

async function resetStats() {
  if (!confirm('本日の統計（件数・時間）をリセットしますか？')) return;
  
  const data = await chrome.storage.local.get([KEY_STATS]);
  const stats = data[KEY_STATS] || {};
  
  const newStats = {
    ...stats,
    todayListings: 0,
    totalWorkTimeToday: 0,
    todayMaxSpeed: 0,
    isCounterPaused: true,
    currentSessionStartTime: null,
    currentSessionElapsedMs: 0
  };
  
  await chrome.storage.local.set({ [KEY_STATS]: newStats });
  chrome.runtime.sendMessage({ type: 'LFP_STATS_UPDATED' });
  await updateDisplay();
}

async function clearHistory() {
  if (!confirm('ASIN履歴をすべて削除しますか？')) return;
  await chrome.storage.local.set({ lfp_asin_history: [] });
  chrome.runtime.sendMessage({ type: 'LFP_STATS_UPDATED' });
  alert('履歴を削除しました');
}
