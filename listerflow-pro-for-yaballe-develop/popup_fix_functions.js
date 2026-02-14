// popup.jsの修正対象関数

// 修正1: startWorkTimeCounter関数
function startWorkTimeCounter() {
  // 新規: 1秒ごとに統計情報を再読み込み、ポップアップを動的に更新
  if (workTimeUpdateInterval) {
    clearInterval(workTimeUpdateInterval);
  }
  
  workTimeUpdateInterval = setInterval(async () => {
    await loadAndDisplayStats();
  }, 1000);
}

// 修正2: updateWorkTimeDisplay関数
function updateWorkTimeDisplay(stats) {
  if (statsElements.todayWorkingHours) {
    // 確定済み時間 + 現在進行中のセッション経過時間
    let confirmedMs = stats.totalWorkTimeToday || 0;
    let currentSessionMs = 0;
    
    // 現在進行中のセッション経過時間を追加（一時停止中でない場合）
    if (stats.currentSessionStartTime && !stats.isCounterPaused) {
      const now = Date.now();
      currentSessionMs = now - stats.currentSessionStartTime;
    } else if (stats.currentSessionElapsedMs) {
      currentSessionMs = stats.currentSessionElapsedMs;
    }
    
    const totalMs = confirmedMs + currentSessionMs;
    const totalSec = Math.floor(totalMs / 1000);
    const hours = Math.floor(totalSec / 3600);
    const minutes = Math.floor((totalSec % 3600) / 60);
    const seconds = totalSec % 60;
    statsElements.todayWorkingHours.textContent = `${hours}時間${String(minutes).padStart(2, '0')}分${String(seconds).padStart(2, '0')}秒`;
  }
  
  if (statsElements.listingSpeed) {
    // 新規: バッジの種類が変わる時のみ更新
    let confirmedMs = stats.totalWorkTimeToday || 0;
    let currentSessionMs = 0;
    
    if (stats.currentSessionStartTime && !stats.isCounterPaused) {
      const now = Date.now();
      currentSessionMs = now - stats.currentSessionStartTime;
    } else if (stats.currentSessionElapsedMs) {
      currentSessionMs = stats.currentSessionElapsedMs;
    }
    
    const totalMs = confirmedMs + currentSessionMs;
    const count = stats.todayListings || 0;
    const hours = totalMs / 3600000;
    const speedVal = hours > 0 ? (count / hours) : 0;
    const speedDisplay = speedVal.toFixed(1);
    
    // 前回のバッジを保持している場合、種類が変わらない限り更新しない
    const currentBadge = statsElements.listingSpeed.querySelector('.rank-badge')?.textContent || '';
    
    let rank = "rank-very-slow";
    let rankText = "ゆったり🐢";
    if (speedVal >= 120) { rank = "rank-fastest"; rankText = "爆速🚀"; }
    else if (speedVal >= 60) { rank = "rank-fast"; rankText = "高速🏎️"; }
    else if (speedVal >= 30) { rank = "rank-normal"; rankText = "着実💪"; }
    else if (speedVal >= 10) { rank = "rank-slow"; rankText = "のんびり🚲"; }

    // バッジが変わった場合のみ更新
    if (currentBadge !== rankText) {
      statsElements.listingSpeed.innerHTML = `
        <span>${speedDisplay}品/時</span>
        <span class="rank-badge ${rank}">${rankText}</span>
      `;
    }
  }
}
