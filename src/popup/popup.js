const KEY_OPT = "lfp_options_v1";
const KEY_HIST = "lfp_asin_history_v1";
const KEY_LICENSE = "lfp_license_v1";


// DOM elements
let menuBtn, closeMenuBtn, sideMenu, pageTitle, content;
let statsElements = {};
let settingElements = {};

// 作業時間の動的カウント用タイマーID
let workTimeUpdateInterval = null;

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  applyI18n();
  initializeElements();
  setupEventListeners();
  await loadAndDisplayStats();
  await loadSettings();
  startWorkTimeCounter();
});

function applyI18n() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const msg = chrome.i18n.getMessage(el.getAttribute('data-i18n'));
    if (msg) {
      if (el.tagName === 'INPUT' && el.type === 'placeholder') {
        el.placeholder = msg;
      } else {
        el.textContent = msg;
      }
    }
  });
}

// ページを離れるときにタイマーをクリア
window.addEventListener('pagehide', () => {
  if (workTimeUpdateInterval) {
    clearInterval(workTimeUpdateInterval);
    workTimeUpdateInterval = null;
  }
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
    lastListing: document.getElementById('lastListing'),
    completedListingsCount: document.getElementById('completedListingsCount'),
    protectedCount: document.getElementById('protectedCount'),
    brandCount: document.getElementById('brandCount'),
    noListingsCount: document.getElementById('noListingsCount'),
    alreadyListedCount: document.getElementById('alreadyListedCount'),
    noItemCount: document.getElementById('noItemCount'),
    todayWorkingHours: document.getElementById('todayWorkingHours'),
    listingSpeed: document.getElementById('listingSpeed'),
    errorRateLabel: document.getElementById('errorRateLabel')
  };

  // Setting elements
  settingElements = {
    // apiKey: document.getElementById('apiKey'), // v2.0.0: Proxy化
    // model: document.getElementById('model'),   // v2.0.0: Proxy化
    autoGetOnPaste: document.getElementById('autoGetOnPaste'),
    autoGetOnHistory: document.getElementById('autoGetOnHistory'),
    autoMipAfterOptimize: document.getElementById('autoMipAfterOptimize'),
    autoClickOkAfterMip: document.getElementById('autoClickOkAfterMip'),
    turboListingMode: document.getElementById('turboListingMode'),
    showWorkTimePanel: document.getElementById('showWorkTimePanel'),
    showCopyCsvButtons: document.getElementById('showCopyCsvButtons'),
    showStatistics: document.getElementById('showStatistics')
  };

  // License elements
  settingElements.licenseKey = document.getElementById('licenseKey');
  statsElements.currentPlanName = document.getElementById('currentPlanName');
  statsElements.todayUsageStatus = document.getElementById('todayUsageStatus');

  // Version elements
  const versionNumber = document.getElementById('versionNumber');
  const releaseDate = document.getElementById('releaseDate');

  // Load version from manifest
  const manifest = chrome.runtime.getManifest();
  if (versionNumber) versionNumber.textContent = `v${manifest.version}`;
  if (releaseDate) {
    // version_nameから日付を抽出（例: "1.2.4 (2026/02/15)" → "2026/02/15"）
    const versionName = manifest.version_name || '';
    const dateMatch = versionName.match(/\((.+)\)/);
    releaseDate.textContent = dateMatch ? dateMatch[1] : '-';
  }
}

function setupEventListeners() {
  // Menu toggle
  menuBtn?.addEventListener('click', () => {
    sideMenu?.classList.add('open');
  });

  closeMenuBtn?.addEventListener('click', () => {
    sideMenu?.classList.remove('open');
  });

  // Menu items
  document.querySelectorAll('.menu-item').forEach(item => {
    item.addEventListener('click', async (e) => {
      e.preventDefault();
      const page = item.dataset.page;
      await switchPage(page);
      sideMenu?.classList.remove('open');
    });
  });

  // Stats page buttons
  document.getElementById('resetStatsBtn')?.addEventListener('click', resetStats);

  // Basic settings page buttons (v2.0.0: Hidden)
  // document.getElementById('showKeyBtn')?.addEventListener('click', toggleApiKeyVisibility);
  // document.getElementById('saveBasicBtn')?.addEventListener('click', saveBasicSettings);

  // Automation settings page buttons
  document.getElementById('saveAutomationBtn')?.addEventListener('click', saveAutomationSettings);

  // License page buttons
  document.getElementById('showLicenseBtn')?.addEventListener('click', toggleLicenseKeyVisibility);
  document.getElementById('activateLicenseBtn')?.addEventListener('click', activateLicense);
  document.getElementById('deactivateLicenseBtn')?.addEventListener('click', deactivateLicense);
  document.getElementById('resetTrialBtn')?.addEventListener('click', handleResetTrial);
  document.getElementById('startTrialBtn')?.addEventListener('click', handleStartTrial);
  document.getElementById('expireTrialBtn')?.addEventListener('click', handleExpireTrial);
  document.getElementById('disableAdminBtn')?.addEventListener('click', disableAdminMode);
  document.getElementById('forceFreeBtn')?.addEventListener('click', () => forcePlan('free'));
  document.getElementById('forceProBtn')?.addEventListener('click', () => forcePlan('pro'));
  document.getElementById('forceProTrialBtn')?.addEventListener('click', () => forcePlan('pro-trial'));
  document.getElementById('forcePremiumBtn')?.addEventListener('click', () => forcePlan('premium'));

  // Admin Mode trigger (Click version 5 times)
  let versionClickCount = 0;
  document.getElementById('versionNumber')?.addEventListener('click', () => {
    versionClickCount++;
    if (versionClickCount === 5) {
      enableAdminMode();
    }
  });

  // 共通の推奨設定（自動化・UI）をONにする関数
  const applyRecommendedSupportSettings = () => {
    // 基本自動化項目
    if (settingElements.autoGetOnPaste) settingElements.autoGetOnPaste.checked = true;
    if (settingElements.autoGetOnHistory) settingElements.autoGetOnHistory.checked = true;

    // UI設定項目は全て連動してON
    if (settingElements.showWorkTimePanel) settingElements.showWorkTimePanel.checked = true;
    if (settingElements.showCopyCsvButtons) {
      settingElements.showCopyCsvButtons.checked = true;
      // コピー・CSVボタンの表示連動（エクスポートボタンの有効化）も呼び出す
      const exportBtn = document.getElementById('exportSpreadsheetBtn');
      if (exportBtn) {
        exportBtn.disabled = false;
        exportBtn.style.opacity = '1';
        exportBtn.style.cursor = 'pointer';
      }
    }
    if (settingElements.showStatistics) settingElements.showStatistics.checked = true;
  };

  // 最速出品モードの連動処理
  settingElements.turboListingMode?.addEventListener('change', (e) => {
    if (e.target.checked) {
      applyRecommendedSupportSettings();
      // ターボモードは全自動のため、MIPとOKも強制的にON
      if (settingElements.autoMipAfterOptimize) settingElements.autoMipAfterOptimize.checked = true;
      if (settingElements.autoClickOkAfterMip) settingElements.autoClickOkAfterMip.checked = true;
    }
  });

  // 最適化後MIP自動クリックの連動処理
  settingElements.autoMipAfterOptimize?.addEventListener('change', (e) => {
    if (e.target.checked) {
      // 基本設定とUIを最新にするが、OKボタンの自動化とは独立させる
      applyRecommendedSupportSettings();
    }
  });

  // MIP後にOKボタン自動クリックの連動処理
  settingElements.autoClickOkAfterMip?.addEventListener('change', (e) => {
    if (e.target.checked) {
      // 基本設定とUIを最新にするが、MIPの自動化とは独立させる
      applyRecommendedSupportSettings();
    }
  });

  // コピー・CSVボタンの表示連動処理
  settingElements.showCopyCsvButtons?.addEventListener('change', (e) => {
    const exportBtn = document.getElementById('exportSpreadsheetBtn');
    if (exportBtn) {
      exportBtn.disabled = !e.target.checked;
      exportBtn.style.opacity = e.target.checked ? '1' : '0.5';
      exportBtn.style.cursor = e.target.checked ? 'pointer' : 'not-allowed';
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

  // Listen for sync requests to update UI
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "LFP_SYNC_REQUEST") {
      console.log('[Popup] Sync request received');
      loadAndDisplayStats();
      loadSettings();
    }
  });
}

async function switchPage(page) {
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
    stats: chrome.i18n.getMessage("navStats"),
    history: chrome.i18n.getMessage("navHistory"),
    automation: chrome.i18n.getMessage("navAutomation"),
    basic: chrome.i18n.getMessage("navBasic"),
    version: chrome.i18n.getMessage("navVersion"),
    links: chrome.i18n.getMessage("navLinks"),
    license: chrome.i18n.getMessage("navLicense")
  };

  if (pageTitle) {
    pageTitle.textContent = titles[page] || chrome.i18n.getMessage("popupTitle") || 'ListerFlow Pro';
  }

  // 常にバッジ情報を最新にするため、どのページに切り替えても実行
  await loadAndDisplayStats();
}

// Statistics functions
function startWorkTimeCounter() {
  if (workTimeUpdateInterval) {
    clearInterval(workTimeUpdateInterval);
  }

  workTimeUpdateInterval = setInterval(async () => {
    await loadAndDisplayStats();
  }, 1000);
}

function updateWorkTimeDisplay(stats) {
  // バックグラウンドで計算された累積秒数を使用
  const totalMs = stats.totalWorkTimeToday || 0;

  if (statsElements.todayWorkingHours) {
    const totalSec = Math.floor(totalMs / 1000);
    const hours = Math.floor(totalSec / 3600);
    const minutes = Math.floor((totalSec % 3600) / 60);
    const seconds = totalSec % 60;
    const unitHr = chrome.i18n.getMessage("unitHr");
    const unitMin = chrome.i18n.getMessage("unitMin");
    const unitSec = chrome.i18n.getMessage("unitSec");
    statsElements.todayWorkingHours.textContent = `${hours}${unitHr}${String(minutes).padStart(2, '0')}${unitMin}${String(seconds).padStart(2, '0')}${unitSec}`;
  }

  if (statsElements.listingSpeed) {
    const count = stats.todayListings || 0;
    const hours = totalMs / 3600000;
    const speedVal = hours > 0 ? (count / hours) : 0;
    const speedDisplay = speedVal.toFixed(1);

    let rank = "rank-very-slow";
    let rankText = chrome.i18n.getMessage("rankVerySlow");
    if (speedVal >= 120) {
      rank = "rank-fastest";
      rankText = chrome.i18n.getMessage("rankFastest");
    } else if (speedVal >= 60) {
      rank = "rank-fast";
      rankText = chrome.i18n.getMessage("rankFast");
    } else if (speedVal >= 30) {
      rank = "rank-normal";
      rankText = chrome.i18n.getMessage("rankNormal");
    } else if (speedVal >= 10) {
      rank = "rank-slow";
      rankText = chrome.i18n.getMessage("rankSlow");
    }

    // トロフィー判定に遊び（バッファ）を持たせる（点滅防止）
    const maxSpeed = stats?.todayMaxSpeed || 0;
    const hasTrophy = speedVal > 0 && speedVal >= (maxSpeed - 2);
    if (hasTrophy) rankText += " 🏆";

    const unitSpeed = chrome.i18n.getMessage("unitSpeed");
    statsElements.listingSpeed.innerHTML = `
      <span>${speedDisplay}${unitSpeed}</span>
      <span class="rank-badge ${rank}">${rankText}</span>
    `;
  }
}

async function loadAndDisplayStats() {
  try {
    const stats = await chrome.runtime.sendMessage({ type: "LFP_GET_STATS" });
    const history = await loadHistory();

    const unitItems = chrome.i18n.getMessage("unitItems");
    if (statsElements.todayListings) statsElements.todayListings.textContent = `${stats.todayListings || 0}${unitItems}`;
    if (statsElements.weekListings) statsElements.weekListings.textContent = `${stats.weekListings || 0}${unitItems}`;
    if (statsElements.totalListings) statsElements.totalListings.textContent = `${stats.totalListings || 0}${unitItems}`;

    if (statsElements.lastListing) {
      if (stats.lastListingDate) {
        const d = new Date(stats.lastListingDate);
        const timeStr = `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
        statsElements.lastListing.textContent = timeStr;
      } else {
        statsElements.lastListing.textContent = '-';
      }
    }

    updateWorkTimeDisplay(stats);

    const completedCount = history.filter(h => {
      const f = h.flags || {};
      return !f.protected && !f.brand && !f.already_listed && !f.no_listings && !f.no_item;
    }).length;

    const protectedCount = history.filter(h => h.flags?.protected === true).length;
    const brandCount = history.filter(h => h.flags?.brand === true).length;
    const noListingsCount = history.filter(h => h.flags?.no_listings === true).length;
    const alreadyListedCount = history.filter(h => h.flags?.already_listed === true).length;
    const noItemCount = history.filter(h => h.flags?.no_item === true).length;

    if (statsElements.completedListingsCount) statsElements.completedListingsCount.textContent = `${completedCount}${unitItems}`;
    if (statsElements.protectedCount) statsElements.protectedCount.textContent = `${protectedCount}${unitItems}`;
    if (statsElements.brandCount) statsElements.brandCount.textContent = `${brandCount}${unitItems}`;
    if (statsElements.noListingsCount) statsElements.noListingsCount.textContent = `${noListingsCount}${unitItems}`;
    if (statsElements.alreadyListedCount) statsElements.alreadyListedCount.textContent = `${alreadyListedCount}${unitItems}`;
    if (statsElements.noItemCount) statsElements.noItemCount.textContent = `${noItemCount}${unitItems}`;

    if (statsElements.errorRateLabel) {
      const totalErrorCount = protectedCount + brandCount + noListingsCount + alreadyListedCount + noItemCount;
      const totalProcessed = completedCount + totalErrorCount;
      const errorRate = totalProcessed > 0 ? Math.round((totalErrorCount / totalProcessed) * 100) : 0;
      const emoji = errorRate === 0 ? '✨' : errorRate < 10 ? '👍' : errorRate < 30 ? '⚠️' : '🔴';
      const errorRateText = chrome.i18n.getMessage("errorRateText");
      statsElements.errorRateLabel.textContent = `${errorRateText} ${errorRate}% ${emoji}`;
    }

    // License info
    const licData = await chrome.storage.local.get([KEY_LICENSE]);
    const license = licData?.[KEY_LICENSE] || { plan: 'free', usageCount: 0 };

    const isProTrial = await checkProTrialStatus();
    const isAdminData = await chrome.storage.local.get(['lfp_admin_mode']);
    const isAdmin = isAdminData.lfp_admin_mode === true;

    // トライアル残り日数の計算 (共通で使用)
    let trialStatus = { active: false, daysLeft: 0 };
    const trialData = await chrome.storage.local.get(['lfp_pro_trial_start_date']);
    if (trialData.lfp_pro_trial_start_date) {
      const startStr = trialData.lfp_pro_trial_start_date.split('T')[0];
      const start = new Date(startStr + 'T00:00:00');
      const todayStr = new Date().toISOString().split('T')[0];
      const today = new Date(todayStr + 'T00:00:00');

      if (!isNaN(start.getTime())) {
        const diffMs = today - start;
        const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
        if (diffDays >= 0 && diffDays < 30) {
          trialStatus = { active: true, daysLeft: 30 - diffDays };
        }
      }
    }

    // ★ P4-UI: 解約予定日をストレージから取得
    const cancelData = await chrome.storage.local.get(['lfp_cancel_at']);
    const cancelAt = cancelData.lfp_cancel_at || null;
    let cancelLabel = '';
    if (cancelAt) {
      const cd = new Date(cancelAt);
      const dateStr = `${cd.getMonth() + 1}/${cd.getDate()}`;
      cancelLabel = chrome.i18n.getMessage("planCancelScheduled", [dateStr]);
    }

    // ヘッダータイトルの右横のバッジ
    const planBadge = document.getElementById('statsPlanBadge');
    if (planBadge) {
      const currentPlan = (license.plan || 'free').toLowerCase();


      if (isAdmin) {
        planBadge.textContent = "Admin";
        planBadge.className = "badge";
        planBadge.style.backgroundColor = "#343a40";
        planBadge.style.color = "#fff";
      } else if (currentPlan === 'premium') {
        planBadge.textContent = `Premium${cancelLabel}`;
        planBadge.className = "badge badge-premium";
        planBadge.style.backgroundColor = "";
        planBadge.style.color = "";
      } else if (currentPlan === 'pro' || currentPlan === 'pro-trial') {
        const isTrialMode = (currentPlan === 'pro-trial') || trialStatus.active;
        const trialText = chrome.i18n.getMessage("planTrialLeft", [trialStatus.daysLeft]);
        planBadge.textContent = isTrialMode ? `Pro (Trial) ${trialText}${cancelLabel}` : `Pro${cancelLabel}`;
        planBadge.className = isTrialMode ? 'badge badge-trial' : 'badge badge-pro';
        planBadge.style.backgroundColor = isTrialMode ? "#198754" : "#1a73e8"; // トライアルなら緑、通常Proなら青
        planBadge.style.borderRadius = "9px";
        planBadge.style.color = "#fff";
      } else if (currentPlan !== 'free') {
        planBadge.textContent = license.plan.charAt(0).toUpperCase() + license.plan.slice(1);
        planBadge.className = "badge badge-pro";
        planBadge.style.backgroundColor = "#0d6efd";
        planBadge.style.color = "#fff";
      } else if (trialStatus.active) {
        const trialText = chrome.i18n.getMessage("planTrialLeft", [trialStatus.daysLeft]);
        planBadge.textContent = `Pro (Trial) ${trialText}`;
        planBadge.className = 'badge badge-trial';
        planBadge.style.backgroundColor = "#20c997";
        planBadge.style.color = "#fff";
      } else {
        planBadge.textContent = "Free";
        planBadge.className = "badge badge-free";
        planBadge.style.backgroundColor = "";
        planBadge.style.color = "";
      }

      // トライアル時のカウントダウンバー表示
      let trialBar = document.getElementById('lfp-trial-countdown-bar');
      if ((currentPlan === 'free' || currentPlan === 'pro-trial') && trialStatus.active && !isAdmin) {
        if (!trialBar) {
          trialBar = document.createElement('div');
          trialBar.id = 'lfp-trial-countdown-bar';
          // スリム化とプレミアムな色調
          trialBar.style.cssText = 'background: #fff; padding: 6px 14px; border-bottom: 1px solid #e9ecef; font-size: 11px; font-weight: bold; color: #495057; display: flex; align-items: center; justify-content: space-between; gap: 10px;';
          const header = document.querySelector('.header');
          header.insertAdjacentElement('afterend', trialBar);
        }
        const percent = Math.round((trialStatus.daysLeft / 30) * 100);
        trialBar.innerHTML = `
          <div style="flex-shrink: 0; display: flex; align-items: center;">
            <span style="margin-right: 6px;">${chrome.i18n.getMessage("msgProTrialBanner")}</span>
            <a href="../pages/purchase.html" target="_blank" class="lfp-upgrade-link">${chrome.i18n.getMessage("msgUpgrade")}</a>
          </div>
          <div style="flex: 1; height: 6px; background: #e9ecef; border-radius: 3px; position: relative; overflow: hidden; max-width: 120px;">
            <div class="lfp-shimmer-bar" style="width: ${percent}%; height: 100%; border-radius: 3px;"></div>
          </div>
        `;
        trialBar.style.display = 'flex';
      } else if (trialBar) {
        trialBar.style.display = 'none';
      }

      planBadge.style.display = 'inline-block';
    }

    if (statsElements.currentPlanName) {
      const currentPlan = (license.plan || 'free').toLowerCase();
      if (isAdmin) {
        statsElements.currentPlanName.textContent = 'Admin';
        statsElements.currentPlanName.className = 'plan-badge plan-admin';
      } else if (currentPlan === 'premium') {
        statsElements.currentPlanName.textContent = `Premium${cancelLabel}`;
        statsElements.currentPlanName.className = 'plan-badge plan-premium';
      } else if (currentPlan === 'pro' || currentPlan === 'pro-trial') {
        const isTrialMode = (currentPlan === 'pro-trial') || trialStatus.active;
        const trialText = chrome.i18n.getMessage("planTrialLeft", [trialStatus.daysLeft]);
        statsElements.currentPlanName.textContent = isTrialMode ? `Pro (Trial) ${trialText}${cancelLabel}` : `Pro${cancelLabel}`;
        statsElements.currentPlanName.className = isTrialMode ? 'plan-value plan-trial' : 'plan-value plan-pro';
        statsElements.currentPlanName.style.backgroundColor = isTrialMode ? "#198754" : "#1a73e8";
        statsElements.currentPlanName.style.borderRadius = "9px";
        statsElements.currentPlanName.style.color = "#fff";
      } else if (currentPlan !== 'free') {
        statsElements.currentPlanName.textContent = license.plan.charAt(0).toUpperCase() + license.plan.slice(1);
        statsElements.currentPlanName.className = 'plan-badge plan-pro';
      } else if (isProTrial) {
        statsElements.currentPlanName.textContent = 'Pro (Trial)';
        statsElements.currentPlanName.className = 'plan-badge plan-pro';
      } else {
        statsElements.currentPlanName.textContent = 'Free';
        statsElements.currentPlanName.className = 'plan-badge plan-free';
      }
    }

    if (statsElements.todayUsageStatus) {
      if (license.plan === 'free') {
        const limit = license.dailyLimit || 2;
        statsElements.todayUsageStatus.textContent = `${license.usageCount} / ${limit}`;
      } else {
        statsElements.todayUsageStatus.textContent = chrome.i18n.getMessage("planUnlimited");
      }
    }

    // ★ P7: 次回請求日の表示
    const billingData = await chrome.storage.local.get(['lfp_next_billing_date', 'lfp_next_billing_amount', 'lfp_cancel_at']);
    let billingInfoEl = document.getElementById('lfp-billing-info');
    const currentPlanForBilling = (license.plan || 'free').toLowerCase();
    const cancelAtFromStorage = billingData.lfp_cancel_at;

    if (billingData.lfp_next_billing_date && currentPlanForBilling !== 'free' && !isAdmin) {
      const bd = new Date(billingData.lfp_next_billing_date);
      const dateStr = `${bd.getFullYear()}/${bd.getMonth() + 1}/${bd.getDate()}`;
      let billingText = chrome.i18n.getMessage("planNextBilling", [dateStr]);
      const amount = billingData.lfp_next_billing_amount;
      const amountStr = amount ? `¥${Number(amount).toLocaleString()}` : '';

      if (amountStr) {
        billingText += ` (${amountStr})`;
      }

      if (!billingInfoEl) {
        billingInfoEl = document.createElement('div');
        billingInfoEl.id = 'lfp-billing-info';
        billingInfoEl.style.cssText = 'padding: 4px 14px 8px; font-size: 11px; color: #6b7280; text-align: right;';
        // statsPlanBadge の親要素の後に挿入
        const planBadgeParent = document.getElementById('statsPlanBadge')?.parentElement;
        if (planBadgeParent) {
          planBadgeParent.insertAdjacentElement('afterend', billingInfoEl);
        }
      }

      if (cancelAtFromStorage) {
        const cd = new Date(cancelAtFromStorage);
        const cancelDateStr = `${cd.getMonth() + 1}/${cd.getDate()}`;
        billingText = chrome.i18n.getMessage("planCancelScheduledBilling", [cancelDateStr]);
        billingInfoEl.style.color = '#ef4444'; // 赤色で強調
      } else {
        billingInfoEl.style.color = '#6b7280';
      }

      billingInfoEl.textContent = billingText;
      billingInfoEl.style.display = 'block';
    } else if (billingInfoEl) {
      billingInfoEl.style.display = 'none';
    }

    const deactivateBtn = document.getElementById('deactivateLicenseBtn');
    if (deactivateBtn) {
      deactivateBtn.style.display = (license.plan !== 'free') ? 'block' : 'none';
    }

  } catch (err) {
    console.error('[Popup] Error loading stats:', err);
  }
}



async function resetStats() {
  if (!confirm(chrome.i18n.getMessage("msgResetStatsConfirm"))) return;

  // 統計リセットをSWに依頼
  chrome.runtime.sendMessage({ type: 'RESET_STATS' }, async (response) => {
    if (response && response.ok) {
      // ページ内のUIリセット指示（タブに送信）
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, { type: 'LFP_RESET_UI' }).catch(() => { });
      }
      await loadAndDisplayStats();
    }
  });
}

// Settings functions
async function loadSettings() {
  // ブラウザ側の強制制限を同期 (Basicプランかつ利用不可オプションが残っている場合を考慮)
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tabs[0]) {
    // コンテントスクリプト側で実行 (storage/constantsが利用可能なため)
    // ただしポップアップ側でも storage.js をインポートしているので直接呼べるか？
    // popup.js は modules ではないので、手動で同様の制限をかける必要がある。
  }

  const data = await chrome.storage.sync.get([KEY_OPT]);
  const opt = data?.[KEY_OPT] || {};

  // if (settingElements.apiKey) settingElements.apiKey.value = opt.apiKey || '';
  // if (settingElements.model) settingElements.model.value = opt.model || 'gpt-4o-mini';

  if (settingElements.autoGetOnPaste) settingElements.autoGetOnPaste.checked = !!opt.autoGetOnPaste;
  if (settingElements.autoGetOnHistory) settingElements.autoGetOnHistory.checked = !!opt.autoGetOnHistory;
  if (settingElements.autoMipAfterOptimize) settingElements.autoMipAfterOptimize.checked = !!opt.autoMipAfterOptimize;
  if (settingElements.autoClickOkAfterMip) settingElements.autoClickOkAfterMip.checked = !!opt.autoClickOkAfterMip;
  if (settingElements.turboListingMode) settingElements.turboListingMode.checked = !!opt.turboListingMode;
  if (settingElements.showWorkTimePanel) settingElements.showWorkTimePanel.checked = opt.showWorkTimePanel !== false; // デフォルトON
  if (settingElements.showStatistics) settingElements.showStatistics.checked = opt.showStatistics !== false; // デフォルトON

  // プラン制限の強制適用 (非同期で実行)
  await checkAndStrictlyEnforcePlanLimits(opt);

  // ターボモードの試用カウンター表示
  updateTurboTrialCounter(opt);

  // Load license key
  const licData = await chrome.storage.local.get([KEY_LICENSE]);
  const license = licData?.[KEY_LICENSE] || { plan: 'free', usageCount: 0 };
  if (settingElements.licenseKey) settingElements.licenseKey.value = license.licenseKey || '';

  // Proトライアル判定（サーバー同期で設定される。未設定なら非トライアル）
  let trialStartDate = await chrome.storage.local.get(['lfp_pro_trial_start_date']);
  trialStartDate = trialStartDate.lfp_pro_trial_start_date;

  let isProTrial = false;
  if (trialStartDate) {
    const today = new Date().toISOString().split('T')[0];
    const start = new Date(trialStartDate + 'T00:00:00');
    const current = new Date(today + 'T00:00:00');
    const diffMs = current - start;
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    isProTrial = (diffDays >= 0 && diffDays < 30);
  }

  // 管理者モードなら全開放
  const localData = await chrome.storage.local.get(['lfp_admin_mode', 'lfp_active_email']);
  const isAdmin = localData.lfp_admin_mode === true;
  const activeEmail = localData.lfp_active_email;

  // 管理者用ボタンの表示制御
  const resetBtn = document.getElementById('resetTrialBtn');
  const startBtn = document.getElementById('startTrialBtn');
  const disableBtn = document.getElementById('disableAdminBtn');
  const expireBtn = document.getElementById('expireTrialBtn');
  const forceFreeBtn = document.getElementById('forceFreeBtn');
  const forceProBtn = document.getElementById('forceProBtn');
  const forceProTrialBtn = document.getElementById('forceProTrialBtn');
  const forcePremiumBtn = document.getElementById('forcePremiumBtn');

  if (resetBtn) resetBtn.style.display = isAdmin ? 'block' : 'none';
  if (startBtn) startBtn.style.display = isAdmin ? 'block' : 'none';
  if (disableBtn) disableBtn.style.display = isAdmin ? 'block' : 'none';
  if (expireBtn) expireBtn.style.display = isAdmin ? 'block' : 'none';
  if (forceFreeBtn) forceFreeBtn.style.display = isAdmin ? 'block' : 'none';
  if (forceProBtn) forceProBtn.style.display = isAdmin ? 'block' : 'none';
  if (forceProTrialBtn) forceProTrialBtn.style.display = isAdmin ? 'block' : 'none';
  if (forcePremiumBtn) forcePremiumBtn.style.display = isAdmin ? 'block' : 'none';

  const currentPlan = (license.plan || 'free').toLowerCase();
  const isPremium = isAdmin || currentPlan === 'premium' || currentPlan === 'corporate'; // corporateなども含める
  // Pro以上 (Pro, Premium, ProTrial, その他Paid)
  const isProPlus = isAdmin || currentPlan !== 'free' || isProTrial;

  if (opt.showCopyCsvButtons === undefined) {
    opt.showCopyCsvButtons = isProPlus;
  }
  if (settingElements.showCopyCsvButtons) settingElements.showCopyCsvButtons.checked = !!opt.showCopyCsvButtons;

  // スプレッドシート出力ボタンの有効化・無効化
  const exportBtn = document.getElementById('exportSpreadsheetBtn');
  if (exportBtn) {
    exportBtn.disabled = !opt.showCopyCsvButtons;
    exportBtn.style.opacity = opt.showCopyCsvButtons ? '1' : '0.5';
    exportBtn.style.cursor = opt.showCopyCsvButtons ? 'pointer' : 'not-allowed';
  }

  // トライアル中の表示 (lfp-trial-countdown-barで一元化するため、ここは削除)


  // Premium限定
  if (settingElements.turboListingMode) {
    const isProType = currentPlan === 'pro' || currentPlan === 'pro_trial' || currentPlan === 'pro-trial' || (currentPlan === 'free' && isProTrial);

    // アカウント別の回数を取得
    const count = (activeEmail && license.turboTrialCounts) ? (license.turboTrialCounts[activeEmail] || 0) : (license.turboTrialCount || 0);
    const hasReachedLimit = isProType && !isAdmin && count >= 5;

    // ProユーザーもTurboを使えるように条件を緩和
    let allowTurboSettings = isPremium || isProType;
    if (hasReachedLimit) {
      allowTurboSettings = false;
      // 制限超過時は強制的にOFFをUI反映（表示のみ。保存は別で行われる）
      settingElements.turboListingMode.checked = false;
    }

    settingElements.turboListingMode.disabled = !allowTurboSettings;
    settingElements.turboListingMode.closest('.toggle-item').style.opacity = allowTurboSettings ? '1' : '0.5';
  }

  // Pro以上限定
  const proElements = [
    settingElements.autoMipAfterOptimize,
    settingElements.autoClickOkAfterMip,
    settingElements.showCopyCsvButtons,
    settingElements.showWorkTimePanel,
    settingElements.showStatistics
  ];
  proElements.forEach(el => {
    if (el) {
      el.disabled = !isProPlus;
      el.closest('.toggle-item').style.opacity = isProPlus ? '1' : '0.5';
    }
  });

  // Free 設定はロックしない
}



/* v2.0.0: API Proxy化に伴い廃止
function toggleApiKeyVisibility() { ... }
async function saveBasicSettings() { ... }
*/

async function saveAutomationSettings() {
  const data = await chrome.storage.sync.get([KEY_OPT]);
  const opt = data?.[KEY_OPT] || {};
  opt.autoGetOnPaste = settingElements.autoGetOnPaste?.checked;
  opt.autoGetOnHistory = settingElements.autoGetOnHistory?.checked;
  opt.autoMipAfterOptimize = settingElements.autoMipAfterOptimize?.checked;
  opt.autoClickOkAfterMip = settingElements.autoClickOkAfterMip?.checked;
  opt.turboListingMode = settingElements.turboListingMode?.checked;
  opt.showWorkTimePanel = settingElements.showWorkTimePanel?.checked;
  opt.showCopyCsvButtons = settingElements.showCopyCsvButtons?.checked;
  opt.showStatistics = settingElements.showStatistics?.checked;
  await chrome.storage.sync.set({ [KEY_OPT]: opt });
  alert(chrome.i18n.getMessage("msgAutoSettingsSaved"));

  // ターゲットタブを更新
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0] && tabs[0].url.includes('yaballe.com')) {
      chrome.tabs.reload(tabs[0].id);
    }
  });
}

// License functions
function toggleLicenseKeyVisibility() {
  const el = settingElements.licenseKey;
  if (!el) return;
  const btn = document.getElementById('showLicenseBtn');
  if (el.type === 'password') {
    el.type = 'text';
    if (btn) btn.textContent = '隠す';
  } else {
    el.type = 'password';
    if (btn) btn.textContent = '表示';
  }
}

async function activateLicense() {
  const key = settingElements.licenseKey?.value?.trim();
  if (!key) {
    alert(chrome.i18n.getMessage("msgRequireLicenseKey"));
    return;
  }

  // Yaballeのメールアドレスを取得
  const emailData = await chrome.storage.local.get(['lfp_current_yaballe_email']);
  const email = emailData.lfp_current_yaballe_email;

  if (!email && !key.toLowerCase().startsWith('test-')) {
    alert(chrome.i18n.getMessage("msgRequireYaballeTab"));
    return;
  }

  let btn = document.getElementById('activateLicenseBtn');
  let originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = '認証中...';

  // --- ローカルテストキーのインターセプト処理 ---
  const lowerKey = key.toLowerCase();
  const testPlans = {
    'test-free': 'free',
    'test-pro': 'pro',
    'test-pro-trial': 'pro-trial',
    'test-premium': 'premium'
  };

  if (testPlans[lowerKey]) {
    const plan = testPlans[lowerKey];

    const data = await chrome.storage.local.get(["lfp_license_v1"]);
    const license = data?.["lfp_license_v1"] || { usageCount: 0, lastResetDate: Date.now() };

    license.plan = plan;
    license.licenseKey = key;

    await chrome.storage.local.set({ ["lfp_license_v1"]: license });
    await chrome.storage.local.set({ 'lfp_license_plan': plan });

    if (plan !== 'free') {
      const optionsData = await chrome.storage.sync.get(["lfp_options_v1"]);
      const options = optionsData?.["lfp_options_v1"] || {};
      options.autoGetOnPaste = true;
      options.autoGetOnHistory = true;
      options.autoMipAfterOptimize = true;
      options.autoClickOkAfterMip = true;
      options.quickMipButton = true;
      options.showCopyCsvButtons = true;
      options.turboListingMode = true;
      await chrome.storage.sync.set({ ["lfp_options_v1"]: options });
    }

    alert(`【テストモード】\nプラン: ${plan.toUpperCase()} をローカルで適用しました。`);

    chrome.runtime.sendMessage({ type: "LFP_SYNC_REQUEST" });
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0] && tabs[0].url.includes('yaballe.com')) {
        chrome.tabs.reload(tabs[0].id);
      }
    });

    await loadSettings();
    loadAndDisplayStats();

    btn.disabled = false;
    btn.textContent = originalText;
    return;
  }
  // --- ここまで ---

  try {
    const response = await chrome.runtime.sendMessage({
      type: "LFP_LICENSE_SERVER_REQUEST",
      payload: {
        action: "apply_license",
        email: email,
        licenseKey: key
      }
    });

    if (!response || !response.ok) {
      throw new Error(response?.error || 'サーバーとの通信に失敗しました');
    }

    const result = response.data;

    if (result.status === 'success') {
      const data = await chrome.storage.local.get([KEY_LICENSE]);
      const license = data?.[KEY_LICENSE] || { usageCount: 0, lastResetDate: Date.now() };

      license.plan = result.plan || 'pro';
      license.licenseKey = key;

      await chrome.storage.local.set({ [KEY_LICENSE]: license });
      await chrome.storage.local.set({ 'lfp_license_plan': license.plan });

      // ★ アカウントごとのライセンス辞書にも保存（切り替え時に自動復元するため）
      const emailData = await chrome.storage.local.get(['lfp_current_yaballe_email']);
      const currentEmail = emailData.lfp_current_yaballe_email;
      if (currentEmail) {
        const dictData = await chrome.storage.local.get(['lfp_licenses_by_account']);
        const dict = dictData.lfp_licenses_by_account || {};
        dict[currentEmail] = { licenseKey: key, plan: license.plan };
        await chrome.storage.local.set({ 'lfp_licenses_by_account': dict });
        console.log(`[LFP] ${currentEmail} のライセンスを辞書に保存しました`);
      }

      // ライセンス解放時に全自動化設定を自動でONにする
      const optionsData = await chrome.storage.sync.get([KEY_OPT]);
      const options = optionsData?.[KEY_OPT] || {};
      options.autoGetOnPaste = true;
      options.autoGetOnHistory = true;
      options.autoMipAfterOptimize = true;
      options.autoClickOkAfterMip = true;
      options.quickMipButton = true;
      options.showCopyCsvButtons = true;
      options.turboListingMode = true;
      await chrome.storage.sync.set({ [KEY_OPT]: options });

      // ★ Premiumになった場合は自動OFFフラグを削除（Turboを確実にONにするため）
      if (license.plan === 'premium') {
        await chrome.storage.local.remove(['lfp_turbo_auto_disabled']);
        // アカウント固有のフラグも削除
        if (currentEmail) {
          await chrome.storage.local.remove([`lfp_turbo_auto_disabled_${currentEmail}`]);
        }
      }

      alert(chrome.i18n.getMessage("msgAuthSuccess", [license.plan.toUpperCase()]));

      chrome.runtime.sendMessage({ type: "LFP_SYNC_REQUEST" });
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0] && tabs[0].url.includes('yaballe.com')) {
          chrome.tabs.reload(tabs[0].id);
        }
      });

      await loadSettings();
      loadAndDisplayStats();
    } else {
      alert(chrome.i18n.getMessage("msgAuthFailed", [result.message || 'Invalid key']));
    }
  } catch (err) {
    console.error('[LFP] activateLicense error:', err);
    alert(chrome.i18n.getMessage("msgAuthNetworkError"));
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
}

async function deactivateLicense() {
  if (!confirm(chrome.i18n.getMessage("msgCancelConfirm"))) return;

  const data = await chrome.storage.local.get([KEY_LICENSE]);
  const license = data?.[KEY_LICENSE] || {};
  license.plan = 'free';
  license.licenseKey = '';

  await chrome.storage.local.set({ [KEY_LICENSE]: license });
  // 同期用のフラグもリセット
  await chrome.storage.local.set({ 'lfp_license_plan': 'free' });

  // トライアルも強制終了させて完全に「Free」に戻す
  const fakeDate = new Date();
  fakeDate.setDate(fakeDate.getDate() - 100);
  const oldDateStr = fakeDate.toISOString().split('T')[0];
  await chrome.storage.local.set({ 'lfp_pro_trial_start_date': oldDateStr });
  await chrome.storage.sync.set({ 'lfp_pro_trial_start': oldDateStr });

  // 有料プランの初期化実行フラグをクリア
  await chrome.storage.local.remove([
    'lfp_auto_enabled_plan_pro',
    'lfp_auto_enabled_plan_premium',
    'lfp_auto_enabled_plan_pro-trial',
    'lfp_auto_enabled_plan_pro_trial'
  ]);

  if (settingElements.licenseKey) settingElements.licenseKey.value = '';

  alert(chrome.i18n.getMessage("msgLicenseDeactivated"));
  chrome.runtime.sendMessage({ type: "LFP_SYNC_REQUEST" });

  // アクティブなタブを更新
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0] && tabs[0].url.includes('yaballe.com')) {
      chrome.tabs.reload(tabs[0].id);
    }
  });

  loadAndDisplayStats();
  await loadSettings(); // プラン変更に伴い、制限チェックを走らせる
}

async function forcePlan(plan) {
  const displayPlanName = plan === 'free' ? 'FREE' : plan.toUpperCase();
  if (!confirm(`プラン変更: ${displayPlanName} に切り替えますか？`)) return;

  const data = await chrome.storage.local.get([KEY_LICENSE]);
  const license = data?.[KEY_LICENSE] || {};
  license.plan = plan;
  license.licenseKey = plan !== 'free' ? `${plan}-admin-forced` : '';

  await chrome.storage.local.set({ [KEY_LICENSE]: license });
  await chrome.storage.local.set({ 'lfp_license_plan': plan });

  // もしFREEにするなら、トライアルも終了させて完全にクリーンなFREEにする
  if (plan === 'free') {
    const fakeDate = new Date();
    fakeDate.setDate(fakeDate.getDate() - 100);
    const oldDateStr = fakeDate.toISOString().split('T')[0];
    await chrome.storage.local.set({ 'lfp_pro_trial_start_date': oldDateStr });
    await chrome.storage.sync.set({ 'lfp_pro_trial_start': oldDateStr });

    // 有料プランの初期化実行フラグをクリア
    await chrome.storage.local.remove([
      'lfp_auto_enabled_plan_pro',
      'lfp_auto_enabled_plan_premium',
      'lfp_auto_enabled_plan_pro-trial',
      'lfp_auto_enabled_plan_pro_trial'
    ]);
  }

  alert(`${displayPlanName} プランに変更しました。`);
  chrome.runtime.sendMessage({ type: "LFP_SYNC_REQUEST" });

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0] && tabs[0].url.includes('yaballe.com')) {
      chrome.tabs.reload(tabs[0].id);
    }
  });

  loadAndDisplayStats();
  await loadSettings();
}

async function handleResetTrial() {
  if (!confirm('試用回数を 0 にリセットしますか？')) return;

  // ストレージキーの両方を更新して確実に同期させる
  await chrome.storage.local.set({
    'lfp_usage_count': 0,
    'lfp_last_used_date': new Date().toISOString().split('T')[0]
  });

  const data = await chrome.storage.local.get([KEY_LICENSE]);
  const license = data?.[KEY_LICENSE] || {};
  license.usageCount = 0;
  license.lastResetDate = Date.now();
  license.turboTrialCount = 0; // Turbo試用回数もリセット

  await chrome.storage.local.set({ [KEY_LICENSE]: license });

  alert('試用回数をリセットしました。');
  chrome.runtime.sendMessage({ type: "LFP_SYNC_REQUEST" });

  // アクティブなタブを更新
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0] && tabs[0].url.includes('yaballe.com')) {
      chrome.tabs.reload(tabs[0].id);
    }
  });

  loadAndDisplayStats();
}

async function handleExpireTrial() {
  if (!confirm('Proトライアル期間を強制的に終了させますか？（テスト用）')) return;

  const fakeDate = new Date();
  fakeDate.setDate(fakeDate.getDate() - 100);
  const oldDateStr = fakeDate.toISOString().split('T')[0];

  await chrome.storage.local.set({ 'lfp_pro_trial_start_date': oldDateStr });
  alert('トライアル期間を終了させました。');
  chrome.runtime.sendMessage({ type: "LFP_SYNC_REQUEST" });

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0] && tabs[0].url.includes('yaballe.com')) {
      chrome.tabs.reload(tabs[0].id);
    }
  });

  loadAndDisplayStats();
  await loadSettings(); // トライアル終了に伴い、制限チェックを走らせる
}

async function handleStartTrial() {
  if (!confirm('Proトライアル期間を新しく開始（またはリセット）しますか？（テスト用）')) return;

  const today = new Date().toISOString().split('T')[0];
  await chrome.storage.local.set({ 'lfp_pro_trial_start_date': today });

  // 試用回数とプランをリセットして基本状態(Trial)にする
  const data = await chrome.storage.local.get([KEY_LICENSE]);
  const license = data?.[KEY_LICENSE] || {};
  license.plan = 'free';
  license.usageCount = 0;
  license.lastResetDate = Date.now();
  license.turboTrialCount = 0;
  license.licenseKey = '';
  await chrome.storage.local.set({ [KEY_LICENSE]: license });
  await chrome.storage.local.set({ 'lfp_license_plan': 'free' });

  alert('Proトライアル期間を開始しました。');
  chrome.runtime.sendMessage({ type: "LFP_SYNC_REQUEST" });

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0] && tabs[0].url.includes('yaballe.com')) {
      chrome.tabs.reload(tabs[0].id);
    }
  });

  loadAndDisplayStats();
  await loadSettings();
}

async function enableAdminMode() {
  await chrome.storage.local.set({ 'lfp_admin_mode': true });
  alert('管理者モードが有効になりました（全機能を一時開放）');

  // UIを再描画してボタンを表示させる
  loadAndDisplayStats();

  // ターゲットタブを更新
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0] && tabs[0].url.includes('yaballe.com')) {
      chrome.tabs.reload(tabs[0].id);
    }
  });

  // UIを再読み込み（ロック解除を反映）
  loadSettings();
}

async function disableAdminMode() {
  await chrome.storage.local.set({ 'lfp_admin_mode': false });
  alert('管理者モードを終了しました');

  // UIを再描画してボタンを隠す
  loadAndDisplayStats();

  // ターゲットタブを更新
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0] && tabs[0].url.includes('yaballe.com')) {
      chrome.tabs.reload(tabs[0].id);
    }
  });

  // UIを再読み込み（ロック再適用を反映）
  loadSettings();
}

/**
 * 現在の設定がプラン制限に違反している場合に強制的に修正して保存する
 */
async function checkAndStrictlyEnforcePlanLimits(opt) {
  const licData = await chrome.storage.local.get([KEY_LICENSE, 'lfp_admin_mode']);
  const license = licData?.[KEY_LICENSE] || { plan: 'free', usageCount: 0 };
  const isAdmin = licData?.lfp_admin_mode === true;

  if (isAdmin) return; // 管理者なら制限チェックをスキップ

  let changed = false;

  // 1. Premium限定 (Turbo)
  const isTrial = await checkProTrialStatus();
  const currentPlan = (license.plan || 'free').toLowerCase();

  // Basic以外のすべてのプラン、およびトライアル期間中は制限をクリア
  const isPaidOrTrial = currentPlan !== 'free' || isTrial;

  if (!isPaidOrTrial) {
    console.log(`[Popup] Freeプラン制限を適用します (Plan: ${currentPlan}, Trial: ${isTrial})`);
    // Freeプランの場合のみ制限
    if (opt.turboListingMode) {
      opt.turboListingMode = false;
      changed = true;
    }
    ['autoMipAfterOptimize', 'autoClickOkAfterMip', 'showCopyCsvButtons'].forEach(key => {
      if (opt[key]) {
        opt[key] = false;
        changed = true;
      }
    });
  }


  if (changed) {
    await chrome.storage.sync.set({ [KEY_OPT]: opt });
    console.log('[Popup] プラン制限により設定を自動修正しました');
    // UIを再読み込み
    loadSettings();
    return;
  }

  // 1.1 Pro/Pro-Trialの5回制限チェック (アカウント別)
  if (currentPlan === 'pro' || currentPlan === 'pro-trial' || (currentPlan === 'free' && isTrial)) {
    const activeEmail = (await chrome.storage.local.get(['lfp_active_email'])).lfp_active_email;
    if (activeEmail) {
      if (!license.turboTrialCounts) license.turboTrialCounts = {};
      const count = license.turboTrialCounts[activeEmail] || 0;
      if (count >= 5 && opt.turboListingMode) {
        console.log(`[Popup] アカウント(${activeEmail})の試用制限(5/5)によりTurboをOFFにします`);
        opt.turboListingMode = false;
        await chrome.storage.sync.set({ [KEY_OPT]: opt });
        loadSettings();
      }
    }
  }
}

/**
 * ターボモードの試用状況をUIに反映
 */
async function updateTurboTrialCounter(opt) {
  const counterLabel = document.getElementById('turboTrialCountLabel');
  if (!counterLabel) return;

  const licData = await chrome.storage.local.get([KEY_LICENSE, 'lfp_active_email', 'lfp_admin_mode']);
  const license = licData?.[KEY_LICENSE] || {};
  const email = licData?.lfp_active_email;
  const isAdmin = licData?.lfp_admin_mode === true;
  const plan = (license.plan || 'free').toLowerCase();

  // Premiumまたは管理者は無制限表示なし
  if (isAdmin || plan === 'premium') {
    counterLabel.textContent = '';
    return;
  }

  const isTrial = await checkProTrialStatus();
  if (plan === 'pro' || plan === 'pro-trial' || (plan === 'free' && isTrial)) {
    const count = (email && license.turboTrialCounts) ? (license.turboTrialCounts[email] || 0) : (license.turboTrialCount || 0);
    counterLabel.textContent = `(試用中: ${count}/5)`;
    if (count >= 5) {
      counterLabel.style.color = '#dc3545'; // 赤色
      counterLabel.textContent = `(試用制限: 5/5)`;
    } else {
      counterLabel.style.color = '#e67700'; // オレンジ
    }
  } else {
    counterLabel.textContent = '';
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

    const statusClass = isError ? 'error' : 'completed';

    card.innerHTML = `
        <div class="history-main">
          <span class="history-asin">${item.asin}</span>
          <span class="history-status ${statusClass}">${status}</span>
        </div>
        <button class="history-delete" data-asin="${item.asin}" title="この履歴を削除">×</button>
      `;

    card.querySelector('.history-delete').addEventListener('click', async () => {
      const asin = card.querySelector('.history-delete').dataset.asin;
      const hist = await loadHistory();
      const newHist = hist.filter(h => h.asin !== asin);
      await chrome.storage.local.set({ [KEY_HIST]: newHist });
      chrome.runtime.sendMessage({ type: "LFP_SYNC_REQUEST" });
      loadHistoryList();
    });

    listEl.appendChild(card);
  });
}

async function checkProTrialStatus() {
  let trialStartDate = await chrome.storage.local.get(['lfp_pro_trial_start_date']);
  trialStartDate = trialStartDate.lfp_pro_trial_start_date;

  // トライアル開始日が未設定 → トライアルなし（サーバー同期で設定されるまで待つ）
  if (!trialStartDate) {
    return false;
  }

  const today = new Date().toISOString().split('T')[0];
  const startStr = trialStartDate.split('T')[0];
  const start = new Date(startStr + 'T00:00:00');
  const current = new Date(today + 'T00:00:00');
  if (isNaN(start.getTime())) return false;

  const diffMs = current - start;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  return (diffDays >= 0 && diffDays < 30);
}

function exportToSpreadsheet() {
  chrome.tabs.create({ url: chrome.runtime.getURL('src/popup/export.html') });
}

async function clearHistory() {
  if (!confirm(chrome.i18n.getMessage("msgClearConfirm"))) return;
  chrome.runtime.sendMessage({ type: 'CLEAR_HISTORY' }, () => {
    loadHistoryList();
  });
}

