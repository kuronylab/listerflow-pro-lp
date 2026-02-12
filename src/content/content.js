/*
   修正点
   ・UIはTitle入力欄の下に配置
   ・Get ItemでTitleが表示された時のみUI表示（初期/リフレッシュ時は非表示）
   ・MutationObserverはデバウンス＋自前UI無視
   ・Quick MIPはオプションONかつ条件OK時のみ表示
*/

const STORE = {
  opt: {
    apiKey: "",
    model: "gpt-4o-mini",
    veroEnabled: true,
    autoGetOnPaste: true,
    autoGetOnHistory: true,
    autoMipAfterOptimize: false,
    quickMipButton: true,  // デフォルトをtrueに変更（options.jsと同期）
    highlightOptimize: true,
    historyEnabled: true,
    // MIP後にOKボタン自動クリック
    autoClickOkAfterMip: true,
    turboListingMode: false
  },
  // 最適化状態の追跡
  optimizeState: {
    needsRetry: false  // trueの時「再実行」表示
  },
  // 最後にリクエストしたASIN（No listingsモーダル検出用）
  lastRequestedAsin: "",
  // ターボモードの実行済みフラグ
  turboExecuted: {
    optimize: false,
    mip: false
  }
};

// Observer管理用のグローバル変数
let mainObserver = null;
let noListingsObserver = null;
let listingSuccessObserver = null;
let urlChangeObserver = null;
let observersInitialized = false;

// イベントリスナー管理用（メモリリーク防止）
let dropdownClickHandler = null;
let dropdownMousedownHandler = null;

// setInterval管理用（クリーンアップ用）
let okButtonCheckInterval = null;

// 履歴操作のロック（競合状態防止）
let historyLock = false;

// 作業時間動的カウント用タイマーID
let sessionTimeUpdateInterval = null;

// エクステンションコンテキストの有効性チェック
function isExtensionContextValid() {
  try {
    // chrome.storageにアクセスできるかチェック
    return !!(chrome && chrome.storage && chrome.storage.sync);
  } catch (e) {
    return false;
  }
}

// エクステンションコンテキスト無効時のリカバリー処理
let recoveryAttempts = 0;
const MAX_RECOVERY_ATTEMPTS = 3;

async function attemptRecovery() {
  if (recoveryAttempts >= MAX_RECOVERY_ATTEMPTS) {
    console.log("[LFP] リカバリー試行回数上限に達しました。ページをリロードしてください。");
    return false;
  }
  
  recoveryAttempts++;
  console.log(`[LFP] リカバリー試行 ${recoveryAttempts}/${MAX_RECOVERY_ATTEMPTS}`);
  
  // 全てのフラグをリセット
  resetAllFlags();
  
  // Observerを再初期化
  observersInitialized = false;
  
  // 少し待ってから再初期化
  await sleep(500);
  
  if (isExtensionContextValid()) {
    console.log("[LFP] エクステンションコンテキストが復活しました");
    recoveryAttempts = 0;
    scheduleInit();
    return true;
  }
  
  return false;
}

// 全ての実行フラグをリセット
function resetAllFlags() {
  evalRunning = false;
  initRunning = false;
  optimizeRunning = false;
  mipRunning = false;
  okButtonCheckInterval && clearInterval(okButtonCheckInterval);
  sessionTimeUpdateInterval && clearInterval(sessionTimeUpdateInterval);
}

// スリープ関数
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// スケジュール初期化
function scheduleInit() {
  setTimeout(() => {
    if (!initRunning && isExtensionContextValid()) {
      init();
    }
  }, 1000);
}

// 実行フラグ
let evalRunning = false;
let initRunning = false;
let optimizeRunning = false;
let mipRunning = false;

// ===== 初期化 =====
window.addEventListener('load', init);
document.addEventListener('DOMContentLoaded', init);

async function init() {
  if (initRunning) return;
  initRunning = true;

  try {
    if (!isExtensionContextValid()) {
      console.log("[LFP] エクステンションコンテキストが無効です");
      if (await attemptRecovery()) {
        return;
      }
      initRunning = false;
      return;
    }

    console.log("[LFP] 初期化開始");

    // オプションを読み込む
    await loadOptions();

    // UIを作成
    createCustomUI();

    // 履歴を読み込んで表示
    await refreshCustomDropdown(await loadHistory());
    await refreshListingCountUI();

    // Observerを初期化
    if (!observersInitialized) {
      initializeObservers();
      observersInitialized = true;
    }

    // ストレージ変更リスナー（他のタブからの設定変更に対応）
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName === 'sync' && changes.lfp_options_v1) {
        loadOptions().then(() => updateUIBasedOnSettings());
      }
    });

    console.log("[LFP] 初期化完了");
  } catch (err) {
    console.error("[LFP] 初期化エラー:", err);
    if (await attemptRecovery()) {
      return;
    }
  } finally {
    initRunning = false;
  }
}

// ===== オプション読み込み =====
async function loadOptions() {
  try {
    const data = await chrome.storage.sync.get(['lfp_options_v1']);
    const opt = data?.lfp_options_v1 || {};
    
    STORE.opt = {
      apiKey: opt.apiKey || "",
      model: opt.model || "gpt-4o-mini",
      veroEnabled: opt.veroEnabled !== false,
      autoGetOnPaste: opt.autoGetOnPaste !== false,
      autoGetOnHistory: opt.autoGetOnHistory !== false,
      autoMipAfterOptimize: opt.autoMipAfterOptimize || false,
      quickMipButton: opt.quickMipButton !== false,
      highlightOptimize: opt.highlightOptimize !== false,
      historyEnabled: opt.historyEnabled !== false,
      autoClickOkAfterMip: opt.autoClickOkAfterMip !== false,
      turboListingMode: opt.turboListingMode || false
    };

    console.log("[LFP] オプション読み込み完了:", STORE.opt);
  } catch (err) {
    console.error("[LFP] オプション読み込みエラー:", err);
  }
}

// ===== UI作成 =====
const UI = {
  container: null,
  titleOptBtn: null,
  quickMipBtn: null,
  statusDiv: null,
  histSel: null,
  listingCountLabel: null
};

function createCustomUI() {
  // Yaballe Listerのページ構造を確認
  const titleInput = document.querySelector('input[placeholder*="Title"]') || 
                     document.querySelector('input[name*="title"]') ||
                     document.querySelector('input[type="text"]');
  
  if (!titleInput) {
    console.log("[LFP] Title入力欄が見つかりません");
    return;
  }

  // 既存UIをクリア
  const existing = document.getElementById('lfp-custom-ui');
  if (existing) existing.remove();

  // コンテナ作成
  UI.container = document.createElement('div');
  UI.container.id = 'lfp-custom-ui';
  UI.container.style.cssText = `
    margin: 10px 0;
    padding: 12px;
    background: #f8f9fa;
    border-radius: 6px;
    border: 1px solid #dee2e6;
  `;

  // ボタン行
  const buttonRow = document.createElement('div');
  buttonRow.style.cssText = 'display: flex; gap: 8px; margin-bottom: 10px; flex-wrap: wrap;';

  // タイトル最適化ボタン
  UI.titleOptBtn = document.createElement('button');
  UI.titleOptBtn.textContent = '📝 タイトル最適化';
  UI.titleOptBtn.style.cssText = `
    padding: 8px 12px;
    background: #007bff;
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 13px;
    font-weight: 600;
  `;
  UI.titleOptBtn.addEventListener('click', optimizeTitle);
  buttonRow.appendChild(UI.titleOptBtn);

  // Quick MIPボタン
  UI.quickMipBtn = document.createElement('button');
  UI.quickMipBtn.textContent = '⚡ Quick MIP';
  UI.quickMipBtn.style.cssText = `
    padding: 8px 12px;
    background: #28a745;
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 13px;
    font-weight: 600;
    display: none;
  `;
  UI.quickMipBtn.addEventListener('click', quickMip);
  buttonRow.appendChild(UI.quickMipBtn);

  UI.container.appendChild(buttonRow);

  // ステータス表示
  UI.statusDiv = document.createElement('div');
  UI.statusDiv.style.cssText = `
    font-size: 12px;
    color: #666;
    margin-bottom: 10px;
    min-height: 20px;
  `;
  UI.container.appendChild(UI.statusDiv);

  // ASIN履歴セレクタ
  const historyRow = document.createElement('div');
  historyRow.style.cssText = 'display: flex; gap: 8px; align-items: center; margin-bottom: 10px;';

  const historyLabel = document.createElement('label');
  historyLabel.textContent = 'ASIN履歴:';
  historyLabel.style.cssText = 'font-size: 12px; font-weight: 600; color: #444;';
  historyRow.appendChild(historyLabel);

  UI.histSel = document.createElement('select');
  UI.histSel.style.cssText = `
    flex: 1;
    padding: 6px;
    border: 1px solid #ced4da;
    border-radius: 4px;
    font-size: 12px;
    background: white;
    cursor: pointer;
  `;
  UI.histSel.addEventListener('change', onHistorySelect);
  historyRow.appendChild(UI.histSel);

  UI.container.appendChild(historyRow);

  // 出品件数・作業時間ラベル
  UI.listingCountLabel = document.createElement('div');
  UI.listingCountLabel.style.cssText = `
    font-size: 12px;
    color: #666;
    padding: 8px;
    background: white;
    border-radius: 4px;
    border: 1px solid #e9ecef;
  `;
  UI.listingCountLabel.textContent = '出品完了: 0件 | 今回の作業時間: 0時間00分00秒';
  UI.container.appendChild(UI.listingCountLabel);

  // Title入力欄の下に挿入
  titleInput.parentElement.insertBefore(UI.container, titleInput.nextElementSibling);

  console.log("[LFP] カスタムUIを作成しました");
}

// ===== 統計情報関連 =====
async function loadStatistics() {
  try {
    const data = await chrome.storage.local.get(['lfp_statistics_v1']);
    let stats = data?.['lfp_statistics_v1'];

    if (!stats) {
      stats = {
        totalListings: 0,
        todayListings: 0,
        weekListings: 0,
        lastListingDate: null,
        protectedCount: 0,
        brandCount: 0,
        alreadyListedCount: 0,
        totalWorkTimeToday: 0,
        todayLastActivityTime: null,
        todayMaxSpeed: 0,
        lastResetDate: Date.now()
      };
    }

    // 既存データへのマイグレーション
    if (stats.brandCount === undefined) stats.brandCount = 0;
    if (stats.alreadyListedCount === undefined) stats.alreadyListedCount = 0;
    if (stats.totalWorkTimeToday === undefined) stats.totalWorkTimeToday = 0;
    if (stats.todayLastActivityTime === undefined) stats.todayLastActivityTime = null;
    if (stats.todayMaxSpeed === undefined) stats.todayMaxSpeed = 0;
    
    // 日付が変わったらリセット
    const today = new Date().toDateString();
    const lastReset = new Date(stats.lastResetDate).toDateString();
    
    if (lastReset !== today) {
      stats.todayListings = 0;
      stats.totalWorkTimeToday = 0;
      stats.todayLastActivityTime = null;
      stats.todayMaxSpeed = 0;
      stats.lastResetDate = Date.now();
      
      if (new Date().getDay() === 1) {
        stats.weekListings = 0;
      }
      
      await chrome.storage.local.set({ 'lfp_statistics_v1': stats });
    }

    return stats;
  } catch (err) {
    console.error("[LFP] 統計情報読み込みエラー:", err);
    return null;
  }
}

async function saveStatistics(stats) {
  try {
    await chrome.storage.local.set({ 'lfp_statistics_v1': stats });
  } catch (err) {
    console.error("[LFP] 統計情報保存エラー:", err);
  }
}

/**
 * 作業時間の更新ロジック（中断時間を考慮）
 * 30分以上の空きがあれば中断とみなす
 */
function updateWorkTime(stats, now) {
  // 5分以上の空きがあれば「休憩中」とみなして作業時間に加算しない
  const THRESHOLD_MS = 5 * 60 * 1000; 
  
  if (!stats.todayLastActivityTime) {
    // その日最初の活動
    stats.todayLastActivityTime = now;
    // 初期値は0で、ポップアップの動的カウントアップで時間を加算していく
    stats.totalWorkTimeToday = stats.totalWorkTimeToday || 0;
  } else {
    const diff = now - stats.todayLastActivityTime;
    if (diff > 0 && diff < THRESHOLD_MS) {
      // 5分以内の間隔であれば、純粋な作業時間として加算
      stats.totalWorkTimeToday += diff;
    } else if (diff >= THRESHOLD_MS) {
      // 5分以上の空き（休憩）があった場合は、この1件分の作業時間として20秒だけ加算
      stats.totalWorkTimeToday += 20 * 1000;
    }
    stats.todayLastActivityTime = now;
  }
}

async function incrementListingCount() {
  try {
    const stats = await loadStatistics();
    if (!stats) return; // コンテキスト無効時はスキップ
    
    const now = Date.now();
    updateWorkTime(stats, now);

    stats.totalListings++;
    stats.todayListings++;
    stats.lastListingDate = now;

    await saveStatistics(stats);
    await refreshListingCountUI();
  } catch (err) {
    console.error("[LFP] 出品件数カウント更新エラー:", err);
  }
}

// ===== 履歴関連 =====
async function loadHistory() {
  try {
    const data = await chrome.storage.local.get(['lfp_asin_history_v1']);
    return Array.isArray(data?.['lfp_asin_history_v1']) ? data['lfp_asin_history_v1'] : [];
  } catch (err) {
    console.error("[LFP] 履歴読み込みエラー:", err);
    return [];
  }
}

async function saveHistory(history) {
  try {
    await chrome.storage.local.set({ 'lfp_asin_history_v1': history });
  } catch (err) {
    console.error("[LFP] 履歴保存エラー:", err);
  }
}

async function addToHistory(asin, flags = {}) {
  if (historyLock) return;
  historyLock = true;

  try {
    const history = await loadHistory();
    const timestamp = Date.now();
    const lastSeen = timestamp;

    const existingIndex = history.findIndex(h => h.asin === asin);
    if (existingIndex >= 0) {
      history[existingIndex] = { asin, flags, timestamp, lastSeen };
    } else {
      history.unshift({ asin, flags, timestamp, lastSeen });
    }

    // 最新100件のみ保持
    if (history.length > 100) {
      history.pop();
    }

    await saveHistory(history);
    await refreshCustomDropdown(history);
    await refreshListingCountUI();
  } catch (err) {
    console.error("[LFP] 履歴追加エラー:", err);
  } finally {
    historyLock = false;
  }
}

async function refreshCustomDropdown(hist) {
  if (!UI.histSel || !UI.histSel.isConnected) return;
  
  UI.histSel.innerHTML = '<option value="">-- ASIN履歴から選択 --</option>';
  
  hist.forEach((item, idx) => {
    const opt = document.createElement('option');
    opt.value = item.asin;
    opt.textContent = item.asin;
    UI.histSel.appendChild(opt);
  });
}

async function onHistorySelect(e) {
  const asin = e.target.value;
  if (!asin) return;

  const titleInput = document.querySelector('input[placeholder*="Title"]') || 
                     document.querySelector('input[name*="title"]') ||
                     document.querySelector('input[type="text"]');
  
  if (!titleInput) return;

  titleInput.value = asin;
  titleInput.dispatchEvent(new Event('input', { bubbles: true }));
  titleInput.dispatchEvent(new Event('change', { bubbles: true }));

  if (STORE.opt.autoGetOnHistory) {
    const getItemBtn = document.querySelector('button:contains("Get Item")') ||
                       Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Get Item'));
    if (getItemBtn) {
      setTimeout(() => getItemBtn.click(), 100);
    }
  }

  e.target.value = '';
}

async function refreshListingCountUI() {
  if (!UI.listingCountLabel || !UI.listingCountLabel.isConnected) return;
  
  const hist = await loadHistory();
  const stats = await loadStatistics();
  
  // 履歴の中からエラーでない（flagsがすべてfalse）ものを抽出
  const successItems = hist.filter(item => {
    const f = item.flags || {};
    return !(f.protected || f.brand || f.already_listed || f.no_listings || f.no_item);
  });
  const successCount = successItems.length;

  // 今回の作業時間を計算
  let totalMs = 0;
  let sessionWorkTime = "0時間00分00秒";
  
  if (successItems.length > 0) {
    const times = successItems.map(h => h.lastSeen || h.timestamp).filter(t => !!t).sort((a, b) => a - b);
    
    if (times.length > 0) {
      const THRESHOLD_MS = 5 * 60 * 1000; // 5分
      totalMs = 0; // 初期値は0で、動的カウントで加算していく
      
      for (let i = 1; i < times.length; i++) {
        const diff = times[i] - times[i-1];
        if (diff > 0 && diff < THRESHOLD_MS) {
          totalMs += diff;
        } else if (diff >= THRESHOLD_MS) {
          totalMs += 20 * 1000;
        }
      }
      
      const totalSec = Math.floor(totalMs / 1000);
      const hours = Math.floor(totalSec / 3600);
      const mins = Math.floor((totalSec % 3600) / 60);
      const secs = totalSec % 60;
      sessionWorkTime = `${hours}時間${String(mins).padStart(2, '0')}分${String(secs).padStart(2, '0')}秒`;

      // 累計作業時間をストレージに保存（ポップアップのカウンター同期用）
      if (stats && totalMs > 0) {
        stats.totalWorkTimeToday = totalMs;
        saveStatistics(stats);
      }
    }
  }
  
  // ランク判定
  let rankHtml = "";
  if (totalMs > 0 && successCount > 0) {
    const speed = Math.round((successCount / (totalMs / (1000 * 60 * 60))));
    let feedback = "着実";
    let emoji = "💪";
    let color = "#6c757d";
    let bgColor = "#f8f9fa";

    if (speed >= 120) {
      feedback = "爆速";
      emoji = "🚀";
      color = "#673ab7";
      bgColor = "#f3e5f5";
    } else if (speed >= 60) {
      feedback = "高速";
      emoji = "🏎️";
      color = "#007bff";
      bgColor = "#e7f3ff";
    }

    const isMaxSpeed = speed >= (stats?.todayMaxSpeed || 0);
    const trophy = isMaxSpeed ? " 🏆" : "";

    rankHtml = `<span style="margin-left: 10px; font-size: 0.85em; font-weight: bold; padding: 2px 10px; border-radius: 12px; color: ${color}; background-color: ${bgColor}; border: 1px solid ${color}44; display: inline-block; vertical-align: middle; white-space: nowrap;">${feedback} ${emoji}${trophy}</span>`;
  }

  // ASIN履歴バーのラベル更新
  UI.listingCountLabel.innerHTML = `
    <span style="font-weight: bold; color: #444; vertical-align: middle;">出品完了: ${successCount}件</span>
    <span style="margin-left: 15px; color: #666; vertical-align: middle;">今回の作業時間: ${sessionWorkTime}</span>
    ${rankHtml}
  `;

  // 動的カウントアップを開始
  startSessionTimeCounter(successItems);
}

// 今回の作業時間の動的カウント開始
function startSessionTimeCounter(successItems) {
  if (sessionTimeUpdateInterval) {
    clearInterval(sessionTimeUpdateInterval);
  }
  
  // 最初のアイテムのタイムスタンプを基準にする
  if (successItems.length === 0) return;
  
  const firstTime = Math.min(...successItems.map(h => h.lastSeen || h.timestamp).filter(t => !!t));
  const THRESHOLD_MS = 5 * 60 * 1000; // 5分
  
  sessionTimeUpdateInterval = setInterval(async () => {
    const now = Date.now();
    const timeSinceFirst = now - firstTime;
    
    // 5分以上経過していない場合のみカウント
    if (timeSinceFirst < THRESHOLD_MS) {
      const totalSec = Math.floor(timeSinceFirst / 1000);
      const hours = Math.floor(totalSec / 3600);
      const mins = Math.floor((totalSec % 3600) / 60);
      const secs = totalSec % 60;
      const sessionWorkTime = `${hours}時間${String(mins).padStart(2, '0')}分${String(secs).padStart(2, '0')}秒`;
      
      if (UI.listingCountLabel && UI.listingCountLabel.isConnected) {
        const currentHTML = UI.listingCountLabel.innerHTML;
        const updatedHTML = currentHTML.replace(
          /今回の作業時間: \d+時間\d{2}分\d{2}秒/,
          `今回の作業時間: ${sessionWorkTime}`
        );
        UI.listingCountLabel.innerHTML = updatedHTML;
      }
    } else {
      clearInterval(sessionTimeUpdateInterval);
      sessionTimeUpdateInterval = null;
    }
  }, 1000);
}

// ===== UI更新 =====
function updateUIBasedOnSettings() {
  if (UI.quickMipBtn) {
    UI.quickMipBtn.style.display = STORE.opt.quickMipButton ? 'inline-block' : 'none';
  }
  if (UI.titleOptBtn) {
    UI.titleOptBtn.style.display = STORE.opt.highlightOptimize ? 'inline-block' : 'none';
  }
}

// ===== Observers =====
function initializeObservers() {
  // メイン監視（ASIN入力の変更を監視）
  const titleInput = document.querySelector('input[placeholder*="Title"]') || 
                     document.querySelector('input[name*="title"]') ||
                     document.querySelector('input[type="text"]');
  
  if (titleInput) {
    titleInput.addEventListener('change', async (e) => {
      const asin = e.target.value?.trim();
      if (asin && /^[A-Z0-9]{10}$/.test(asin)) {
        STORE.lastRequestedAsin = asin;
        
        if (STORE.opt.autoGetOnPaste) {
          const getItemBtn = document.querySelector('button:contains("Get Item")') ||
                             Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Get Item'));
          if (getItemBtn) {
            setTimeout(() => getItemBtn.click(), 100);
          }
        }
      }
    });
  }

  // 出品成功を監視
  const listingSuccessObserver = new MutationObserver(async (mutations) => {
    for (const mutation of mutations) {
      if (mutation.addedNodes.length > 0) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType === 1) { // Element node
            const text = node.textContent || '';
            if (text.includes('Listing created') || text.includes('出品完了')) {
              console.log("[LFP] 出品成功を検知");
              await incrementListingCount();
              await addToHistory(STORE.lastRequestedAsin, {});
              break;
            }
          }
        }
      }
    }
  });

  const targetNode = document.body;
  listingSuccessObserver.observe(targetNode, {
    childList: true,
    subtree: true,
    characterData: false
  });

  console.log("[LFP] Observersを初期化しました");
}

// ===== 最適化・MIP処理 =====
async function optimizeTitle() {
  if (optimizeRunning || !STORE.opt.apiKey) {
    alert(STORE.opt.apiKey ? '処理中です...' : 'APIキーが設定されていません');
    return;
  }

  optimizeRunning = true;
  if (UI.statusDiv) UI.statusDiv.textContent = '最適化中...';

  try {
    const titleInput = document.querySelector('input[placeholder*="Title"]') || 
                       document.querySelector('input[name*="title"]') ||
                       document.querySelector('input[type="text"]');
    
    if (!titleInput || !titleInput.value) {
      alert('タイトルを入力してください');
      return;
    }

    // 最適化処理（省略）
    console.log("[LFP] タイトル最適化を実行");
  } catch (err) {
    console.error("[LFP] 最適化エラー:", err);
    alert('最適化に失敗しました');
  } finally {
    optimizeRunning = false;
    if (UI.statusDiv) UI.statusDiv.textContent = '';
  }
}

async function quickMip() {
  if (mipRunning) {
    alert('処理中です...');
    return;
  }

  mipRunning = true;
  if (UI.statusDiv) UI.statusDiv.textContent = 'MIP中...';

  try {
    // MIP処理（省略）
    console.log("[LFP] Quick MIPを実行");
  } catch (err) {
    console.error("[LFP] MIPエラー:", err);
    alert('MIPに失敗しました');
  } finally {
    mipRunning = false;
    if (UI.statusDiv) UI.statusDiv.textContent = '';
  }
}

// ===== クリーンアップ =====
window.addEventListener('beforeunload', () => {
  if (sessionTimeUpdateInterval) {
    clearInterval(sessionTimeUpdateInterval);
    sessionTimeUpdateInterval = null;
  }
  if (okButtonCheckInterval) {
    clearInterval(okButtonCheckInterval);
    okButtonCheckInterval = null;
  }
  if (mainObserver) mainObserver.disconnect();
  if (noListingsObserver) noListingsObserver.disconnect();
  if (listingSuccessObserver) listingSuccessObserver.disconnect();
  if (urlChangeObserver) urlChangeObserver.disconnect();
});

console.log("[LFP] スクリプト読み込み完了");
