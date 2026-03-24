/* ListerFlow Pro for Yaballe - store.js
   グローバル状態管理（STORE定数 + 全グローバル変数）
   ※ このファイルは content_scripts の最初に読み込まれる必要があります
*/

const STORE = {
  opt: {
    apiKey: "",
    model: "gpt-4o-mini",
    veroEnabled: true,
    autoGetOnPaste: true,
    autoGetOnHistory: true,
    autoMipAfterOptimize: false,
    quickMipButton: true,
    highlightOptimize: true,
    historyEnabled: true,
    autoClickOkAfterMip: true,
    turboListingMode: false,
    showCopyCsvButtons: true
  },
  // 実行状態・フラグ管理
  state: {
    evalRunning: false,
    initRunning: false,
    optimizeRunning: false,
    uiUnlocked: false,
    observersInitialized: false,
    lastPasteAt: 0
  },
  // 最適化状態の追跡
  optimizeState: {
    needsRetry: false,
    lastOutputs: [],
    isListable: true
  },
  // 最後にリクエストしたASIN
  lastRequestedAsin: "",
  // ターボモードの実行済みフラグ
  turboExecuted: {
    optimizeCount: 0,
    mip: false
  },
  // エラーハンドリング
  errorHandling: {
    timestamp: 0,
    cleanerInterval: null,
    lastAsin: ""
  },
  // 最後に表示したタイトル（変更検知用）
  lastTitle: "",
  // 出品ステータス表示用
  shipStatus: "",
  // ライセンス・プラン
  license: {
    plan: "free",
    dailyLimit: 2,
    usageCount: 0,
    lastUsedDate: "",
    proTrialStartDate: ""
  },
  yaballeEmail: null,
  stats: {
    todayListings: 0,
    weekListings: 0,
    totalListings: 0,
    lastListingTime: null,
    todayErrors: 0,
    errorRate: 0,
    listingSpeed: 0
  }
};

// Observer管理用のグローバル変数
let mainObserver = null;
let noListingsObserver = null;
let listingSuccessObserver = null;
let urlChangeObserver = null;
let listerPageObserver = null;
// observersInitialized は STORE.state に移行

// イベントリスナー管理用
let dropdownClickHandler = null;
let dropdownMousedownHandler = null;

// setInterval管理用
let okButtonCheckInterval = null;
let workTimeUpdateInterval = null;

// 履歴操作のロック
let historyLock = false;
