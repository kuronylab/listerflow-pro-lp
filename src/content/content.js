/* ListerFlow Pro for Yaballe (MV3 content script)
   ※ STORE定数・グローバル変数は store.js に分離済み
*/

/* ---------- ライセンス・オプション管理は license.js に分離済み ---------- */

/* ---------- Statistics・History は history.js に分離済み ---------- */

/* ---------- DOM helpers は dom-helpers.js に分離済み ---------- */

/* ---------- Vero / タイトル短縮 / ターゲット文字数判定は vero.js に分離済み ---------- */


/* ---------- UI ---------- */

const UI = {
  root: null,
  status: null,
  badge: null,
  btnOpt: null,
  btnLabel: null,
  spin: null,
  asinBar: null,
  histSel: null,
  quickMipBtn: null,
  statsBar: null,
  listingCountLabel: null,
  pauseResumeBtn: null
};

function destroyMainUI() {
  if (UI.root && UI.root.isConnected) {
    UI.root.remove();
  }
  UI.root = null;
  UI.status = null;
  UI.badge = null;
  UI.btnOpt = null;
  UI.btnLabel = null;
  UI.spin = null;
}

function ensureUIBelowTitle(titleEl) {
  if (!titleEl) return;
  if (UI.root && UI.root.isConnected) return;

  // ステータス表示用のボックス（Get ItemとVero Warningsの間に配置）
  const statusBox = document.createElement("div");
  statusBox.className = "lfp-status-box";
  statusBox.id = "lfp-status-box";

  const row = document.createElement("div");
  row.className = "lfp-row";

  const btn = document.createElement("button");
  btn.className = "lfp-btn";
  btn.type = "button";
  // ハイライト設定がONなら生成時点で即適用（黒色フラッシュ防止）
  if (STORE.opt.highlightOptimize) {
    btn.classList.add("highlight");
  }

  const label = document.createElement("span");
  label.className = "lfp-btn-label";
  label.textContent = chrome.i18n.getMessage("uiOptimize");

  const spin = document.createElement("span");
  spin.className = "lfp-spin";
  spin.style.display = "none";

  btn.appendChild(label);
  btn.appendChild(spin);

  const status = document.createElement("div");
  status.className = "lfp-status";
  status.textContent = `${chrome.i18n.getMessage("uiCharacters")}：計算中... / ${chrome.i18n.getMessage("uiVero")}：- / ${chrome.i18n.getMessage("uiListing")}：-`;

  row.appendChild(btn);
  row.appendChild(status);

  const badge = document.createElement("div");
  badge.className = "lfp-badge";
  badge.textContent = "";

  statusBox.appendChild(row);
  statusBox.appendChild(badge);

  // Vero Warningsの直前に挿入
  insertBeforeVeroWarnings(statusBox);

  UI.root = statusBox;
  UI.status = status;
  UI.badge = badge;
  UI.btnOpt = btn;
  UI.btnLabel = label;
  UI.spin = spin;

}

function setBusy(isBusy) {
  if (!UI.btnOpt) return;

  // 出品中（MIP後）は、たとえbusy指示が来ても「最適化中」には変えない
  if (isBusy && STORE.turboExecuted.mip) {
    if (UI.btnLabel) UI.btnLabel.textContent = chrome.i18n.getMessage("uiOptimize");
    if (UI.spin) UI.spin.style.display = "none";
    UI.btnOpt.disabled = true;
    return;
  }

  UI.btnOpt.disabled = isBusy;

  // 最適化中の表示
  if (isBusy) {
    if (UI.btnLabel) UI.btnLabel.textContent = chrome.i18n.getMessage("uiOptimizing");
    if (UI.spin) UI.spin.style.display = "inline-block";
  } else {
    // 最適化完了時の表示：needsRetryに応じて「最適化」または「再実行」
    // ロック中（MIP後）は強制的に「最適化」表記にする
    const label = STORE.turboExecuted.mip ? chrome.i18n.getMessage("uiOptimize") : (STORE.optimizeState.needsRetry ? chrome.i18n.getMessage("uiReOptimize") : chrome.i18n.getMessage("uiOptimize"));
    if (UI.btnLabel) UI.btnLabel.textContent = label;
    if (UI.spin) UI.spin.style.display = "none";
  }

  // ハイライト管理：点滅（一瞬の紫のグレーアウト）を防ぐため、
  // 実行中（isBusy）はハイライトクラスを維持する
  if (STORE.opt.highlightOptimize) {
    if (!isBusy && UI.btnOpt.disabled && !STORE.turboExecuted.mip) {
      // 処理が終わっていて、手動で無効化されている時のみハイライトを消す
      UI.btnOpt.classList.remove("highlight");
    } else {
      // 実行中 または 利用可能状態 の場合はハイライトを適用（または維持）
      UI.btnOpt.classList.add("highlight");
    }
    // インラインスタイルを残さないようにして、CSSを優先させる
    UI.btnOpt.style.background = "";
    UI.btnOpt.style.color = "";
  }
}

function setStatusLine(len, veroCount, shipText, highlight) {
  if (!UI.status) return;
  UI.status.textContent = `${chrome.i18n.getMessage("uiCharacters")}：${len} / ${chrome.i18n.getMessage("uiVero")}：${veroCount} / ${chrome.i18n.getMessage("uiListing")}：${shipText}`;
  // Store flag for Turbo mode detection (avoids text parsing across locales)
  STORE.optimizeState.needsOptimize = (highlight === true);
  if (UI.btnOpt && STORE.opt.highlightOptimize) {
    // 修正: 最適化完了後も常に.highlightクラスを保持
    // highlightOptimizeがONの場合、常に.highlightクラスを付与
    UI.btnOpt.classList.add("highlight");
    // インラインスタイルをクリア
    UI.btnOpt.style.background = "";
    UI.btnOpt.style.color = "";
  } else if (UI.btnOpt) {
    // highlightOptimizeがOFFの場合のみ削除
    UI.btnOpt.classList.remove("highlight");
  }
}

function setBadge(text) {
  if (!UI.badge) return;
  UI.badge.textContent = text || "";
}

/**
 * UI要素だけをリセット（フラグは維持）。
 * 新しいASINの取得前に呼ばれ、前回の出品結果の表示をクリアする。
 */
function resetUIState() {
  setBadge("");
  if (UI.btnOpt) {
    UI.btnOpt.disabled = false;
    if (UI.btnLabel) UI.btnLabel.textContent = chrome.i18n.getMessage("uiOptimize");
    if (UI.spin) UI.spin.style.display = "none";
  }
  if (UI.status) {
    UI.status.textContent = `${chrome.i18n.getMessage("uiCharacters")}：- / ${chrome.i18n.getMessage("uiVero")}：- / ${chrome.i18n.getMessage("uiListing")}：-`;
  }
  // 点滅防止: highlightOptimizeがONの場合はクラスを維持
  if (UI.btnOpt && !STORE.opt.highlightOptimize) {
    UI.btnOpt.classList.remove("highlight");
  }
  // 最適化状態をリセット
  STORE.optimizeState.needsRetry = false;
  STORE.optimizeState.lastOutputs = [];
  // MIPボタンの点滅防止フラグをリセット（次のASINで正しく再判定）
  if (UI.quickMipBtn) {
    UI.quickMipBtn._wasEnabled = false;
    UI.quickMipBtn.disabled = true;
  }

  listingCounted = false;
  STORE.turboExecuted.mip = false;
  STORE.turboExecuted.optimizeCount = 0;

  if (okButtonCheckInterval) {
    clearInterval(okButtonCheckInterval);
    okButtonCheckInterval = null;
  }
}

/* ---------- Quick MIP ---------- */

function findRealMipButton() {
  return document.querySelector("#mip-list-item-btn") || null;
}


function clickRealMipButton() {
  const real = findRealMipButton();
  if (!real) return false;
  const aria = real.getAttribute("aria-disabled");
  if (aria === "true") return false;
  if (real.hasAttribute("disabled")) return false;

  // 重要：手動/自動に関わらずMIPボタンをクリックしたら「実行済み」としてマーク
  // これにより、出品完了までの遷移中に自動最適化が走るのを防ぐ
  STORE.turboExecuted.mip = true;

  // ユーザー提案：MIP後は最適化ボタンを即座に無効化（グレーアウト）する
  if (UI.btnOpt) UI.btnOpt.disabled = true;

  real.click();
  return true;
}

function ensureQuickMipButton(btnGet) {
  // 既に存在する場合は何もしない（再生成を防止）
  if (UI.quickMipBtn && UI.quickMipBtn.isConnected) return;

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "btn btn-primary btn-custom-secondary";
  btn.id = "lfp-quick-mip";

  btn.style.width = `${btnGet.getBoundingClientRect().width}px`;
  btn.style.marginLeft = "8px";
  btn.style.whiteSpace = "nowrap";
  btn.style.display = "inline-flex"; // 常に表示（有効/無効で制御）
  btn.style.alignItems = "center";
  btn.style.justifyContent = "center";
  btn.disabled = true; // 初期状態は無効（条件判定後に有効化）

  btn.innerHTML = `<span>MIP&nbsp;&nbsp;<i class="glyph-icon icon-linecons-paper-plane"></i></span>`;
  btn.addEventListener("click", () => clickRealMipButton());

  btnGet.parentElement?.appendChild(btn);
  UI.quickMipBtn = btn;
}

function removeQuickMipButton() {
  if (UI.quickMipBtn && UI.quickMipBtn.isConnected) UI.quickMipBtn.remove();
  UI.quickMipBtn = null;
}

/* ---------- OpenAI は openai.js に分離済み ---------- */

/* ---------- Evaluate / Optimize は optimize.js に分離済み ---------- */

/* ---------- State control: show UI only after Get Item populated Title ---------- */

// uiUnlocked, lastPasteAt は STORE.state に移行

function lockUI() {
  STORE.state.uiUnlocked = false;
  // UIを完全に消去して、次のタイトル出現まで待機する
  destroyMainUI();
  // ペースト時やGet Item直後に古いタイトルで再評価・再描画されるのを防ぐため、値をクリアする
  const titleEl = findTitleFieldSmart();
  if (titleEl) {
    setInputValue(titleEl, "");
  }
  // MIPボタンは削除せず、常時グレーアウト表示を維持（resetAllFlagsで無効化済み）
}

function unlockUI(titleEl) {
  STORE.state.uiUnlocked = true;
  ensureUIBelowTitle(titleEl);
  wireOptimizeButton(titleEl);

  // UI作成後、即座にステータスを更新（ラグ解消）
  const title = readText(titleEl);
  const len = (title || "").length;
  if (UI.status) {
    if (len > 0) {
      UI.status.textContent = `${chrome.i18n.getMessage("uiCharacters")}：${len} / ${chrome.i18n.getMessage("uiVero")}：- / ${chrome.i18n.getMessage("uiListing")}：-`;
    } else {
      UI.status.textContent = `${chrome.i18n.getMessage("uiCharacters")}：- / ${chrome.i18n.getMessage("uiVero")}：- / ${chrome.i18n.getMessage("uiListing")}：-`;
    }
  }

  // 出品統計も即座に更新
  refreshListingCountUI();
}

function wireOptimizeButton(titleEl) {
  if (!UI.btnOpt) return;
  if (UI.btnOpt.dataset.lfpWired) return;
  UI.btnOpt.dataset.lfpWired = "1";
  UI.btnOpt.addEventListener("click", async () => onOptimizeClick({ titleEl }));
}

/* ---------- History UI は history-ui.js に分離済み ---------- */
/* ---------- MutationObserver (debounced) ---------- */

// evalTimer, evalRunning は STORE.state 関連へ
let evalTimer = null;

function scheduleEvaluate(fn, delay = 300) {
  if (evalTimer) clearTimeout(evalTimer);
  evalTimer = setTimeout(async () => {
    // デッドロック防止: evalRunningが10秒以上trueのままなら強制リセット
    if (STORE.state.evalRunning) {
      const elapsed = Date.now() - (STORE.state._evalStartedAt || 0);
      if (elapsed > 10000) {
        console.warn('[LFP] evalRunning が10秒以上ロック状態。強制リセットします。');
        STORE.state.evalRunning = false;
      } else {
        return; // 正常にロック中
      }
    }
    STORE.state.evalRunning = true;
    STORE.state._evalStartedAt = Date.now();
    try {
      await fn();

      // Get Item完了後（評価後）に最速出品モードの判定
      const titleEl = findTitleFieldSmart();
      const btnGet = findButtonByText(/^Get Item$/i);
      if (STORE.opt.turboListingMode && titleEl && btnGet) {
        handleTurboListing(titleEl, btnGet);
      }
    } catch (err) {
      if (err.message && err.message.includes('Extension context invalidated')) {
        attemptRecovery(true);
      } else {
        console.error('[LFP] scheduleEvaluate error:', err);
      }
    } finally {
      STORE.state.evalRunning = false;
    }
  }, delay);
}

/**
 * 最速出品モード（ターボモード）の実行判定
 * ステータスが「OK」または「OK（最適化後）」になった瞬間にボタンを代理クリックする。(v1.1.1-fix)
 * ロック処理は行わず、既存のボタンの状態に従う。
 */
async function handleTurboListing(titleEl, btnGet) {
  if (!STORE.opt.turboListingMode) return;

  // すでにMIP実行済みの場合は何もせず終了（重複クリック防止）
  if (STORE.turboExecuted.mip) return;

  // 管理者なら無制限
  const currentPlan = (STORE.license.plan || "free").toLowerCase();

  if (currentPlan === 'free') {
    // BasicプランはTurbo不可。Popupで制限しているため、ここでONの場合はアカウント切り替え等のラグ。
    // アラートは出さずにSilentにOFFにする（再ログイン時の不快なポップアップを防ぐ）
    STORE.opt.turboListingMode = false;
    chrome.storage.sync.get(['lfp_options_v1']).then(data => {
      const opt = data.lfp_options_v1 || {};
      opt.turboListingMode = false;
      chrome.storage.sync.set({ 'lfp_options_v1': opt });
    });
    return;
  }
  // 1. 最適化が必要な場合（最大3回まで自動リトライ）
  // needsOptimize=true = タイトルが最適化前の状態 → 最適化ボタンを押す
  if (STORE.optimizeState.needsOptimize) {
    const titleVal = normSpace(readText(titleEl));
    // タイトルが空（取得中や完了後など）の場合は最適化を自動実行しない
    if (!titleVal) return;

    if (UI.btnOpt && !UI.btnOpt.disabled && !STORE.state.optimizeRunning && STORE.turboExecuted.optimizeCount < 3) {
      console.log(`[LFP] Turbo: 自動最適化ボタンをクリック (${STORE.turboExecuted.optimizeCount + 1}/3)`);
      STORE.turboExecuted.optimizeCount++;
      UI.btnOpt.click();
    }
  }
  // 2. 最適化完了後 or 最適化不要で出品可能な場合（MIP自動クリック）
  // isListable=true & needsOptimize=false = 最適化済みで出品可能 → MIPボタンを押す
  else if (STORE.optimizeState.isListable && !STORE.optimizeState.needsOptimize) {
    if (UI.quickMipBtn && !UI.quickMipBtn.disabled && !STORE.turboExecuted.mip) {
      // 最適化実行中（API待ち）ならスキップ（連打防止）
      if (STORE.state.optimizeRunning) return;

      console.log("[LFP] Turbo: 自動MIPボタンをクリック");
      STORE.turboExecuted.mip = true; // 実行済みフラグを先に立てる

      // 少し待機してから実行（DOMの安定待ち）
      setTimeout(() => {
        const success = clickRealMipButton();
        if (!success) {
          // クリックに失敗した場合はフラグを戻して再試行を可能にする
          STORE.turboExecuted.mip = false;
        }
      }, 250);
    }
  }
}

/**
 * ターボモードの使用カウントを加算する処理
 * OKボタン自動クリック処理を邪魔しないように分離
 */
async function checkAndIncrementTurboCount() {
  const currentPlan = (STORE.license.plan || '').toLowerCase();
  console.log(`[LFP] checkAndIncrementTurboCount called with plan: ${currentPlan}`);
  
  if (currentPlan !== 'pro' && currentPlan !== 'pro-trial') {
    console.log(`[LFP] Turbo count increment skipped for plan: ${currentPlan}`);
    return;
  }

  // メモリ上で既に制限到達（5回）が確認されている場合は、無駄なストレージアクセスをスキップ
  if (STORE.turboTrialAlertShown) {
    console.log(`[LFP] Turbo limit already reached today in memory. Skipping storage check.`);
    return;
  }

  try {
    const licData = await chrome.storage.local.get(['lfp_license_v1', 'lfp_active_email']);
    const email = licData.lfp_active_email || getYaballeCurrentEmail();
    const license = licData?.lfp_license_v1 || {};

    if (!license.turboTrialCounts) license.turboTrialCounts = {};

    if (email) {
      license.turboTrialCounts[email] = (license.turboTrialCounts[email] || 0) + 1;
      console.log(`[LFP] Account: ${email}, Turbo Trial Count incremented to: ${license.turboTrialCounts[email]}/5`);
    } else {
      license.turboTrialCount = (license.turboTrialCount || 0) + 1;
    }

    await chrome.storage.local.set({ 'lfp_license_v1': license });
    chrome.runtime.sendMessage({ type: "LFP_SYNC_REQUEST" });

    const currentCount = email ? license.turboTrialCounts[email] : license.turboTrialCount;

    if (currentCount >= 5) {
      console.log(`[LFP] Turbo limit reached (Count: ${currentCount}). Disabling Turbo Mode.`);
      
      STORE.opt.turboListingMode = false;
      const optionsData = await chrome.storage.sync.get(['lfp_options_v1']);
      const opt = optionsData?.lfp_options_v1 || {};
      opt.turboListingMode = false;
      await chrome.storage.sync.set({ 'lfp_options_v1': opt });
      
      const disableKey = email ? `lfp_turbo_auto_disabled_${email}` : 'lfp_turbo_auto_disabled';
      const alertKey = email ? `lfp_turbo_pending_alert_${email}` : 'lfp_turbo_pending_alert';
      
      // 永続フラグをセット（ページリフレッシュ対策）
      await chrome.storage.local.set({ 
        [disableKey]: true, 
        'lfp_turbo_auto_disabled': true,
        [alertKey]: true,
        'lfp_turbo_pending_alert': true 
      });
      
      STORE.turboTrialAlertShown = true;
      console.log("[LFP] Turbo limit reached. Alert pending.");
      // 即座に表示も試みる（ページがリロードされない場合のため）
      setTimeout(() => {
        showTurboLimitAlert();
      }, 1500);
    }
  } catch (err) {
    console.error("[LFP] Turbo count increment error:", err);
  }
}

// アラートの二重表示防止フラグ
let turboAlertShowing = false;

/**
 * Turbo Mode制限のアラートを表示する共通関数
 */
async function showTurboLimitAlert() {
  if (turboAlertShowing) return;
  turboAlertShowing = true;

  const email = getYaballeCurrentEmail();
  const alertKey = email ? `lfp_turbo_pending_alert_${email}` : 'lfp_turbo_pending_alert';
  
  // フラグをクリアしてから表示（二重表示防止）
  await chrome.storage.local.remove([alertKey, 'lfp_turbo_pending_alert']);
  
  await showLfpAlert(chrome.i18n.getMessage("msgTurboLimitReached"), chrome.i18n.getMessage("msgTurboLimitTitle"));
  
  // 表示が終わったらメモリフラグを完全リセット
  resetAllFlags();
  turboAlertShowing = false;
}


async function init() {
  // デッドロック防止: initRunningが5秒以上trueのままなら強制リセット（高速化）
  if (STORE.state.initRunning) {
    const elapsed = Date.now() - (STORE.state._initStartedAt || 0);
    if (elapsed > 5000) {
      console.warn('[LFP] initRunning が5秒以上ロック状態。強制リセットします。');
      STORE.state.initRunning = false;
    } else {
      return;
    }
  }

  STORE.state.initRunning = true;
  STORE.state._initStartedAt = Date.now();
  try {
    // 頻繁なストレージ読み込みを抑制
    await loadOptions();

    if (!isListerRoute()) { 
      console.log('[LFP] Not a lister route. Skipping UI init.');
      lockUI(); 
      return; 
    }

    const btnGet = findButtonByText(/^Get Item$/i);
    const asinInput = findAsinInputSmart(btnGet);
    
    if (!asinInput) {
      console.log('[LFP] ASIN input not found yet. Skipping UI init.');
      return;
    }

    const titleEl = findTitleFieldSmart(true);

    if (STORE.opt.historyEnabled && asinInput && (!UI.asinBar || !UI.asinBar.isConnected)) {
      const bar = document.createElement("div");
      bar.className = "lfp-asinbar";
      bar.id = "lfp-asinbar";

      const sel = document.createElement("select");
      sel.id = "lfp-hist";
      sel.innerHTML = `<option value="">${chrome.i18n.getMessage("uiHistoryCountPlaceholder")}</option>`;
      bar.appendChild(sel);

      // リセットボタンを追加
      const resetBtn = document.createElement("button");
      resetBtn.className = "lfp-reset-btn";
      resetBtn.textContent = chrome.i18n.getMessage("uiReset");
      resetBtn.title = chrome.i18n.getMessage("msgConfirmClearHistoryTitle");
      resetBtn.addEventListener("click", async () => {
        const confirmed = await showLfpConfirm(chrome.i18n.getMessage("msgConfirmClearHistory"), chrome.i18n.getMessage("msgConfirmClearHistoryTitle"));
        if (confirmed) {
          try {
            await resetHistory();
            // ページ内表示を更新（履歴のみ）
            await refreshHistorySelect(true);
            await refreshListingCountUI();
            await showLfpAlert(chrome.i18n.getMessage("msgHistoryCleared"), chrome.i18n.getMessage("msgHistoryClearedTitle"));
          } catch (err) {
            console.error('リセットエラー:', err);
            await showLfpAlert(chrome.i18n.getMessage("msgHistoryClearError"), chrome.i18n.getMessage("msgHistoryClearErrorTitle"));
          }
        }
      });
      bar.appendChild(resetBtn);

      // コピーボタンを追加
      const copyBtn = document.createElement("button");
      copyBtn.id = "lfp-copy-btn-id";
      copyBtn.className = "lfp-copy-btn";
      copyBtn.textContent = chrome.i18n.getMessage("uiCopy");
      copyBtn.title = chrome.i18n.getMessage("uiCopy");
      copyBtn.style.display = STORE.opt.showCopyCsvButtons ? "inline-block" : "none";
      bar.appendChild(copyBtn);

      // CSVボタンを追加
      const csvBtn = document.createElement("button");
      csvBtn.id = "lfp-csv-btn-id";
      csvBtn.className = "lfp-csv-btn";
      csvBtn.textContent = chrome.i18n.getMessage("uiCsv");
      csvBtn.title = chrome.i18n.getMessage("uiCsv");
      csvBtn.style.display = STORE.opt.showCopyCsvButtons ? "inline-block" : "none";
      bar.appendChild(csvBtn);

      // 統計情報ボタンを追加
      const statsBtn = document.createElement("button");
      statsBtn.id = "lfp-open-stats-btn";
      statsBtn.className = "lfp-stats-btn";
      statsBtn.textContent = chrome.i18n.getMessage("uiStats");
      statsBtn.title = chrome.i18n.getMessage("uiStatsDetailed");
      statsBtn.style.cssText = "background:#fff; border-color:rgba(0,0,0,.1); cursor:pointer; transition:background 0.2s;";
      statsBtn.addEventListener("mouseover", () => statsBtn.style.background = "#f0f0f0");
      statsBtn.addEventListener("mouseout", () => statsBtn.style.background = "#fff");
      statsBtn.addEventListener("click", (e) => {
        e.preventDefault();
        toggleStatsPopup();
      });
      statsBtn.style.display = STORE.opt.showStatistics ? "inline-block" : "none";
      bar.appendChild(statsBtn);

      // 出品件数ラベルを追加
      const countLabel = document.createElement("span");
      countLabel.className = "lfp-listing-count-label";
      countLabel.style.marginLeft = "12px";
      countLabel.style.fontSize = "14px";
      countLabel.style.fontWeight = "bold";
      countLabel.style.color = "#111";
      countLabel.style.display = "inline-flex";
      countLabel.style.alignItems = "center";
      countLabel.style.height = "32px";
      countLabel.textContent = `${chrome.i18n.getMessage("uiCompleted")}: -${chrome.i18n.getMessage("uiUnitItems")}`;
      countLabel.style.display = STORE.opt.showStatistics ? "inline-flex" : "none";
      bar.appendChild(countLabel);
      UI.listingCountLabel = countLabel;

      asinInput.parentElement?.insertBefore(bar, asinInput);

      UI.asinBar = bar;
      UI.histSel = sel;

      // MIPボタンもASINバーと同時に生成（表示タイミングを揃える）
      if (STORE.opt.quickMipButton && btnGet) ensureQuickMipButton(btnGet);

      await refreshHistorySelect();
      await refreshListingCountUI();

      // コピーボタンのイベント（スプレッドシート用2カラム形式）
      copyBtn.addEventListener("click", async () => {
        const hist = await loadHistory();
        if (hist.length === 0) {
          showLfpAlert(chrome.i18n.getMessage("msgNoHistoryToCopy"));
          return;
        }

        // ドロップダウンの表示テキストからエラー状態を直接判定するマップを作成
        // 履歴リスト(hist)は[最新, ..., 最古]の順
        // 貼り付け時は[最古, ..., 最新]の順（.reverse()）
        const dropdownItems = document.querySelectorAll('.lfp-dropdown-item');
        const errorMap = {};
        dropdownItems.forEach(el => {
          const text = el.textContent || "";
          const asin = el.dataset.asin;
          if (asin) {
            // 表示テキストが ! または × で始まる場合はエラーとみなす
            errorMap[asin] = text.startsWith('!') || text.startsWith('×');
          }
        });

        // 履歴を反転（古い順）させてから、スプレッドシート用の2カラム（出品日、エラー日）を作成
        const rows = [...hist].reverse().map(item => {
          const date = item.lastSeen ? new Date(item.lastSeen) : new Date();
          const dateStr = `${date.getMonth() + 1}/${date.getDate()}`;

          let dateCol1 = dateStr; // 出品日
          let dateCol2 = '';      // エラー日

          // エラー判定：
          // 1. 画面上の表示テキスト（! または ×）を最優先
          // 2. 保存されているフラグを次点
          const f = item.flags || {};
          const isError = (errorMap[item.asin] === true) ||
            !!(f.protected || f.brand || f.already_listed || f.no_listings || f.no_item);

          if (isError) {
            dateCol1 = '';
            dateCol2 = dateStr;
          }
          // 1行目から確実にタブを含める
          return `${dateCol1}\t${dateCol2}`;
        });

        // スプレッドシートへの貼り付け時にズレが生じないよう、末尾の改行のみを削除する
        const finalCopyText = rows.join("\r\n");

        // クリップボードにコピー（フォーカス喪失時のフォールバック付き）
        copyToClipboard(finalCopyText).then(() => {
          copyBtn.textContent = chrome.i18n.getMessage("uiCopyDone");
          setTimeout(() => {
            copyBtn.textContent = chrome.i18n.getMessage("uiCopy");
          }, 2000);
        }).catch(() => {
          copyBtn.textContent = chrome.i18n.getMessage("uiCopyFail");
          setTimeout(() => {
            copyBtn.textContent = chrome.i18n.getMessage("uiCopy");
          }, 2000);
        });
      });

      // CSV出力ボタンのイベント（スプレッドシート用2カラム形式）
      csvBtn.addEventListener("click", async () => {
        const hist = await loadHistory();
        if (hist.length === 0) {
          showLfpAlert(chrome.i18n.getMessage("msgNoHistoryToExport"));
          return;
        }

        let csvContent = "\uFEFF"; // BOM for Excel
        csvContent += `"${chrome.i18n.getMessage("csvHeaderAsin")}","${chrome.i18n.getMessage("csvHeaderResult")}","${chrome.i18n.getMessage("csvHeaderListedDate")}","${chrome.i18n.getMessage("csvHeaderErrorDate")}"\r\n`;

        // 履歴を反転（古い順）させてから出力
        [...hist].reverse().forEach(item => {
          const date = item.lastSeen ? new Date(item.lastSeen) : new Date();
          const dateStr = `${date.getMonth() + 1}/${date.getDate()}`;

          // 結果カラムを追加
          let result = chrome.i18n.getMessage("uiCompleted");
          if (item.flags?.no_listings) result = 'No listings';
          else if (item.flags?.no_item) result = 'No item';
          else if (item.flags?.protected) result = 'Protected';
          else if (item.flags?.brand) result = 'Brand';
          else if (item.flags?.already_listed) result = 'Already listed';

          let dateCol1 = dateStr; // 出品日
          let dateCol2 = ' ';     // エラー日（空白の場合はスペース）

          if (item.flags?.protected || item.flags?.brand || item.flags?.already_listed || item.flags?.no_listings || item.flags?.no_item) {
            dateCol1 = ' ';       // 空白の場合はスペース
            dateCol2 = dateStr;
          }

          csvContent += `"${item.asin}","${result}","${dateCol1}","${dateCol2}"\r\n`;
        });

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.setAttribute("href", url);
        link.setAttribute("download", `LFP_ASIN_History_${new Date().toLocaleDateString()}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      });

      sel.addEventListener("change", async () => {
        const v = sel.value;
        if (!v) return;
        
        // ペースト時のロジックと完全に同期させる
        okButtonClicked = false;
        listingCounted = false;
        STORE.turboExecuted.optimizeCount = 0;
        STORE.turboExecuted.mip = false;
        STORE.optimizeState.lastOutputs = [];
        STORE.lastRequestedAsin = v;

        onAsinInput().catch(e => console.error('[LFP] onAsinInput error:', e));
        lockUI();

        setInputValue(asinInput, v);

        // ペースト時と同じようにペースト直後判定を入れる（二重実行防止）
        STORE.state.lastPasteAt = now();

        if (STORE.opt.autoGetOnHistory && btnGet) {
          await sleep(30); // 最小限の遅延でAngular認識待ち
          const currentBtnGet = findButtonByText(/^Get Item$/i);
          if (currentBtnGet && currentBtnGet.isConnected) {
            handleGetItemClick().then(() => {
              currentBtnGet.click();
            }).catch(err => {
              currentBtnGet.click();
            });
          }
        }
      });
    }

    if (!titleEl) {
      lockUI();
      return;
    }

    const titleNow = normSpace(readText(titleEl));

    if (STORE.state.uiUnlocked) {
      ensureUIBelowTitle(titleEl);
      // MIPボタンを常時表示（初期状態はグレーアウト）
      if (STORE.opt.quickMipButton && btnGet) ensureQuickMipButton(btnGet);

      scheduleEvaluate(async () => {
        await evaluateAndRender({ titleEl, btnGet });
      }, 50);  // ラグ解消のため遅延を短縮

      if (!titleNow) lockUI();
    } else {
      destroyMainUI();
      // MIPボタンを常時表示（初期状態はグレーアウト）
      if (STORE.opt.quickMipButton && btnGet) ensureQuickMipButton(btnGet);

      if (titleNow) {
        unlockUI(titleEl);
        await sleep(30);
        await evaluateAndRender({ titleEl, btnGet });
      }
    }

    // 直接のリスナー登録（data-lfp-wired）は廃止し、イベント委譲（Delegation）に移行。
    // 代わりに要素の存在チェックとUIの整合性確認のみを行う。

    if (asinInput && (STORE.opt.historyEnabled || STORE.opt.autoGetOnPaste)) {
      if (!UI.asinBar || !UI.asinBar.isConnected) {
        // UIが未生成、または切り離されている場合は生成
        scheduleInit();
      }
    }

    // MutationObserverの初期化（初回のみ）
    if (!mainObserver) {
      mainObserver = new MutationObserver((muts) => {
        if (!isListerRoute()) return;
        for (const m of muts) {
          if (isInsideLfp(m.target)) return;
          if (m.addedNodes && Array.from(m.addedNodes).some(isInsideLfp)) return;
        }
        scheduleEvaluate(init, 300);
      });
      mainObserver.observe(document.body, { childList: true, subtree: true, characterData: true });

      // 新規: リアルタイム更新タイマーを起動
      startWorkTimeUpdateTimer();
    }

    // 各種Observerの初期化（初回のみ）
    if (!STORE.state.observersInitialized) {
      setupNoListingsObserver();
      setupListingSuccessObserver();
      setupGlobalEventListeners(); // 委譲リスナーをセットアップ
      setupListerPageDetection();  // 出現監視
      // メッセージリスナー
      chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.type === 'LFP_SYNC_UI') {
          refreshListingCountUI();
          // ドロップダウンが開いている場合は履歴の再構築をスキップ（閉じてしまう問題の防止）
          const dropdown = document.getElementById('lfp-custom-dropdown');
          if (!dropdown || dropdown.style.display !== 'block') {
            refreshHistorySelect();
          }
        } else if (message.type === 'RESET_UI') {
          resetAllFlags();
          // ASIN入力欄もクリア
          const asinInput = findAsinInputSmart();
          if (asinInput) setInputValue(asinInput, "");
          sendResponse({ ok: true });
        }
        return true;
      });
      STORE.state.observersInitialized = true;
    }

  } catch (err) {
    if (typeof isContextInvalidatedError === 'function' && isContextInvalidatedError(err)) {
      console.error('[LFP] Extension context invalidated detected in init');
      if (typeof attemptRecovery === 'function') attemptRecovery(true);
    } else {
      console.error('[LFP] init error:', err);
    }
  } finally {
    STORE.state.initRunning = false;
  }
}

/* No listingsモーダル検出用のMutationObserver */
/**
 * エラーモーダルの検知と自動処理（履歴更新・ターボ時は自動クローズ）
 */
/* ---------- Modal Observer (エラー/成功モーダル監視) は observers.js に分離済み ---------- */

/* ---------- Route ---------- */

let routeTimer = null;
let lastInitCall = 0;
function scheduleInit(delay = 250) {
  const now = Date.now();
  // 非常に短い間隔（100ms以内）での連続呼び出しを抑制
  if (now - lastInitCall < 100) return;
  lastInitCall = now;

  if (routeTimer) clearTimeout(routeTimer);
  routeTimer = setTimeout(() => {
    init().catch((err) => {
      console.error('[LFP] scheduleInit -> init error:', err);
    });
  }, delay);
}

// URLハッシュの変更を監視（SPAの画面遷移対策）
window.addEventListener("hashchange", () => {
  // 既にコンテキストが無効な場合は何もしない
  if (!isExtensionContextValid()) return;

  // UIを完全にクリーンアップ
  if (UI.asinBar && UI.asinBar.isConnected) {
    UI.asinBar.remove();
  }
  UI.asinBar = null;
  UI.histSel = null;

  if (!isListerRoute()) {
    lockUI();
  } else {
    // Listerページに遷移した場合、UIをリセットして再初期化
    lockUI();
  }

  try { lfpApplyMipCompactLabel(); } catch (_) { }
  scheduleInit();
});

scheduleInit();

/* LFP MIP COMPACT PATCH START */
function lfpCompactMipLabelFor(el) {
  if (!el) return;
  const span = el.querySelector("span");
  if (!span) return;

  // すでに置換済みなら何もしない
  if (span.dataset.lfpCompact === "1") return;
  span.dataset.lfpCompact = "1";

  // 中身を「MIP + 紙飛行機」に統一
  span.innerHTML = `MIP <i class="glyph-icon icon-linecons-paper-plane"></i>`;

  // span自体の中央寄せ・幅確保（CSS側でもやるが念のため）
  span.style.display = "inline-flex";
  span.style.alignItems = "center";
  span.style.justifyContent = "center";
  span.style.gap = "10px";
  span.style.whiteSpace = "nowrap";
  span.style.width = "100%";
}

function lfpApplyMipCompactLabel() {
  // 実ボタン
  const real = document.querySelector("#mip-list-item-btn");
  if (real) lfpCompactMipLabelFor(real);

  // クイックMIP（存在する場合）
  const quick = document.querySelector("#lfp-quick-mip");
  if (quick) lfpCompactMipLabelFor(quick);
}
/* LFP MIP COMPACT PATCH END */

// 重複する直接リスナーは廃止し、setupGlobalEventListeners の委譲リスナーに一本化しました。

// URLハッシュ変更を検知してSPA遷移時に拡張機能を再初期化
let lastHash = location.hash;

function setupSPANavigationDetection() {
  const checkHashChange = async () => {
    const currentHash = location.hash;

    // ハッシュが変更された場合
    if (currentHash !== lastHash) {
      lastHash = currentHash;

      // Listerページに遷移した場合、拡張機能を再初期化
      if (isListerRoute()) {

        // 少し待ってから初期化（DOMが更新されるのを待つ）
        await sleep(300);
        scheduleEvaluate(init, 200);
      }
    }
  };

  // hashchange イベントを監視
  window.addEventListener('hashchange', checkHashChange);

  // MutationObserverでもURL変更を監視（念のため）
  if (!urlChangeObserver) {
    urlChangeObserver = new MutationObserver(() => {
      if (location.hash !== lastHash) {
        checkHashChange();
      }
    });

    urlChangeObserver.observe(document.querySelector('title') || document.head, {
      childList: true,
      subtree: true,
      characterData: true
    });
  }

}


// SPA遷移検知を開始
setupSPANavigationDetection();

/**
 * 定期的なヘルスチェック（ウォッチドッグ）
 * 10秒に一度、UIが消えていないか・リスターページから外れていないかを監視
 */
setInterval(async () => {
  if (!isExtensionContextValid()) return;
  if (!isListerRoute()) return;

  const uiExists = document.getElementById("lfp-status-box");
  const titleField = findTitleFieldSmart();
  
  // Listerページでタイトル入力欄があるのにUIがない場合は、何らかの理由で止まっている
  if (!uiExists && titleField && !STORE.state.initRunning) {
    scheduleInit(100);
  }
}, 10000);


/* ---------- Window Focus Recovery ---------- */

// ウィンドウがフォーカスを取り戻した時に拡張機能を再初期化
let lastFocusTime = Date.now();
let focusRecoveryInProgress = false;

window.addEventListener('focus', async () => {
  // 連続呼び出し防止（1秒以内の再フォーカスは無視）
  const now = Date.now();
  if (now - lastFocusTime < 1000) return;
  lastFocusTime = now;

  // 既にリカバリー中なら無視
  if (focusRecoveryInProgress) return;
  focusRecoveryInProgress = true;

  try {
    console.log('🔄 [Focus Recovery] ウィンドウがフォーカスを取り戻しました');

    // リカバリー用の待機時間を大幅に短縮（ユーザー体験向上）
    await sleep(50);

    // エクステンションコンテキストの有効性をチェック
    if (!isExtensionContextValid()) {
      console.log('[LFP] フォーカス検知によりコンテキスト無効化を確認（更新済み）。自動リカバリーをスキップします。');
      return;
    }

    // Listerページでない場合は何もしない
    if (!isListerRoute()) return;

    // UIが存在するかチェック
    const uiExists = document.querySelector('.lfp-asinbar, .lfp-status-box');
    const titleEl = findTitleFieldSmart();

    if (!uiExists && titleEl) {
      // UIが消えている場合は再初期化
      console.log('⚠️ [Focus Recovery] UIが消えています。再初期化します。');
      resetAllFlags();
      STORE.state.observersInitialized = false;
      scheduleInit();
    } else if (uiExists) {
      // UIは存在するが、オプションを再読み込みして状態を同期
      await loadOptions();
      await refreshListingCountUI();
      console.log('✅ [Focus Recovery] オプションを再読み込みし、UIを同期しました');
    }
  } finally {
    focusRecoveryInProgress = false;
  }
});

// ページの可視性やフォーカスが変わった時の処理（ウィンドウ切り替え・分割画面対応）
async function syncExtensionState() {
  // タブ切り替えやウィンドウフォーカス直後の不安定な状態を避けるため、わずかに待機
  await new Promise(r => setTimeout(r, 300));

  // エクステンションコンテキストの有効性をチェック
  if (!isExtensionContextValid()) {
    console.log('⚠️ [Sync] エクステンションコンテキストが無効です。リカバリーを試行します。');
    await attemptRecovery(true);
    return;
  }

  // オプションを再読み込み（スプレッドシート側で設定を変えた場合などの同期）
  await loadOptions();

  // UIが消えていないかチェック（Listerページの場合のみ）
  if (isListerRoute()) {
    const uiExists = document.querySelector('.lfp-asinbar');
    if (!uiExists && findAsinInputSmart()) {
      console.log('⚠️ [Sync] UIが消失しています。再初期化します。');
      scheduleInit(100);
    }
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') syncExtensionState();
});

window.addEventListener('focus', () => {
  syncExtensionState();
});

/* ---------- Health Check ---------- */

// 定期的なヘルスチェック（30秒ごと）
let healthCheckInterval = null;

function startHealthCheck() {
  if (healthCheckInterval) return;

  healthCheckInterval = setInterval(async () => {
    try {
      // Listerページでない場合はスキップ
      if (!isListerRoute()) return;

      // エクステンションコンテキストの有効性をチェック
      if (!isExtensionContextValid()) {
        console.log('[LFP] ヘルスチェックによりコンテキスト無効化を検知（拡張機能が更新されました）。監視を停止します。');
        if (healthCheckInterval) {
          clearInterval(healthCheckInterval);
          healthCheckInterval = null;
        }
        return;
      }

      // UIが存在するかチェック
      const uiExists = document.querySelector('.lfp-asinbar');
      const titleEl = findTitleFieldSmart();

      if (!uiExists && titleEl) {
        // UIが消えている場合は再初期化
        console.log('⚠️ [Health Check] UIが消えています。再初期化します。');
        resetAllFlags();
        STORE.state.observersInitialized = false;
        scheduleInit();
      }
    } catch (err) {
      // Extension context invalidated エラーを捕捉
      if (err.message && (err.message.includes('Extension context invalidated') || err.message.includes('context_invalidated'))) {
        console.log('[LFP] ヘルスチェック中にコンテキスト無効化を検知。インターバルを停止します。');
        if (healthCheckInterval) {
          clearInterval(healthCheckInterval);
          healthCheckInterval = null;
        }
      } else {
        console.error('[LFP] Health Check Error:', err);
      }
    }
  }, 5000); // 5秒ごと（ログイン後の遜移にも素早く対応）
}

// ヘルスチェックを開始
startHealthCheck();

/* ---------- Listerページ出現監視 ---------- */

/**
 * body全体のDOM変更を監視し、ASIN入力欄が出現したらUIを再構築。
 * ログイン/ログアウト、アカウント切り替え、メニュー遜移など、
 * hashchangeでは捕捉できないSPA内の画面切り替えを検知するための最終防衛線。
 */
let listerPageCheckTimer = null;

function setupListerPageDetection() {
  if (listerPageObserver) return; // 既にセットアップ済み

  listerPageObserver = new MutationObserver(() => {
    // デバウンス：短時間に何度も呼ばれるので300msごとに刻む
    if (listerPageCheckTimer) return;
    listerPageCheckTimer = setTimeout(() => {
      listerPageCheckTimer = null;
      checkListerPageAppeared();
    }, 300);
  });

  const container = document.body;
  listerPageObserver.observe(container, {
    childList: true,
    subtree: true
  });

  console.log('🔍 [LFP] Listerページ出現監視を開始しました');
}

function checkListerPageAppeared() {
  // Listerページでない場合はスキップ
  if (!isListerRoute()) return;

  // ASIN入力欄が存在するか？
  const asinInput = findAsinInputSmart();
  if (!asinInput) return;

  // 既にUIが表示されているなら何もしない
  const uiExists = UI.asinBar && UI.asinBar.isConnected;
  if (uiExists) return;

  // ASIN入力欄があるのにUIがない → 再初期化が必要
  console.log('🔄 [LFP] Listerページが検出されましたがUIがありません。再初期化します。');
  resetAllFlags();
  STORE.state.observersInitialized = false;
  scheduleInit(100); // 即座に近いタイミングで初期化
}

// Listerページ出現監視を開始
setupListerPageDetection();

/**
 * イベント委譲によるグローバルイベントリスナーのセットアップ
 * SPAによる要素の破壊・再生成に影響されない堅牢な監視
 */
function setupGlobalEventListeners() {
  // すでに登録済みの場合はスキップ
  if (document.documentElement.dataset.lfpWired === "1") return;
  document.documentElement.dataset.lfpWired = "1";

  // キャプチャリングフェーズで監視することで、他スクリプトの stopPropagation による影響を最小限に抑える
  document.addEventListener("click", async (e) => {
    // 既にコンテキストが無効な場合は何もしない
    if (!isExtensionContextValid()) return;

    // 1. Get Itemボタンのクリック監視
    // Yaballeのボタン構造変更（span等）に強固にするため closest() 制限を撤廃
    const btnGet = findButtonByText(/^Get Item$/i);
    if (btnGet && (e.target === btnGet || btnGet.contains(e.target) || e.target.closest('button, [role="button"]') === btnGet)) {
      
      // 手動クリック時に、input入力遅延による自動クリックタイマーが走っていればキャンセルする（二重API通信防止）
      if (typeof asinInputDebounceTimer !== 'undefined' && asinInputDebounceTimer) {
        clearTimeout(asinInputDebounceTimer);
        asinInputDebounceTimer = null;
      }

      handleGetItemClick();
      
      // ボタン手動クリック（isTrusted=true）時のみ強力なUI強制再起動をかける（自動化時はチラつき防止のためスキップ）
      if (e.isTrusted) {
        console.log('♻️ [LFP] Manual click recovery: Forcing fresh UI initialization.');
        destroyMainUI();
        if (UI.asinBar && UI.asinBar.isConnected) UI.asinBar.remove();
        UI.asinBar = null;
        STORE.state.observersInitialized = false;
        STORE.state.initRunning = false;
        scheduleInit(50);
      } else {
        // 自動クリック時は既存UIを維持したまま初期化のみ試みる（ヘルスチェック）
        scheduleInit(100);
      }
      return;
    }

    // 2. リアルMIPボタン（Yaballe本来の出品ボタン）のクリック監視
    const realMip = findRealMipButton();
    if (realMip && (e.target === realMip || realMip.contains(e.target))) {
      console.log("🎯 [LFP] リアルMIPボタンのクリックを検知。状態を同期します。");
      STORE.turboExecuted.mip = true;
      if (UI.btnOpt) UI.btnOpt.disabled = true;
      setBusy(false); // 表示を強制リセット
    }
  }, true);

  document.addEventListener("focusin", (e) => {
    // 既にコンテキストが無効な場合は何もしない
    if (!isExtensionContextValid()) return;

    const asinInput = findAsinInputSmart();
    if (asinInput && (e.target === asinInput || asinInput.contains(e.target))) {
      if (!UI.asinBar || !UI.asinBar.isConnected) {
        console.log('🎯 [LFP] ASIN入力欄のフォーカスを検知（Delegation）。UIを復旧します。');
        scheduleInit();
      }
    }
  }, true);

  // ASIN貼り付けイベントの監視 (即時実行ロジック)
  document.addEventListener("paste", async (e) => {
    // 既にコンテキストが無効な場合は何もしない
    if (!isExtensionContextValid()) return;

    if (!STORE.opt.autoGetOnPaste) return;

    const btnGet = findButtonByText(/^Get Item$/i);
    const asinInput = findAsinInputSmart(btnGet);
    
    // 入力欄へのペーストか検証
    const isTarget = asinInput && (e.target === asinInput || asinInput.contains(e.target) || document.activeElement === asinInput);
    if (!isTarget) return;

    // クリップボードのテキストを直接取得
    const clipboardData = e.clipboardData || window.clipboardData;
    if (!clipboardData) return;
    const pastedText = clipboardData.getData('text');
    const val = normSpace(pastedText || "");

    // フォーマット検証
    if (!/^B0[A-Z0-9]{8}$/i.test(val)) return;

    // ペースト直後の重複実行を防止
    const t = now();
    if (t - STORE.state.lastPasteAt < 500) return;
    STORE.state.lastPasteAt = t;

    // Angularのデフォルトペーストとデータバインディングによる遅延や競合をキャンセル
    e.preventDefault();

    // 即座にフラグをリセットし、UIを無効化
    okButtonClicked = false;
    listingCounted = false;
    STORE.turboExecuted.optimizeCount = 0;
    STORE.turboExecuted.mip = false;
    STORE.optimizeState.lastOutputs = [];
    STORE.lastRequestedAsin = val;

    onAsinInput().catch(e => console.error('[LFP] onAsinInput error:', e));
    lockUI();

    // 拡張機能側から同期的に値をセットし、Angularに認識させる
    setInputValue(asinInput, val);

    // Angularの内部状態更新を最短で待機
    await sleep(30);

    // 最新のボタンを取り直して即時クリック（0.3秒の遅延排除）
    const currentBtnGet = findButtonByText(/^Get Item$/i);
    if (currentBtnGet && currentBtnGet.isConnected) {
      handleGetItemClick().then(() => {
        currentBtnGet.click();
      }).catch(err => {
         console.error('[LFP] handleGetItemClick error during paste:', err);
         currentBtnGet.click();
      });
    }
  }, true);

  // ASIN入力欄のinputイベント: 手動入力・修正・ペーストでASIN形式が完成したら自動Get Item
  let asinInputDebounceTimer = null;

  document.addEventListener("input", async (e) => {
    // 既にコンテキストが無効な場合は何もしない
    if (!isExtensionContextValid()) return;

    const btnGet = findButtonByText(/^Get Item$/i);
    const asinInput = findAsinInputSmart(btnGet);
    if (asinInput && (e.target === asinInput || asinInput.contains(e.target))) {
      await onAsinInput();

      // autoGetOnPasteがONの場合、ASIN形式が完成したら自動Get Item
      if (!STORE.opt.autoGetOnPaste) return;

      // ペーストイベントと重複しないようにガード（ペースト直後800ms以内はスキップ）
      if (now() - STORE.state.lastPasteAt < 800) return;

      // デバウンス: 300ms待って入力が安定してから判定（手入力・別要因のペースト共通）
      if (asinInputDebounceTimer) clearTimeout(asinInputDebounceTimer);
      asinInputDebounceTimer = setTimeout(async () => {
        const val = normSpace(asinInput.value || "");
        // B0で始まる10桁の英数字かチェック
        if (/^B0[A-Z0-9]{8}$/i.test(val)) {
          lockUI();
          
          STORE.turboExecuted.optimizeCount = 0;
          STORE.turboExecuted.mip = false;
          STORE.optimizeState.lastOutputs = [];
          STORE.lastRequestedAsin = val;
          
          // 非ブロッキング実行
          handleGetItemClick().then(() => {
            const btnGet = findButtonByText(/^Get Item$/i);
            if (btnGet && btnGet.isConnected) {
              btnGet.click();
            }
          }).catch(e => {
             console.error('[LFP] handleGetItemClick (input) error:', e);
             findButtonByText(/^Get Item$/i)?.click();
          });
        }
      }, 300);
    }
  }, true);

  console.log('🛠️ [LFP] イベント委譲リスナーをセットアップしました');
}

/**
 * Get Itemクリック時の統合処理
 */
async function handleGetItemClick() {
  // FreeプランでもGet Itemは無制限（最適化のみに制限をかける）

  const btnGet = findButtonByText(/^Get Item$/i);
  const asinInput = findAsinInputSmart(btnGet);

  // 前回の判定結果が残らないように毎回リセット
  // これによりMIPなどの自動アクションが新ASINで再びトリガ可能になる
  resetAllFlags();

  // 前回のタイトルを記録（画面更新検出用）
  let t = findTitleFieldSmart();
  if (t) {
    STORE.lastTitle = normSpace(readText(t));
  }

// 最後にリクエストしたASINを記録
  const asin = normSpace(asinInput?.value || "");
  if (asin) {
    console.log(`🚀 [LFP] handleGetItemClick for ASIN: ${asin}`);
    // ASINが新しくなった場合のみ、ボタンクリック履歴をリセット（同一ASIN内での二重動作を防止）
    if (STORE.lastRequestedAsin !== asin) {
      console.log("🔄 [LFP] New ASIN detected. Resetting automation flags.");
      okButtonClicked = false;
      listingCounted = false;
    }
    STORE.lastRequestedAsin = asin;
    STORE.turboExecuted.optimizeCount = 0;
    STORE.turboExecuted.mip = false;
    STORE.optimizeState.lastOutputs = [];  // 新しいASINでは出力履歴をリセット
    await saveHistoryPush(asin);
    await updateHistoryFlags(asin, {
      protected: false,
      brand: false,
      already_listed: false,
      no_listings: false
    });
    await refreshHistorySelect(true);
  }
}



/* ========== 作業時間計測 / 統計ポップアップは worktime.js に分離済み ========== */

/**
 * 起動時に一度だけ保留中のTurbo警告をチェックする
 */
async function checkPendingTurboAlert() {
  try {
    const email = getYaballeCurrentEmail();
    const alertKey = email ? `lfp_turbo_pending_alert_${email}` : 'lfp_turbo_pending_alert';
    const pendingData = await chrome.storage.local.get([alertKey, 'lfp_turbo_pending_alert']);
    if (pendingData[alertKey] || pendingData['lfp_turbo_pending_alert']) {
      console.log("⚠️ [LFP] Pending Turbo alert found at startup.");
      setTimeout(() => {
        showTurboLimitAlert();
      }, 2000); 
    }
  } catch (e) {}
}
checkPendingTurboAlert();
