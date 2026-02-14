// popup.js - ListerFlow Pro

const KEY_STATS = 'lfp_stats';

document.addEventListener('DOMContentLoaded', async () => {
  // 初期表示
  await updateDisplay();
  
  // 1秒ごとに表示を更新
  setInterval(updateDisplay, 1000);
  
  // リセットボタン
  document.getElementById('reset-stats')?.addEventListener('click', resetStats);
  document.getElementById('clear-history')?.addEventListener('click', clearHistory);
  
  // 設定ボタン
  document.getElementById('open-options')?.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });
});

async function updateDisplay() {
  const data = await chrome.storage.local.get([KEY_STATS]);
  const stats = data[KEY_STATS];
  if (!stats) return;

  // 件数表示
  document.getElementById('today-listings').textContent = stats.todayListings || 0;
  document.getElementById('total-listings').textContent = stats.totalListings || 0;
  
  // 時間表示
  let totalMs = stats.totalWorkTimeToday || 0;
  if (!stats.isCounterPaused && stats.currentSessionStartTime) {
    totalMs += (Date.now() - stats.currentSessionStartTime);
  }
  
  const totalSec = Math.floor(totalMs / 1000);
  const hours = Math.floor(totalSec / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  document.getElementById('work-time').textContent = 
    `${hours}時間${String(mins).padStart(2, '0')}分${String(secs).padStart(2, '0')}秒`;

  // 時速とバッジ
  const hoursFloat = totalMs / (1000 * 60 * 60);
  const speed = hoursFloat > 0 ? (stats.todayListings / hoursFloat) : 0;
  document.getElementById('current-speed').textContent = speed.toFixed(1);
  document.getElementById('max-speed').textContent = (stats.todayMaxSpeed || 0).toFixed(1);

  updateBadge(speed);
}

function updateBadge(speed) {
  const badge = document.getElementById('speed-badge');
  if (!badge) return;

  let text = '計測中...';
  let color = '#666';
  let bgColor = '#f0f0f0';

  if (speed >= 50) {
    text = '爆速🚀';
    color = '#fff';
    bgColor = '#ff4757';
  } else if (speed >= 30) {
    text = '着実💪';
    color = '#fff';
    bgColor = '#2ed573';
  } else if (speed >= 10) {
    text = 'のんびり🚲';
    color = '#fff';
    bgColor = '#ffa502';
  } else if (speed > 0) {
    text = '準備中...';
    color = '#666';
    bgColor = '#e1e1e1';
  }

  badge.textContent = text;
  badge.style.color = color;
  badge.style.backgroundColor = bgColor;
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
