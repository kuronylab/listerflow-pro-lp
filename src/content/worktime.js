/* ListerFlow Pro – 作業時間計測 / 統計ポップアップ
   ※ store.js (STORE, workTimeUpdateInterval, observersInitialized) に依存
   ※ utils.js (isExtensionContextValid, showLfpConfirm) に依存
   ※ dom-helpers.js (findAsinInputSmart) に依存
   ※ content.js (UI, refreshListingCountUI) に依存
*/

/* ========== 作業時間計測ロジック（ASIN入力起点） ========== */

// workTimeUpdateInterval は store.js で宣言済み
let statsPopupUpdateInterval = null;

/**
 * 統計情報の読み込み（バックグラウンドから取得）
 */
async function loadStatistics() {
  if (!isExtensionContextValid()) return null;
  try {
    return await chrome.runtime.sendMessage({ type: "LFP_GET_STATS" });
  } catch (err) {
    return null;
  }
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
  if (!isExtensionContextValid()) return;
  try {
    // SW側のタイマーを開始させる
    await chrome.runtime.sendMessage({ type: "LFP_TIMER_CONTROL", action: "start" });
    return true;
  } catch (err) {
    // ignore invalidated context
  }
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
  if (!isExtensionContextValid()) return;
  try {
    // 本来は出品成功時に呼ぶが、現在はバックグラウンドのタイマーで完結
    // console.log('[LFP] confirmWorkTime はバックグラウンドで処理されます');
  } catch (err) {
    // ignore invalidated context
  }
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
    if (isExtensionContextValid()) {
      chrome.runtime.sendMessage({ type: "LFP_TIMER_CONTROL", action: "stop" }).catch(() => {});
    }
  } else {
    console.log('[LFP] カウンター再開');
    stats.currentSessionStartTime = now;
    stats.currentSessionElapsedMs = 0;
    stats.lastAsinInputTime = now;
    // バックグラウンドタイマー開始通知
    if (isExtensionContextValid()) {
      chrome.runtime.sendMessage({ type: "LFP_TIMER_CONTROL", action: "start" }).catch(() => {});
    }
    startRealtimeCounter();
  }

  await saveStatistics(stats);
  await refreshListingCountUI();
}

/**
 * ASIN入力時の処理（セッション開始）
 */
async function onAsinInput() {
  // v1.2.1: 作業時間計測はPro以上限定
  const currentPlan = (STORE.license?.plan || "free").toLowerCase();
  const isProTrial = !!STORE.license?.isProTrial;
  if (currentPlan === "free" && !isProTrial) return;

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
  // v1.2.1: 作業時間計測はPro以上限定
  const currentPlan = (STORE.license?.plan || "free").toLowerCase();
  const isProTrial = !!STORE.license?.isProTrial;
  if (currentPlan === "free" && !isProTrial) return;

  const placeholder = document.getElementById('lfp-pause-resume-btn-placeholder');
  if (!placeholder || placeholder.querySelector('.lfp-pause-resume-btn')) {
    return; // 既に作成済み
  }

  // ボタン要素を作成
  const btn = document.createElement('button');
  btn.className = 'lfp-pause-resume-btn';
  btn.id = 'lfp-pause-resume-btn';
  btn.type = 'button';
  btn.title = chrome.i18n.getMessage("uiPauseResume");

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
    btn.title = chrome.i18n.getMessage("uiResume");
  } else {
    // 作業中 → ⏸️ボタン（一時停止可能）
    btn.innerHTML = '⏸️';
    btn.style.backgroundColor = 'transparent';
    btn.title = chrome.i18n.getMessage("uiPause");
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
window.addEventListener('pagehide', () => {
  stopWorkTimeUpdateTimer();
  if (STORE.state.observersInitialized) {
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

async function toggleStatsPopup() {
  if (!isExtensionContextValid()) {
    alert(chrome.i18n.getMessage("msgExtensionUpdated"));
    return;
  }

  let popup = document.getElementById('lfp-stats-popup');

  if (popup && popup.classList.contains('show')) {
    popup.classList.remove('show');
    if (statsPopupUpdateInterval) {
      clearInterval(statsPopupUpdateInterval);
      statsPopupUpdateInterval = null;
    }
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

  // 動的更新タイマー開始
  if (statsPopupUpdateInterval) clearInterval(statsPopupUpdateInterval);
  statsPopupUpdateInterval = setInterval(async () => {
    if (popup.classList.contains('show')) {
      await renderStatsOnlyPopup(popup, true); // true = 部分更新
    } else {
      clearInterval(statsPopupUpdateInterval);
      statsPopupUpdateInterval = null;
    }
  }, 1000);
}

/**
 * 統計情報のみを表示するシンプルなポップアップをレンダリング (方針転換)
 * @param {HTMLElement} popup - ポップアップ要素
 * @param {boolean} isPartialUpdate - true の場合は作業効率セクションのみを更新
 */
async function renderStatsOnlyPopup(popup, isPartialUpdate = false) {
  try {
    if (!isExtensionContextValid()) throw new Error("Context invalidated");

    const stats = await loadStatistics(); // メッセージ送信を関数化
    if (!stats) return;

    // 時間フォーマット
    const totalMs = stats.totalWorkTimeToday || 0;
    const totalSec = Math.floor(totalMs / 1000);
    const hoursPart = Math.floor(totalSec / 3600);
    const minsPart = Math.floor((totalSec % 3600) / 60);
    const secsPart = totalSec % 60;
    const timeStr = `${hoursPart}${chrome.i18n.getMessage("unitHr")}${String(minsPart).padStart(2, '0')}${chrome.i18n.getMessage("unitMin")}${String(secsPart).padStart(2, '0')}${chrome.i18n.getMessage("unitSec")}`;

    // popup.js と同じ計算ロジック（toFixed(2)を挟まない）
    const count = stats.todayListings || 0;
    const hoursVal = totalMs / 3600000;
    const speedVal = hoursVal > 0 ? (count / hoursVal) : 0;
    const speed = speedVal.toFixed(1);

    let feedback = chrome.i18n.getMessage("rankVerySlow");
    let rankClass = "rank-very-slow";
    if (speedVal >= 120) { feedback = chrome.i18n.getMessage("rankFastest"); rankClass = "rank-fastest"; }
    else if (speedVal >= 60) { feedback = chrome.i18n.getMessage("rankFast"); rankClass = "rank-fast"; }
    else if (speedVal >= 30) { feedback = chrome.i18n.getMessage("rankNormal"); rankClass = "rank-normal"; }
    else if (speedVal >= 10) { feedback = chrome.i18n.getMessage("rankSlow"); rankClass = "rank-slow"; }

    // トロフィー判定 (popup.js と同期)
    const maxSpeed = stats.todayMaxSpeed || 0;
    if (speedVal > 0 && speedVal >= (maxSpeed - 2)) {
      feedback += " 🏆";
    }

    // 部分更新の場合
    if (isPartialUpdate) {
      const timeEl = popup.querySelector('#lfp-stat-worktime');
      const speedEl = popup.querySelector('#lfp-stat-speed');
      const rankEl = popup.querySelector('#lfp-stat-rank');

      if (timeEl) timeEl.textContent = timeStr;
      if (speedEl) speedEl.textContent = `${speed}${chrome.i18n.getMessage("unitSpeed")}`;
      if (rankEl) {
        rankEl.textContent = feedback;
        rankEl.className = `rank-badge ${rankClass}`;
      }
      return;
    }

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

    // プランバッジ (作業画面の表示ロジックと合わせる)
    const currentPlan = (STORE.license.plan || "free").toLowerCase();
    const cancelAt = STORE.license.cancelAt || null;
    let cancelLabel = '';
    if (cancelAt) {
      const cd = new Date(cancelAt);
      cancelLabel = ` ${chrome.i18n.getMessage("uiPlanCancelScheduled", [`${cd.getMonth() + 1}/${cd.getDate()}`])}`;
    }

    let planBadgeText = "Free";
    let planBadgeBg = "#6c757d";

    if (currentPlan === 'premium') {
      planBadgeText = `Premium${cancelLabel}`;
      planBadgeBg = "#d63384";
    } else if (currentPlan === 'pro' && STORE.license.isProTrial) {
      const daysLeft = STORE.license.proTrialDaysLeft ?? 30;
      planBadgeText = `${chrome.i18n.getMessage("uiPlanProTrial")} ${chrome.i18n.getMessage("uiPlanDaysLeft", [String(daysLeft)])}${cancelLabel}`;
      planBadgeBg = "#198754";
      if (cancelAt) planBadgeBg = '#6b7280';
    } else if (currentPlan === 'pro') {
      planBadgeText = `Pro${cancelLabel}`;
      planBadgeBg = "#1a73e8";
    } else if (STORE.license.isProTrial) {
      const daysLeft = STORE.license.proTrialDaysLeft ?? 30;
      planBadgeText = `${chrome.i18n.getMessage("uiPlanProTrial")} ${chrome.i18n.getMessage("uiPlanDaysLeft", [String(daysLeft)])}${cancelLabel}`;
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
      <h1 class="title">${chrome.i18n.getMessage("uiStatsTitle")}</h1>
      <span class="plan-badge" style="background-color: ${planBadgeBg};">${planBadgeText}</span>
    </div>
    <div class="content">
      <div class="stats-section">
        <h2>${chrome.i18n.getMessage("uiStatsHeader")}</h2>
        <div class="stats-grid">
          <div class="stat-item"><div class="stat-label">${chrome.i18n.getMessage("uiTodayListings")}</div><div class="stat-value">${stats.todayListings || 0}${chrome.i18n.getMessage("uiUnitItems")}</div></div>
          <div class="stat-item"><div class="stat-label">${chrome.i18n.getMessage("uiWeekListings")}</div><div class="stat-value">${stats.weekListings || 0}${chrome.i18n.getMessage("uiUnitItems")}</div></div>
          <div class="stat-item"><div class="stat-label">${chrome.i18n.getMessage("uiTotalListings")}</div><div class="stat-value">${stats.totalListings || 0}${chrome.i18n.getMessage("uiUnitItems")}</div></div>
          <div class="stat-item"><div class="stat-label">${chrome.i18n.getMessage("uiLastListing")}</div><div class="stat-value">${lastTimeStr}</div></div>
        </div>
      </div>
      <div class="stats-section">
        <h2>${chrome.i18n.getMessage("uiWorkingEfficiency")}</h2>
        <div class="stats-grid">
          <div class="stat-item"><div class="stat-label">${chrome.i18n.getMessage("uiTodayWorkTime")}</div><div class="stat-value" id="lfp-stat-worktime">${timeStr}</div></div>
          <div class="stat-item">
            <div class="stat-label">${chrome.i18n.getMessage("uiListingSpeed")}</div>
            <div class="stat-value">
              <span id="lfp-stat-speed">${speed}${chrome.i18n.getMessage("unitSpeed")}</span>
              <span id="lfp-stat-rank" class="rank-badge ${rankClass}">${feedback}</span>
            </div>
          </div>
        </div>
      </div>
      <div class="stats-section" style="margin-top: 2px;">
        <h2>${chrome.i18n.getMessage("uiAsinHistoryTitle")} <span id="errorRateBadge">${chrome.i18n.getMessage("uiErrorRate")}: ${errorRate}% ${errorEmoji}</span></h2>
        <div class="stats-grid tri">
          <div class="stat-item"><div class="stat-label">${chrome.i18n.getMessage("uiCompleted")}</div><div class="stat-value">${completedCount}</div></div>
          <div class="stat-item"><div class="stat-label">⚠️Prot.</div><div class="stat-value">${protectedCount}</div></div>
          <div class="stat-item"><div class="stat-label">🛡️Brand</div><div class="stat-value">${brandCount}</div></div>
          <div class="stat-item"><div class="stat-label">📭NoList</div><div class="stat-value">${noListingsCount}</div></div>
          <div class="stat-item"><div class="stat-label">🔍NoItem</div><div class="stat-value">${noItemCount}</div></div>
          <div class="stat-item"><div class="stat-label">🔄Already</div><div class="stat-value">${alreadyListedCount}</div></div>
        </div>
      </div>
      <div style="padding: 5px 0 5px 0; text-align: center;">
        <button class="btn-secondary" id="lfp-popup-reset-stats">${chrome.i18n.getMessage("uiResetStats")}</button>
      </div>
    </div>
  `;

    popup.querySelector('#lfp-popup-reset-stats').onclick = async () => {
      if (!isExtensionContextValid()) {
        alert(chrome.i18n.getMessage("msgExtensionUpdated"));
        return;
      }
      const confirmed = await showLfpConfirm(chrome.i18n.getMessage("uiConfirmResetStats"), chrome.i18n.getMessage("uiResetStatsTitle"));
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
          <h3 style="margin-top:0;">⚠️ ${chrome.i18n.getMessage("msgHistoryClearErrorTitle")}</h3>
          <p style="font-size:12px; line-height:1.4;">${chrome.i18n.getMessage("msgStatsReadError")}</p>
          <button class="btn-primary" onclick="location.reload()" style="margin-top:10px;">${chrome.i18n.getMessage("btnReload")}</button>
        </div>
      `;
  }
}
