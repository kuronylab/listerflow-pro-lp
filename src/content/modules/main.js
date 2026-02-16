/**
 * main.js
 * メインロジック（初期化、イベント処理、統合）
 */

import { TITLE_LENGTH, DEFAULT_OPTIONS, HISTORY } from './constants.js';
import { sleep, isListerRoute } from './utils.js';
import { loadOptions, loadHistory, addToHistory, incrementListingCount } from './storage.js';
import { 
  findButtonByText, 
  findAsinInputSmart, 
  findTitleFieldSmart,
  readText,
  setInputValue,
  extractWarningBlockText,
  extractProtectedText,
  extractDuplicationError
} from './dom.js';
import { 
  parseVeroTerms, 
  buildVeroMatchers, 
  countVeroInText,
  computeShipReasons,
  evaluateVeroStatus
} from './vero.js';
import { callOpenAI, buildOptimizePrompt } from './openai.js';
import { 
  UI,
  ensureUIBelowTitle, 
  setBusy, 
  setStatusLine, 
  setBadge, 
  resetUIState,
  ensureQuickMipButton,
  removeQuickMipButton,
  fixMipButtonBgCover,
  createAsinHistoryBar,
  refreshHistorySelect
} from './ui.js';

// グローバルストア
export const STORE = {
  opt: { ...DEFAULT_OPTIONS },
  optimizeState: {
    needsRetry: false
  }
};

// MutationObserver
let mainObserver = null;
let noListingsObserver = null;
let listingSuccessObserver = null;

/**
 * 拡張機能の初期化
 */
let initRunning = false;

export async function init() {
  if (initRunning) return;
  initRunning = true;

  try {
    // MIPボタンの背景が紙飛行機までカバーするようDOMを整形
    fixMipButtonBgCover();
    STORE.opt = await loadOptions();
    
    if (!isListerRoute()) {
      lockUI();
      return;
    }

    const btnGet = findButtonByText(/^Get Item$/i);
    const asinInput = findAsinInputSmart(btnGet);
    const titleEl = findTitleFieldSmart();

    // ASIN履歴バーの作成
    if (STORE.opt.historyEnabled && asinInput && (!UI.asinBar || !UI.asinBar.isConnected)) {
      createAsinHistoryBar(asinInput, btnGet);
      await refreshHistorySelect(loadHistory, setInputValue, sleep, STORE);
    }

    // Quick MIPボタンの作成
    if (STORE.opt.quickMipButton && btnGet && (!UI.quickMipBtn || !UI.quickMipBtn.isConnected)) {
      ensureQuickMipButton(btnGet, STORE);
    } else if (!STORE.opt.quickMipButton) {
      removeQuickMipButton();
    }

    // メインUIの作成
    if (titleEl) {
      ensureUIBelowTitle(titleEl, STORE);
      
      // 最適化ボタンのイベントリスナー
      if (UI.btnOpt && !UI.btnOpt.dataset.listenerAttached) {
        UI.btnOpt.addEventListener("click", () => handleOptimizeClick(titleEl, btnGet));
        UI.btnOpt.dataset.listenerAttached = "true";
      }
    }

  // 評価と表示
  await evaluateAndRender({ titleEl, btnGet });

  // 最速出品モードの自動実行判定
  if (STORE.opt.turboListingMode) {
    handleTurboListing(titleEl, btnGet);
  }

  // MutationObserverの設定
    setupMainObserver();
    setupNoListingsObserver();
    setupListingSuccessObserver();

  } catch (err) {
    console.error('[LFP] init error:', err);
  } finally {
    initRunning = false;
  }
}

/**
 * UIをロック（Listerページ以外）
 */
function lockUI() {
  if (UI.btnOpt) UI.btnOpt.disabled = true;
  if (UI.quickMipBtn) UI.quickMipBtn.disabled = true;
}

/**
 * 評価と表示
 */
export async function evaluateAndRender({ titleEl, btnGet }) {
  const title = readText(titleEl);
  const len = (title || "").length;

  const blockText = extractWarningBlockText();
  const protectedText = extractProtectedText();
  const duplicationError = extractDuplicationError();
  
  const terms = parseVeroTerms(blockText);
  const titleTerms = terms.filter(t => t.kind === "title");
  const matchers = buildVeroMatchers(titleTerms);
  
  // 判定用のveroCount（従来通り）
  const veroCount = STORE.opt.veroEnabled ? countVeroInText(title, matchers) : 0;

  // 出品不可理由を計算
  const reasons = computeShipReasons({
    blockText,
    protectedText,
    descText: "", // 簡略化
    duplicationError
  });

  // VeRO判定
  const { shipText, canOptimize, canShip } = evaluateVeroStatus({
    title,
    blockText,
    reasons
  });

  // ステータスラインを更新
  const highlight = canOptimize && !canShip;
  setStatusLine(len, veroCount, shipText, highlight, STORE);

  // 最適化ボタンの状態
  if (UI.btnOpt) {
    UI.btnOpt.disabled = !canOptimize;
    UI.btnOpt.style.display = canOptimize ? "inline-block" : "none";
  }

  // Quick MIPボタンの状態
  if (UI.quickMipBtn) {
    UI.quickMipBtn.disabled = !canShip;
  }
}

/**
 * 最適化ボタンのクリックハンドラ
 */
async function handleOptimizeClick(titleEl, btnGet) {
  setBusy(true, STORE);
  
  try {
    const title = readText(titleEl);
    const blockText = extractWarningBlockText();
    const terms = parseVeroTerms(blockText);
    const titleTerms = terms.filter(t => t.kind === "title");
    const forbiddenTerms = titleTerms.map(t => t.term);
    
    // OpenAI APIで最適化
    const targetLen = TITLE_LENGTH.TARGET;
    const { messages } = buildOptimizePrompt({
      title,
      desc: "",
      forbiddenTerms,
      targetLen,
      tryNum: 1,
      prevOutput: "",
      prevLen: 0
    });
    
    const optimized = await callOpenAI({
      apiKey: STORE.opt.openaiApiKey,
      model: STORE.opt.openaiModel,
      messages
    });
    
    // タイトルを更新
    setInputValue(titleEl, optimized);
    setBadge("✅ 最適化完了");
    
    // 再評価
    await sleep(100);
    await evaluateAndRender({ titleEl, btnGet });

    // 最速出品モードの場合、最適化後にMIPをクリック
    if (STORE.opt.turboListingMode) {
      const statusText = UI.status?.textContent || "";
      if (statusText.includes("出品：OK")) {
        if (UI.quickMipBtn && !UI.quickMipBtn.disabled) {
          UI.quickMipBtn.click();
        }
      }
    }
    
  } catch (err) {
    console.error('[LFP] optimize error:', err);
    setBadge("❌ 最適化失敗");
  } finally {
    setBusy(false, STORE);
  }
}

/**
 * メインのMutationObserverを設定
 */
function setupMainObserver() {
  if (mainObserver) return;
  
  mainObserver = new MutationObserver((mutations) => {
    scheduleEvaluate(async () => {
      const titleEl = findTitleFieldSmart();
      const btnGet = findButtonByText(/^Get Item$/i);
      await evaluateAndRender({ titleEl, btnGet });
    });
  });
  
  const titleEl = findTitleFieldSmart();
  if (titleEl) {
    mainObserver.observe(titleEl, {
      attributes: true,
      attributeFilter: ["value"],
      childList: true,
      characterData: true,
      subtree: true
    });
  }
}

/**
 * No listingsモーダルのObserverを設定
 */
function setupNoListingsObserver() {
  if (noListingsObserver) return;
  
  noListingsObserver = new MutationObserver((mutations) => {
    // No listingsモーダルを検出してASIN履歴にフラグを記録
    // 簡略化のため省略
  });
  
  noListingsObserver.observe(document.body, {
    childList: true,
    subtree: true
  });
}

/**
 * Listing SuccessモーダルのObserverを設定
 */
function setupListingSuccessObserver() {
  if (listingSuccessObserver) return;
  
  listingSuccessObserver = new MutationObserver((mutations) => {
    if (!STORE.opt.autoClickOkAfterMip) return;

    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (node.nodeType !== 1) continue;
        
        // モーダル全体のテキストを確認
        const text = node.innerText || node.textContent || "";
        if (/Listing\s+Success/i.test(text)) {
          // OKボタンを探す
          const btnOk = node.querySelector('button.btn-success') || findButtonByText(/^OK$/i);
          if (btnOk) {
            console.log("[LFP] Listing Successを検出。OKボタンをクリックします。");
            setTimeout(() => btnOk.click(), 500);
            
            // 出品数をカウント
            incrementListingCount();
          }
        }
      }
    }
  });
  
  listingSuccessObserver.observe(document.body, {
    childList: true,
    subtree: true
  });
}

/**
 * 評価をスケジュール（デバウンス）
 */
let evalTimer = null;
let evalRunning = false;

function scheduleEvaluate(fn, delay = 300) {
  if (evalTimer) clearTimeout(evalTimer);
  evalTimer = setTimeout(async () => {
    if (evalRunning) return;
    evalRunning = true;
    try {
      await fn();
      
      // Get Item完了後（評価後）に最速出品モードの判定
      const titleEl = findTitleFieldSmart();
      const btnGet = findButtonByText(/^Get Item$/i);
      if (STORE.opt.turboListingMode && titleEl && btnGet) {
        handleTurboListing(titleEl, btnGet);
      }
    } catch (err) {
      console.error('[LFP] scheduleEvaluate error:', err);
    } finally {
      evalRunning = false;
    }
  }, delay);
}

/**
 * 最速出品モードの実行判定
 */
async function handleTurboListing(titleEl, btnGet) {
  // すでに実行中（busy）ならスキップ
  if (UI.btnOpt?.disabled && UI.spin?.style.display !== "none") return;

  const statusText = UI.status?.textContent || "";
  
  if (statusText.includes("出品：OK（最適化後）")) {
    // 最適化ボタンを自動クリック
    if (UI.btnOpt && !UI.btnOpt.disabled) {
      UI.btnOpt.click();
    }
  } else if (statusText.includes("出品：OK")) {
    // Quick MIPボタンを自動クリック
    if (UI.quickMipBtn && !UI.quickMipBtn.disabled) {
      UI.quickMipBtn.click();
    }
  }
}

/**
 * ルート変更時の初期化スケジュール
 */
let routeTimer = null;

function scheduleInit() {
  if (routeTimer) clearTimeout(routeTimer);
  routeTimer = setTimeout(() => { init().catch(() => { }); }, 250);
}

// ハッシュ変更時の再初期化
window.addEventListener("hashchange", () => {
  if (!isListerRoute()) lockUI();
  scheduleInit();
});

// 初回実行
scheduleInit();
