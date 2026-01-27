/**
 * utils.js
 * 汎用ユーティリティ関数
 */

/**
 * 指定ミリ秒待機
 */
export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 空白を正規化（連続する空白を1つにまとめる）
 */
export function normSpace(s) {
  return (s || "").replace(/\s+/g, " ").trim();
}

/**
 * 小文字に変換
 */
export function lc(s) {
  return (s || "").toLowerCase();
}

/**
 * 現在時刻（ミリ秒）
 */
export function now() {
  return Date.now();
}

/**
 * Listerルートかどうかをチェック
 */
export function isListerRoute() {
  const path = window.location.pathname || "";
  return path.includes("/lister") || path.includes("/listing");
}

/**
 * エクステンションコンテキストの有効性チェック
 */
export function isExtensionContextValid() {
  try {
    return !!(chrome && chrome.storage && chrome.storage.sync);
  } catch (e) {
    return false;
  }
}

/**
 * デバウンス関数
 */
export function debounce(fn, delay) {
  let timeoutId = null;
  return function(...args) {
    if (timeoutId) clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn.apply(this, args), delay);
  };
}

/**
 * 正規表現のエスケープ
 */
export function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * 配列から重複を削除
 */
export function unique(arr) {
  return Array.from(new Set(arr));
}

/**
 * オブジェクトのディープコピー
 */
export function deepCopy(obj) {
  return JSON.parse(JSON.stringify(obj));
}

/**
 * 日付のフォーマット（YYYY-MM-DD HH:mm:ss）
 */
export function formatDate(date) {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hours = String(d.getHours()).padStart(2, "0");
  const minutes = String(d.getMinutes()).padStart(2, "0");
  const seconds = String(d.getSeconds()).padStart(2, "0");
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

/**
 * 相対時間の計算（○分前、○時間前など）
 */
export function getRelativeTime(timestamp) {
  const now = Date.now();
  const diff = now - timestamp;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return "たった今";
  if (minutes < 60) return `${minutes}分前`;
  if (hours < 24) return `${hours}時間前`;
  return `${days}日前`;
}

/**
 * 統計情報の日次・週次リセット判定
 */
export function shouldResetStats(lastResetDate) {
  const now = Date.now();
  const lastReset = new Date(lastResetDate);
  const today = new Date(now);
  
  // 日付が変わったかチェック
  const dayChanged = lastReset.getDate() !== today.getDate() ||
                     lastReset.getMonth() !== today.getMonth() ||
                     lastReset.getFullYear() !== today.getFullYear();
  
  // 7日経過したかチェック
  const weekPassed = (now - lastResetDate) > (7 * 24 * 60 * 60 * 1000);
  
  return { dayChanged, weekPassed };
}
