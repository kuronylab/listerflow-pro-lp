const KEY_OPT = "lfp_options_v1";
const KEY_STATS = "lfp_stats_v1";
const KEY_HIST = "lfp_asin_history_v1";
const DEFAULTS = { apiKey: "", model: "gpt-4o-mini" };

// タイマー管理用の変数
let timerInterval = null;

async function loadOpt() {
  const data = await chrome.storage.sync.get([KEY_OPT]);
  return { ...DEFAULTS, ...(data?.[KEY_OPT] || {}) };
}

async function loadStats() {
  const data = await chrome.storage.local.get([KEY_STATS]);
  const stats = data[KEY_STATS] || {};
  return {
    totalWorkTimeToday: stats.totalWorkTimeToday || 0,
    isCounterPaused: stats.isCounterPaused !== undefined ? stats.isCounterPaused : true,
    todayListings: stats.todayListings || 0,
    weekListings: stats.weekListings || 0,
    totalListings: stats.totalListings || 0,
    todayMaxSpeed: stats.todayMaxSpeed || 0,
    lastAsinInputTime: stats.lastAsinInputTime || null,
    lastListingDate: stats.lastListingDate || null,
    lastActiveDate: stats.lastActiveDate || null
  };
}

async function saveStats(stats) {
  await chrome.storage.local.set({ [KEY_STATS]: stats });
}

/**
 * 日付取得ヘルパー（YYYY-MM-DD形式、日本時間）
 */
function getTodayDateString() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * ISO週番号を取得（月曜始まり）
 */
function getISOWeekNumber(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

/**
 * 日付変更を検出し、必要に応じて日次・週次データをリセットする
 * @param {Object} stats - 統計オブジェクト
 * @returns {boolean} リセットが行われた場合はtrue
 */
async function checkAndResetForNewDay(stats) {
  const today = getTodayDateString();

  // lastActiveDateが未設定の場合（既存データの移行時）
  // lastListingDateから前回の日付を推定する
  if (!stats.lastActiveDate) {
    if (stats.lastListingDate) {
      const lastDate = new Date(stats.lastListingDate);
      const y = lastDate.getFullYear();
      const m = String(lastDate.getMonth() + 1).padStart(2, '0');
      const d = String(lastDate.getDate()).padStart(2, '0');
      stats.lastActiveDate = `${y}-${m}-${d}`;
      console.log(`[LFP-SW] lastActiveDate未設定。lastListingDateから推定: ${stats.lastActiveDate}`);
    } else {
      // 前回の日付が全く不明な場合、今日をセットして日次データをリセット
      console.log(`[LFP-SW] 初回起動。日次データをリセットします。`);
      stats.todayListings = 0;
      stats.totalWorkTimeToday = 0;
      stats.todayMaxSpeed = 0;
      stats.lastAsinInputTime = null;
      stats.isCounterPaused = true;
      stats.lastActiveDate = today;
      await saveStats(stats);
      stopTimer();
      return true;
    }
  }

  // 日付が変わっていなければ何もしない
  if (stats.lastActiveDate === today) {
    return false;
  }

  console.log(`[LFP-SW] 日付変更を検出: ${stats.lastActiveDate} → ${today}`);

  // 前回の日付と今回の日付で週番号を比較
  const prevDate = new Date(stats.lastActiveDate + 'T00:00:00');
  const nowDate = new Date(today + 'T00:00:00');
  const prevWeek = getISOWeekNumber(prevDate);
  const nowWeek = getISOWeekNumber(nowDate);
  const prevYear = prevDate.getFullYear();
  const nowYear = nowDate.getFullYear();

  // 日次データをリセット
  stats.todayListings = 0;
  stats.totalWorkTimeToday = 0;
  stats.todayMaxSpeed = 0;
  stats.lastAsinInputTime = null;
  stats.isCounterPaused = true;

  // 週が変わった場合は週次データもリセット
  if (prevWeek !== nowWeek || prevYear !== nowYear) {
    console.log(`[LFP-SW] 週変更を検出: W${prevWeek} → W${nowWeek}`);
    stats.weekListings = 0;
  }

  // 日付を更新
  stats.lastActiveDate = today;
  await saveStats(stats);

  // タイマーを停止
  stopTimer();

  return true;
}

// タイマーの更新処理（ストップウォッチ方式）
async function updateTimer() {
  const stats = await loadStats();

  if (stats.isCounterPaused) {
    stopTimer();
    return;
  }

  const now = Date.now();

  // 放置チェック（案B: 135秒間何も作業がなければ停止）
  if (stats.lastAsinInputTime && (now - stats.lastAsinInputTime > 135000)) {
    const elapsedSinceInput = now - stats.lastAsinInputTime;
    // 戻し量 = 経過時間 - 15秒 (＝入力+15秒の地点まで戻る)
    const rewindMs = elapsedSinceInput - 15000;

    console.log(`[LFP-SW] 135秒放置を検知。タイマーを停止し、${Math.floor(rewindMs / 1000)}秒差し引きます。`);
    stats.totalWorkTimeToday = Math.max(0, stats.totalWorkTimeToday - rewindMs);
    stats.isCounterPaused = true;
    await saveStats(stats);
    stopTimer();
    broadcastSync();
    return;
  }

  // 1秒加算
  stats.totalWorkTimeToday += 1000;
  await saveStats(stats);
  broadcastSync();
}

function broadcastSync() {
  chrome.tabs.query({}, (tabs) => {
    tabs.forEach(tab => {
      chrome.tabs.sendMessage(tab.id, { type: "LFP_SYNC_UI" }).catch(() => { });
    });
  });
}

function startTimer() {
  if (timerInterval) return;
  timerInterval = setInterval(updateTimer, 1000);
  console.log("[LFP-SW] タイマー開始");
}

function stopTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
    console.log("[LFP-SW] タイマー停止");
  }
}

// メッセージリスナー
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg) return;

  // OpenAI呼び出し
  if (msg.type === "LFP_OPENAI") {
    (async () => {
      const opt = await loadOpt();
      const apiKey = (opt.apiKey || "").trim();
      const model = (opt.model || "gpt-4o-mini").trim();
      if (!apiKey) return sendResponse({ ok: false, error: "API key未設定" });
      const messages = Array.isArray(msg.messages) ? msg.messages : null;
      if (!messages) return sendResponse({ ok: false, error: "messagesが不正" });
      try {
        const out = await callResponses({ apiKey, model, messages });
        sendResponse({ ok: true, text: out });
      } catch (e1) {
        try {
          const out2 = await callChat({ apiKey, model, messages });
          sendResponse({ ok: true, text: out2 });
        } catch (e2) {
          sendResponse({ ok: false, error: (e2?.message || e1?.message || "OpenAI呼び出し失敗") });
        }
      }
    })();
    return true;
  }

  // タイマー制御
  if (msg.type === "LFP_TIMER_CONTROL") {
    (async () => {
      try {
        const stats = await loadStats();
        await checkAndResetForNewDay(stats);
        if (msg.action === "start") {
          stats.isCounterPaused = false;
          stats.lastAsinInputTime = Date.now();
          await saveStats(stats);
          startTimer();
        } else if (msg.action === "stop") {
          stats.isCounterPaused = true;
          await saveStats(stats);
          stopTimer();
        }
        broadcastSync();
        sendResponse({ ok: true });
      } catch (err) {
        console.error("[LFP-SW] TIMER_CONTROL error:", err);
        sendResponse({ ok: false, error: err.message });
      }
    })();
    return true;
  }

  // 統計更新（出品完了時）
  if (msg.type === "LFP_UPDATE_STATS") {
    (async () => {
      try {
        const stats = await loadStats();
        await checkAndResetForNewDay(stats);
        stats.todayListings = (stats.todayListings || 0) + 1;
        stats.weekListings = (stats.weekListings || 0) + 1;
        stats.totalListings = (stats.totalListings || 0) + 1;
        stats.lastListingDate = Date.now();

        // 速度計算（簡易版）
        const hours = stats.totalWorkTimeToday / 3600000;
        if (hours > 0.01) {
          const speed = Math.round(stats.todayListings / hours);
          if (speed > stats.todayMaxSpeed) stats.todayMaxSpeed = speed;
        }

        await saveStats(stats);
        broadcastSync();
        sendResponse({ ok: true });
      } catch (err) {
        console.error("[LFP-SW] UPDATE_STATS error:", err);
        sendResponse({ ok: false, error: err.message });
      }
    })();
    return true;
  }

  // ASIN入力時刻の更新
  if (msg.type === "LFP_UPDATE_INPUT_TIME") {
    (async () => {
      try {
        const stats = await loadStats();
        await checkAndResetForNewDay(stats);
        stats.lastAsinInputTime = Date.now();
        // もし停止中なら自動開始
        if (stats.isCounterPaused) {
          stats.isCounterPaused = false;
          startTimer();
        }
        await saveStats(stats);
        broadcastSync();
        sendResponse({ ok: true });
      } catch (err) {
        console.error("[LFP-SW] UPDATE_INPUT_TIME error:", err);
        sendResponse({ ok: false, error: err.message });
      }
    })();
    return true;
  }

  // 同期リクエスト
  if (msg.type === "LFP_SYNC_REQUEST") {
    broadcastSync();
    sendResponse({ ok: true });
    return false;
  }

  // ハートビート（生存確認）
  if (msg.type === "LFP_HEARTBEAT") {
    sendResponse({ ok: true, status: "alive" });
    return false;
  }

  // 統計情報取得
  if (msg.type === "LFP_GET_STATS") {
    (async () => {
      try {
        const stats = await loadStats();
        await checkAndResetForNewDay(stats);
        sendResponse(stats);
      } catch (err) {
        console.error("[LFP-SW] GET_STATS error:", err);
        // エラー時でも空オブジェクトまたはデフォルト値を返してチャネル断絶を防ぐ
        sendResponse({});
      }
    })();
    return true;
  }

  // 統計リセット（ポップアップからの明示的なリセット）
  // 修正：履歴以外の全ての統計データをリセットする
  if (msg.type === "RESET_STATS") {
    (async () => {
      try {
        const stats = await loadStats();
        stats.totalWorkTimeToday = 0;
        stats.isCounterPaused = true;
        stats.todayListings = 0;
        stats.weekListings = 0;
        stats.totalListings = 0;
        stats.todayMaxSpeed = 0;
        stats.lastAsinInputTime = null;
        stats.lastListingDate = null;

        await saveStats(stats);
        stopTimer();
        broadcastSync();
        sendResponse({ ok: true });
      } catch (err) {
        console.error("[LFP-SW] RESET_STATS error:", err);
        sendResponse({ ok: false, error: err.message });
      }
    })();
    return true;
  }

  // 履歴クリア
  if (msg.type === "CLEAR_HISTORY") {
    (async () => {
      try {
        await chrome.storage.local.set({ [KEY_HIST]: [] });
        broadcastSync();
        sendResponse({ ok: true });
      } catch (err) {
        console.error("[LFP-SW] CLEAR_HISTORY error:", err);
        sendResponse({ ok: false, error: err.message });
      }
    })();
    return true;
  }
});

// 起動時にタイマー状態を復元＆日付チェック
loadStats().then(async (stats) => {
  // 日付変更を検出してリセット
  const wasReset = await checkAndResetForNewDay(stats);
  if (wasReset) {
    console.log('[LFP-SW] 起動時に日付変更によるリセットを実行しました');
    broadcastSync();
  }
  // リセットされていない場合のみタイマーを復元
  if (!stats.isCounterPaused) {
    startTimer();
  }
});

// OpenAI API呼び出し用の既存関数
function extractResponsesText(data) {
  if (typeof data?.output_text === "string" && data.output_text.trim()) return data.output_text;
  const out = data?.output;
  if (!Array.isArray(out)) return "";
  let s = "";
  for (const item of out) {
    if (item?.type === "message" && item?.role === "assistant" && Array.isArray(item?.content)) {
      for (const c of item.content) {
        if (c?.type === "output_text" && typeof c?.text === "string") s += c.text;
      }
    }
  }
  return s;
}

async function callResponses({ apiKey, model, messages }) {
  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
    body: JSON.stringify({ model, input: messages, temperature: 0.2, store: false })
  });
  if (!res.ok) throw new Error(`Responses APIエラー: ${res.status}`);
  const data = await res.json();
  return extractResponsesText(data);
}

async function callChat({ apiKey, model, messages }) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
    body: JSON.stringify({ model, temperature: 0.2, messages })
  });
  if (!res.ok) throw new Error(`ChatCompletions APIエラー: ${res.status}`);
  const data = await res.json();
  return data?.choices?.[0]?.message?.content ?? "";
}
