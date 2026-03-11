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
    quickMipButton: true,  // デフォルトをtrueに変更（options.jsと同期）
    highlightOptimize: true,
    historyEnabled: true,
    // MIP後にOKボタン自動クリック
    autoClickOkAfterMip: true,
    turboListingMode: false,
    showCopyCsvButtons: true
  },
  // 最適化状態の追跡
  optimizeState: {
    needsRetry: false,  // trueの時「再実行」表示
    lastOutputs: [],     // 過去の最適化出力を記憶（同一タイトル生成防止用、最大5件）
    isListable: true    // 出品NG（reasonsあり）の場合はfalse
  },
  // 最後にリクエストしたASIN（No listingsモーダル検出用）
  lastRequestedAsin: "",
  // ターボモードの実行済みフラグ
  turboExecuted: {
    optimizeCount: 0,  // 最適化実行回数（最大3回まで自動リトライ）
    mip: false
  },
  // エラーハンドリング（掃討モード用）
  errorHandling: {
    timestamp: 0,
    cleanerInterval: null
  },
  // サブスクリプション・ライセンス管理
  license: {
    plan: "free",    // "free", "pro", "premium" 等
    dailyLimit: 2,    // freeプランの1日の上限（タイトル最適化）
    usageCount: 0,
    lastUsedDate: "", // "YYYY-MM-DD" 形式
    proTrialStartDate: "" // "YYYY-MM-DD" 形式
  },
  yaballeEmail: null, // 現在Yaballeを操作している作業者のメールアドレス（店舗アドレス）
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
let observersInitialized = false;

// イベントリスナー管理用（メモリリーク防止）
let dropdownClickHandler = null;
let dropdownMousedownHandler = null;

// setInterval管理用（クリーンアップ用）
let okButtonCheckInterval = null;
let workTimeUpdateInterval = null;

// 履歴操作のロック（競合状況防止）
let historyLock = false;
