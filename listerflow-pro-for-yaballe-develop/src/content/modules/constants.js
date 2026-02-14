/**
 * constants.js
 * 定数・設定値の一元管理
 */

// ストレージキー
export const STORAGE_KEYS = {
  OPTIONS: "lfp_options_v1",
  HISTORY: "lfp_asin_history_v1",
  STATISTICS: "lfp_statistics_v1"
};

// デフォルトオプション
export const DEFAULT_OPTIONS = {
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
  turboListingMode: false
};

// タイトル文字数の制約
export const TITLE_LENGTH = {
  MIN: 70,
  MAX: 80,
  TARGET: 78,
  TARGET_SHORT: 75
};

// 履歴管理
export const HISTORY = {
  MAX_COUNT: 100
};

// リトライ設定
export const RETRY = {
  MAX_ATTEMPTS: 3,
  DELAY_MS: 500
};

// デバウンス設定
export const DEBOUNCE = {
  EVALUATE_MS: 300,
  OBSERVER_MS: 200
};

// タイムアウト設定
export const TIMEOUT = {
  OK_BUTTON_CHECK_MS: 100,
  OK_BUTTON_MAX_WAIT_MS: 5000
};

// 互換性表現（Yaballe公式ルール）
export const COMPATIBILITY_PHRASES = [
  "for",
  "compatible with",
  "fits"
];

// アダルト商品キーワード
export const ADULT_KEYWORDS = [
  "dildo",
  "vibrator",
  "sex toy",
  "adult toy",
  "masturbat",
  "bdsm",
  "anal",
  "butt plug",
  "penis",
  "vagina",
  "clitoris",
  "fetish",
  "vibrating",
  "love toy"
];

// 短縮辞書（タイトル最適化用）
export const ABBREVIATIONS = {
  "with": "w/",
  "inches": "in",
  "inch": "in",
  "pounds": "lb",
  "lbs": "lb",
  "ounces": "oz",
  "ounce": "oz",
  "millimeters": "mm",
  "millimeter": "mm",
  "centimeters": "cm",
  "centimeter": "cm",
  "set of": "set",
  "pack of": "pack"
};

// UI要素のID・クラス
export const UI_IDS = {
  ROOT: "lfp-ui-root",
  STATUS: "lfp-status",
  BADGE: "lfp-badge",
  BTN_OPTIMIZE: "lfp-btn-optimize",
  BTN_LABEL: "lfp-btn-label",
  SPINNER: "lfp-spinner",
  ASIN_BAR: "lfp-asin-bar",
  HISTORY_SELECT: "lfp-hist-sel",
  QUICK_MIP_BTN: "lfp-quick-mip"
};

// CSS クラス
export const CSS_CLASSES = {
  UI_ROOT: "lfp-ui-root",
  STATUS_LINE: "lfp-status-line",
  BADGE: "lfp-badge",
  BTN_OPTIMIZE: "lfp-btn-optimize",
  BTN_HIGHLIGHT: "lfp-btn-highlight",
  SPINNER: "lfp-spinner",
  QUICK_MIP: "lfp-quick-mip-btn"
};
