/* ListerFlow Pro – 作業時間計測 / 統計ポップアップ
   ※ store.js (STORE, workTimeUpdateInterval, observersInitialized) に依存
   ※ utils.js (isExtensionContextValid, showLfpConfirm) に依存
   ※ dom-helpers.js (findAsinInputSmart) に依存
   ※ content.js (UI, refreshListingCountUI) に依存
*/

/* ========== 作業時間計測ロジック（ASIN入力起点） ========== */

// workTimeUpdateInterval は store.js で宣言済み

/**
 * 統計情報の読み込み（バックグラウンドから取得）
 */
async function loadStatistics() {
  return await chrome.runtime.sendMessage({ type: "LFP_GET_STATS" });
}

/**
 * 統計情報の保存（バックグラウンドは自動保存するため、ここでは同期のみ）
 */
async function saveStatistics(stats) {
  // バックグラウンドの stats を更新するメッセージがないため、
  // 必要な操作（タイマー開始/停止等）をメッセージで送る運用にする
  return true;
}

/**
 * 作業時間計測の開始（ASIN入力時）
 */
async function startWorkTimeSession() {
  // SW側のタイマーを開始させる
  await chrome.runtime.sendMessage({ type: "LFP_TIMER_CONTROL", action: "start" });
  console.log('[LFP] 作業時間計測セッション開始');
}

/**
 * リアルタイムカウンター更新（1秒ごと）
 * 廃止: startWorkTimeUpdateTimer に一本化
 */
function startRealtimeCounter() {
  startWorkTimeUpdateTimer();
}

/**
 * 作業時間表示の更新（出品作業画面）
 * 廃止: refreshListingCountUI に一本化
 */
async function updateWorkTimeDisplay() {
  await refreshListingCountUI();
}

/**
 * 作業時間の確定（出品完了時）
 */
async function confirmWorkTime() {
  // 本来は出品成功時に呼ぶが、現在はバックグラウンドのタイマーで完結
  console.log('[LFP] confirmWorkTime はバックグラウンドで処理されます');
}

/**
 * 一時停止/再開ボタンの切り替え
 */
async function togglePauseResume() {
  const stats = await loadStatistics();
  if (!stats) return;

  const now = Date.now();
  const isPaused = !stats.isCounterPaused;
  stats.isCounterPaused = isPaused;

  if (isPaused) {
    console.log('[LFP] カウンター一時停止');
    if (stats.currentSessionStartTime) {
      const elapsed = now - stats.currentSessionStartTime;
      stats.totalWorkTimeToday = (stats.totalWorkTimeToday || 0) + elapsed;
      stats.currentSessionStartTime = null;
      stats.currentSessionElapsedMs = 0;
    }
    // バックグラウンドタイマー停止通知
    chrome.runtime.sendMessage({ type: "LFP_TIMER_CONTROL", action: "stop" });
  } else {
    console.log('[LFP] カウンター再開');
    stats.currentSessionStartTime = now;
    stats.currentSessionElapsedMs = 0;
    stats.lastAsinInputTime = now;
    // バックグラウンドタイマー開始通知
    chrome.runtime.sendMessage({ type: "LFP_TIMER_CONTROL", action: "start" });
    startRealtimeCounter();
  }

  await saveStatistics(stats);
  await refreshListingCountUI();
}

/**
 * ASIN入力時の処理（セッション開始）
 */
async function onAsinInput() {
  try {
    // 即座にUIを ⏸️ 表示に更新（ラグを視覚的にゼロにする）
    if (UI.pauseResumeBtn) {
      updatePauseResumeButtonUI(UI.pauseResumeBtn, false); // isPaused = false (作業中)
    }
    // バックグラウンドに通知
    await chrome.runtime.sendMessage({ type: "LFP_UPDATE_INPUT_TIME" });
    // 最新状態を反映
    await refreshListingCountUI();
  } catch (err) {
    if (err.message && err.message.includes('Extension context invalidated')) return;
    console.error('[LFP] onAsinInput error:', err);
  }
}


/**
 * 再生/一時停止トグルボタンを作成
 */
async function createPauseResumeButton() {
  const placeholder = document.getElementById('lfp-pause-resume-btn-placeholder');
  if (!placeholder || placeholder.querySelector('.lfp-pause-resume-btn')) {
    return; // 既に作成済み
  }

  // ボタン要素を作成
  const btn = document.createElement('button');
  btn.className = 'lfp-pause-resume-btn';
  btn.id = 'lfp-pause-resume-btn';
  btn.type = 'button';
  btn.title = 'クリックで再開/一時停止';

  // 初期状態を取得
  const stats = await loadStatistics();
  const isPaused = stats?.isCounterPaused || false;

  // アイコンと色を設定
  updatePauseResumeButtonUI(btn, isPaused);

  // クリックイベントを追加
  btn.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();

    await togglePauseResume();

    // ボタンのUI更新
    const updatedStats = await loadStatistics();
    updatePauseResumeButtonUI(btn, updatedStats?.isCounterPaused || false);
  });

  placeholder.appendChild(btn);
  UI.pauseResumeBtn = btn;

  console.log('[LFP] 再生/一時停止ボタンを作成しました');
}

/**
 * 再生/一時停止ボタンのUI更新
 */
function updatePauseResumeButtonUI(btn, isPaused) {
  if (isPaused) {
    // 一時停止中 → ▶️ボタン（再開待機）
    btn.innerHTML = '▶️';
    btn.style.backgroundColor = 'transparent';
    btn.title = 'クリックで再開';
  } else {
    // 作業中 → ⏸️ボタン（一時停止可能）
    btn.innerHTML = '⏸️';
    btn.style.backgroundColor = 'transparent';
    btn.title = 'クリックで一時停止';
  }
}

/* ---------- リアルタイムカウンター更新 ---------- */

/**
 * 出品作業画面のカウンターをリアルタイム更新（1秒ごと）
 */
function startWorkTimeUpdateTimer() {
  if (workTimeUpdateInterval) {
    clearInterval(workTimeUpdateInterval);
  }

  workTimeUpdateInterval = setInterval(async () => {
    // ASIN入力フィールドが存在する場合のみ更新
    const asinInput = findAsinInputSmart();
    if (!asinInput || !asinInput.isConnected) {
      return;
    }

    // 出品作業画面のカウンターを更新
    await refreshListingCountUI();
  }, 1000);

  console.log('[LFP] リアルタイムカウンター更新タイマーを開始しました');
}

function stopWorkTimeUpdateTimer() {
  if (workTimeUpdateInterval) {
    clearInterval(workTimeUpdateInterval);
    workTimeUpdateInterval = null;
    console.log('[LFP] リアルタイムカウンター更新タイマーを停止しました');
  }
}

// エクステンションコンテキストが無効化された際のクリーンアップ
window.addEventListener('unload', () => {
  stopWorkTimeUpdateTimer();
  if (observersInitialized) {
    // MutationObserverの停止などは必要に応じて追加
  }
});

// 定期的にコンテキストの有効性をチェックし、無効ならタイマーを止める
setInterval(() => {
  if (!isExtensionContextValid()) {
    stopWorkTimeUpdateTimer();
  }
}, 5000);

/* ---------- 統計ポップアップ ---------- */

/**
 * 拡張機能のコンテキストが有効かチェック
 */
function isExtensionValid() {
  return typeof chrome !== 'undefined' && chrome.runtime && !!chrome.runtime.id;
}

async function toggleStatsPopup() {
  if (!isExtensionValid()) {
    alert("拡張機能が更新されました。ページをリロードして再度お試しください。");
    return;
  }

  let popup = document.getElementById('lfp-stats-popup');

  if (popup && popup.classList.contains('show')) {
    popup.classList.remove('show');
    return;
  }

  if (!popup) {
    popup = document.createElement('div');
    popup.id = 'lfp-stats-popup';
    popup.className = 'lfp-stats-popup';
    document.body.appendChild(popup);

    // 外側クリックで閉じる（リンク自体は除外）
    document.addEventListener('click', (e) => {
      if (popup.classList.contains('show') &&
        !popup.contains(e.target) &&
        e.target.id !== 'lfp-open-stats-btn') {
        popup.classList.remove('show');
      }
    });
  }

  popup.classList.add('show');
  await renderStatsOnlyPopup(popup);
}

/**
 * 統計情報のみを表示するシンプルなポップアップをレンダリング (方針転換)
 */
async function renderStatsOnlyPopup(popup) {
  try {
    if (!isExtensionValid()) throw new Error("Context invalidated");

    const stats = await chrome.runtime.sendMessage({ type: "LFP_GET_STATS" });
    if (!stats) return;

    // 履歴からフラグを集計
    const histData = await chrome.storage.local.get(["lfp_asin_history_v1"]);
    const history = histData?.["lfp_asin_history_v1"] || [];

    const completedCount = history.filter(h => {
      const f = h.flags || {};
      return !f.protected && !f.brand && !f.already_listed && !f.no_listings && !f.no_item;
    }).length;
    const protectedCount = history.filter(h => h.flags?.protected === true).length;
    const brandCount = history.filter(h => h.flags?.brand === true).length;
    const noListingsCount = history.filter(h => h.flags?.no_listings === true).length;
    const alreadyListedCount = history.filter(h => h.flags?.already_listed === true).length;
    const noItemCount = history.filter(h => h.flags?.no_item === true).length;

    const totalErrorCount = protectedCount + brandCount + noListingsCount + alreadyListedCount + noItemCount;
    const totalProcessed = completedCount + totalErrorCount;
    const errorRate = totalProcessed > 0 ? Math.round((totalErrorCount / totalProcessed) * 100) : 0;
    const errorEmoji = errorRate === 0 ? '✨' : errorRate < 10 ? '👍' : errorRate < 30 ? '⚠️' : '🔴';

    // 時間フォーマット
    const totalMs = stats.totalWorkTimeToday || 0;
    const totalSec = Math.floor(totalMs / 1000);
    const hours = Math.floor(totalSec / 3600);
    const mins = Math.floor((totalSec % 3600) / 60);
    const secs = totalSec % 60;
    const timeStr = `${hours}時間${String(mins).padStart(2, '0')}分${String(secs).padStart(2, '0')}秒`;

    const hVal = (totalMs / 3600000).toFixed(2);
    const speed = hVal > 0 ? (stats.todayListings / hVal).toFixed(1) : 0;

    let feedback = "ゆったり🐢";
    let rankClass = "rank-very-slow";
    if (speed >= 120) { feedback = "爆速🚀"; rankClass = "rank-fastest"; }
    else if (speed >= 60) { feedback = "高速🏎️"; rankClass = "rank-fast"; }
    else if (speed >= 30) { feedback = "着実💪"; rankClass = "rank-normal"; }
    else if (speed >= 10) { feedback = "のんびり🚲"; rankClass = "rank-slow"; }

    // プランバッジ (作業画面の表示ロジックと合わせる)
    const currentPlan = (STORE.license.plan || "free").toLowerCase();
    let planBadgeText = "Free";
    let planBadgeBg = "#6c757d";

    if (currentPlan === 'premium') {
      planBadgeText = "Premium";
      planBadgeBg = "#d63384";
    } else if (currentPlan === 'pro' && STORE.license.isProTrial) {
      planBadgeText = "Pro (Trial)";
      planBadgeBg = "#198754";
    } else if (currentPlan === 'pro') {
      planBadgeText = "Pro";
      planBadgeBg = "#1a73e8";
    } else if (STORE.license.isProTrial) {
      planBadgeText = "Pro (Trial)";
      planBadgeBg = "#198754";
    }

    // 日時フォーマット
    let lastTimeStr = '-';
    if (stats.lastListingDate) {
      const d = new Date(stats.lastListingDate);
      lastTimeStr = `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    }

    popup.innerHTML = `
    <div class="header">
      <h1 class="title">統計情報</h1>
      <span style="padding: 2px 8px; border-radius: 9px; color: #fff; background-color: ${planBadgeBg}; font-size: 11px; font-weight: bold;">${planBadgeText}</span>
    </div>
    <div class="content">
      <div class="stats-section">
        <h2>📊 出品統計</h2>
        <div class="stats-grid">
          <div class="stat-item"><div class="stat-label">本日の出品</div><div class="stat-value">${stats.todayListings || 0}件</div></div>
          <div class="stat-item"><div class="stat-label">今週の出品</div><div class="stat-value">${stats.weekListings || 0}件</div></div>
          <div class="stat-item"><div class="stat-label">累計出品</div><div class="stat-value">${stats.totalListings || 0}件</div></div>
          <div class="stat-item"><div class="stat-label">最後の出品</div><div class="stat-value">${lastTimeStr}</div></div>
        </div>
      </div>
      <div class="stats-section">
        <h2>🚀 作業効率</h2>
        <div class="stats-grid">
          <div class="stat-item"><div class="stat-label">本日の作業時間</div><div class="stat-value">${timeStr}</div></div>
          <div class="stat-item">
            <div class="stat-label">出品速度</div>
            <div class="stat-value">${speed}品/時 <span class="rank-badge ${rankClass}">${feedback}</span></div>
          </div>
        </div>
      </div>
      <div class="stats-section">
        <h2>📋 ASIN履歴 <span style="font-size:11px; margin-left:8px; padding:2px 8px; background:#fff3e0; color:#fd7e14; border-radius:12px; font-weight:bold;">エラー率: ${errorRate}% ${errorEmoji}</span></h2>
        <div class="stats-grid tri">
          <div class="stat-item"><div class="stat-label">出品完了</div><div class="stat-value">${completedCount}</div></div>
          <div class="stat-item"><div class="stat-label">⚠️Prot.</div><div class="stat-value">${protectedCount}</div></div>
          <div class="stat-item"><div class="stat-label">🛡️Brand</div><div class="stat-value">${brandCount}</div></div>
          <div class="stat-item"><div class="stat-label">📭NoList</div><div class="stat-value">${noListingsCount}</div></div>
          <div class="stat-item"><div class="stat-label">🔍NoItem</div><div class="stat-value">${noItemCount}</div></div>
          <div class="stat-item"><div class="stat-label">🔄Already</div><div class="stat-value">${alreadyListedCount}</div></div>
        </div>
      </div>
      <div style="padding: 10px 0 20px 0; text-align: center;">
        <button class="btn-secondary" id="lfp-popup-reset-stats" style="width: 100%; padding: 8px;">統計をリセット</button>
      </div>
    </div>
  `;

    popup.querySelector('#lfp-popup-reset-stats').onclick = async () => {
      if (!isExtensionValid()) {
        alert("拡張機能が更新されました。ページをリロードしてください。");
        return;
      }
      const confirmed = await showLfpConfirm('統計情報をリセットしますか？', '統計リセット');
      if (confirmed) {
        chrome.runtime.sendMessage({ type: 'RESET_STATS' }, async (response) => {
          if (response && response.ok) {
            await renderStatsOnlyPopup(popup);
            await refreshListingCountUI();
          }
        });
      }
    };
  } catch (err) {
    console.warn("[LFP] Failed to render popup (context might be invalidated):", err);
    popup.innerHTML = `
        <div style="padding: 20px; text-align: center; color: #d32f2f;">
          <h3 style="margin-top:0;">⚠️ エラー</h3>
          <p style="font-size:12px; line-height:1.4;">拡張機能の情報が読み取れませんでした。<br>ページを一度<b>再読み込み</b>してください。</p>
          <button class="btn-primary" onclick="location.reload()" style="margin-top:10px;">リロードする</button>
        </div>
      `;
  }
}
