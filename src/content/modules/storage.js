/**
 * storage.js
 * ストレージ操作（オプション、履歴、統計）
 */

import { STORAGE_KEYS, DEFAULT_OPTIONS, HISTORY } from './constants.js';
import { shouldResetStats } from './utils.js';

/**
 * オプションの読み込み
 */
export async function loadOptions() {
  try {
    const data = await chrome.storage.sync.get([STORAGE_KEYS.OPTIONS]);
    const saved = data?.[STORAGE_KEYS.OPTIONS];
    return { ...DEFAULT_OPTIONS, ...(saved || {}) };
  } catch (err) {
    console.error("[LFP] loadOptions error:", err);
    return { ...DEFAULT_OPTIONS };
  }
}

/**
 * オプションの保存
 */
export async function saveOptions(options) {
  try {
    await chrome.storage.sync.set({ [STORAGE_KEYS.OPTIONS]: options });
    return true;
  } catch (err) {
    console.error("[LFP] saveOptions error:", err);
    return false;
  }
}

/**
 * 統計情報の読み込み
 */
export async function loadStatistics() {
  try {
    const data = await chrome.storage.local.get([STORAGE_KEYS.STATISTICS]);
    let stats = data?.[STORAGE_KEYS.STATISTICS];

    if (!stats || typeof stats !== 'object') {
      stats = {
        totalListings: 0,
        todayListings: 0,
        weekListings: 0,
        lastListingDate: null,
        optimizeCount: 0,
        lastResetDate: Date.now()
      };
    }

    // 日次・週次リセット判定
    const { dayChanged, weekPassed } = shouldResetStats(stats.lastResetDate);
    
    if (dayChanged) {
      stats.todayListings = 0;
    }
    
    if (weekPassed) {
      stats.weekListings = 0;
    }
    
    if (dayChanged || weekPassed) {
      stats.lastResetDate = Date.now();
      await saveStatistics(stats);
    }

    return stats;
  } catch (err) {
    console.error("[LFP] loadStatistics error:", err);
    return {
      totalListings: 0,
      todayListings: 0,
      weekListings: 0,
      lastListingDate: null,
      optimizeCount: 0,
      lastResetDate: Date.now()
    };
  }
}

/**
 * 統計情報の保存
 */
export async function saveStatistics(stats) {
  try {
    await chrome.storage.local.set({ [STORAGE_KEYS.STATISTICS]: stats });
    return true;
  } catch (err) {
    console.error("[LFP] saveStatistics error:", err);
    return false;
  }
}

/**
 * 出品数のインクリメント
 */
export async function incrementListingCount() {
  try {
    const stats = await loadStatistics();
    stats.totalListings += 1;
    stats.todayListings += 1;
    stats.weekListings += 1;
    stats.lastListingDate = Date.now();
    await saveStatistics(stats);
    console.log(`[LFP] 出品数をカウント: 本日=${stats.todayListings}, 今週=${stats.weekListings}, 累計=${stats.totalListings}`);
    return true;
  } catch (err) {
    console.error("[LFP] incrementListingCount error:", err);
    return false;
  }
}

/**
 * 最適化回数のインクリメント
 */
export async function incrementOptimizeCount() {
  try {
    const stats = await loadStatistics();
    stats.optimizeCount += 1;
    await saveStatistics(stats);
    console.log(`[LFP] 最適化回数をカウント: ${stats.optimizeCount}`);
    return true;
  } catch (err) {
    console.error("[LFP] incrementOptimizeCount error:", err);
    return false;
  }
}

/**
 * ASIN履歴の読み込み
 */
export async function loadHistory() {
  try {
    const data = await chrome.storage.local.get([STORAGE_KEYS.HISTORY]);
    let list = Array.isArray(data?.[STORAGE_KEYS.HISTORY]) ? data[STORAGE_KEYS.HISTORY] : [];
    return list;
  } catch (err) {
    console.error("[LFP] loadHistory error:", err);
    return [];
  }
}

/**
 * ASIN履歴の保存
 */
export async function saveHistory(history) {
  try {
    await chrome.storage.local.set({ [STORAGE_KEYS.HISTORY]: history });
    return true;
  } catch (err) {
    console.error("[LFP] saveHistory error:", err);
    return false;
  }
}

/**
 * ASIN履歴に追加
 */
export async function addToHistory(asin, flags = {}) {
  try {
    const history = await loadHistory();
    
    // 既存のエントリを削除
    const filtered = history.filter(h => h.asin !== asin);
    
    // 新しいエントリを先頭に追加
    filtered.unshift({
      asin,
      flags,
      timestamp: Date.now()
    });
    
    // 最大件数を超えた場合は古いものを削除
    if (filtered.length > HISTORY.MAX_COUNT) {
      filtered.splice(HISTORY.MAX_COUNT);
    }
    
    await saveHistory(filtered);
    console.log(`[LFP] ASIN履歴に追加: ${asin}`, flags);
    return true;
  } catch (err) {
    console.error("[LFP] addToHistory error:", err);
    return false;
  }
}

/**
 * ASIN履歴のフラグを更新
 */
export async function updateHistoryFlags(asin, flags) {
  try {
    const history = await loadHistory();
    const entry = history.find(h => h.asin === asin);
    
    if (entry) {
      entry.flags = { ...entry.flags, ...flags };
      entry.timestamp = Date.now();
      await saveHistory(history);
      console.log(`[LFP] ASIN履歴のフラグを更新: ${asin}`, flags);
    } else {
      // エントリが存在しない場合は新規追加
      await addToHistory(asin, flags);
    }
    
    return true;
  } catch (err) {
    console.error("[LFP] updateHistoryFlags error:", err);
    return false;
  }
}

/**
 * ASIN履歴のリセット
 */
export async function resetHistory() {
  try {
    await chrome.storage.local.remove([STORAGE_KEYS.HISTORY]);
    console.log("[LFP] ASIN履歴をリセット");
    return true;
  } catch (err) {
    console.error("[LFP] resetHistory error:", err);
    return false;
  }
}
