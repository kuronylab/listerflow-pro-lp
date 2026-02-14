const KEY_OPT = "lfp_options_v1";
const KEY_STATS = "lfp_stats_v1";
const KEY_HIST = "lfp_history_v1";
const DEFAULTS = { apiKey: "", model: "gpt-4o-mini" };

// タイマー管理用の変数
let timerInterval = null;

async function loadOpt(){
  const data = await chrome.storage.sync.get([KEY_OPT]);
  return { ...DEFAULTS, ...(data?.[KEY_OPT] || {}) };
}

async function loadStats() {
  const data = await chrome.storage.local.get([KEY_STATS]);
  return data[KEY_STATS] || {
    totalWorkTimeToday: 0,
    isCounterPaused: true,
    todayListings: 0,
    todayMaxSpeed: 0,
    lastAsinInputTime: null
  };
}

async function saveStats(stats) {
  await chrome.storage.local.set({ [KEY_STATS]: stats });
}

// タイマーの更新処理（ストップウォッチ方式）
async function updateTimer() {
  const stats = await loadStats();
  
  // 停止状態ならタイマーを止める
  if (stats.isCounterPaused) {
    stopTimer();
    return;
  }

  const now = Date.now();
  
  // 2分放置チェック
  if (stats.lastAsinInputTime && (now - stats.lastAsinInputTime > 120000)) {
    console.log("[LFP-SW] 2分放置を検知。タイマーを停止し、120秒差し引きます。");
    
    // 120秒（2分）を差し引いて停止
    stats.totalWorkTimeToday = Math.max(0, (stats.totalWorkTimeToday || 0) - 120000);
    stats.isCounterPaused = true;
    
    await saveStats(stats);
    stopTimer();
    
    // 全画面に通知
    broadcastSync();
    return;
  }

  // 1秒加算（1000ms）
  stats.totalWorkTimeToday = (stats.totalWorkTimeToday || 0) + 1000;
  await saveStats(stats);
  
  // 全画面に通知（リアルタイム更新用）
  broadcastSync();
}

function broadcastSync() {
  chrome.tabs.query({}, (tabs) => {
    tabs.forEach(tab => {
      chrome.tabs.sendMessage(tab.id, { type: "LFP_SYNC_UI" }).catch(() => {});
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

      if (!apiKey) return sendResponse({ ok:false, error:"API key未設定" });
      const messages = Array.isArray(msg.messages) ? msg.messages : null;
      if (!messages) return sendResponse({ ok:false, error:"messagesが不正" });

      try {
        const out = await callResponses({ apiKey, model, messages });
        sendResponse({ ok:true, text: out });
      } catch (e1) {
        try {
          const out2 = await callChat({ apiKey, model, messages });
          sendResponse({ ok:true, text: out2 });
        } catch (e2) {
          sendResponse({ ok:false, error:(e2?.message || e1?.message || "OpenAI呼び出し失敗") });
        }
      }
    })();
    return true;
  }

  // タイマー制御
  if (msg.type === "LFP_TIMER_CONTROL") {
    if (msg.action === "start") {
      startTimer();
    } else if (msg.action === "stop") {
      stopTimer();
    }
    sendResponse({ ok: true });
    return false;
  }

  // 同期リクエスト
  if (msg.type === "LFP_SYNC_REQUEST") {
    broadcastSync();
    sendResponse({ ok: true });
    return false;
  }

  // 統計リセット
  if (msg.type === "RESET_STATS") {
    (async () => {
      const stats = {
        totalWorkTimeToday: 0,
        isCounterPaused: true,
        todayListings: 0,
        todayMaxSpeed: 0,
        lastAsinInputTime: null
      };
      await saveStats(stats);
      stopTimer();
      broadcastSync();
      sendResponse({ ok: true });
    })();
    return true;
  }

  // 履歴クリア
  if (msg.type === "CLEAR_HISTORY") {
    (async () => {
      await chrome.storage.local.set({ [KEY_HIST]: [] });
      broadcastSync();
      sendResponse({ ok: true });
    })();
    return true;
  }
});

// 起動時にタイマー状態を復元
loadStats().then(stats => {
  if (!stats.isCounterPaused) {
    startTimer();
  }
});

// 以下、OpenAI API呼び出し用の既存関数
function extractResponsesText(data){
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

async function callResponses({ apiKey, model, messages }){
  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "Content-Type":"application/json", "Authorization": `Bearer ${apiKey}` },
    body: JSON.stringify({ model, input: messages, temperature: 0.2, store: false })
  });
  if (!res.ok) throw new Error(`Responses APIエラー: ${res.status}`);
  const data = await res.json();
  return extractResponsesText(data);
}

async function callChat({ apiKey, model, messages }){
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type":"application/json", "Authorization": `Bearer ${apiKey}` },
    body: JSON.stringify({ model, temperature: 0.2, messages })
  });
  if (!res.ok) throw new Error(`ChatCompletions APIエラー: ${res.status}`);
  const data = await res.json();
  return data?.choices?.[0]?.message?.content ?? "";
}
