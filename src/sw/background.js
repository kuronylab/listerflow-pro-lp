// background.js - ListerFlow Pro Centralized Counter Logic

const KEY_OPT = "lfp_options_v1";
const KEY_STATS = 'lfp_stats';
const DEFAULTS = { apiKey: "", model: "gpt-4o-mini" };

// 内部状態（メモリ保持）
let statsCache = null;
let timerInterval = null;

// 初期化
chrome.runtime.onStartup.addListener(initializeStats);
chrome.runtime.onInstalled.addListener(initializeStats);

async function initializeStats() {
  const data = await chrome.storage.local.get([KEY_STATS]);
  statsCache = data[KEY_STATS] || {
    totalListings: 0,
    todayListings: 0,
    weekListings: 0,
    lastListingDate: null,
    totalWorkTimeToday: 0,
    lastResetDate: Date.now(),
    isCounterPaused: true,
    currentSessionStartTime: null,
    currentSessionElapsedMs: 0,
    todayMaxSpeed: 0
  };
  
  // もし動作中ならタイマーを再開
  if (!statsCache.isCounterPaused) {
    startTimer();
  }
}

function startTimer() {
  if (timerInterval) return;
  timerInterval = setInterval(async () => {
    if (!statsCache || statsCache.isCounterPaused) {
      stopTimer();
      return;
    }
    
    const now = Date.now();
    // 2分放置チェック (120000ms)
    const lastAction = statsCache.lastAsinInputTime || statsCache.currentSessionStartTime || now;
    if (now - lastAction > 120000) {
      console.log("[LFP SW] 2分放置検知: 自動停止");
      await handleAutoStop(lastAction);
      return;
    }
    
    // 1秒ごとにストレージを更新（他タブへの同期用）
    // メモリ上の statsCache は常に最新
    await chrome.storage.local.set({ [KEY_STATS]: statsCache });
  }, 1000);
}

function stopTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
}

async function handleAutoStop(lastActionTime) {
  if (!statsCache) return;
  
  // 最後の操作時刻までの経過時間を計算して確定累計に加算
  const elapsedSinceStart = lastActionTime - statsCache.currentSessionStartTime;
  if (elapsedSinceStart > 0) {
    statsCache.totalWorkTimeToday = (statsCache.totalWorkTimeToday || 0) + elapsedSinceStart;
  }
  
  statsCache.isCounterPaused = true;
  statsCache.currentSessionStartTime = null;
  statsCache.currentSessionElapsedMs = 0;
  
  stopTimer();
  await chrome.storage.local.set({ [KEY_STATS]: statsCache });
  notifyTabs();
}

function notifyTabs() {
  chrome.tabs.query({}, (tabs) => {
    tabs.forEach(tab => {
      chrome.tabs.sendMessage(tab.id, { type: 'LFP_STATS_UPDATED' }).catch(() => {});
    });
  });
}

// OpenAI API 関連 (既存ロジックの維持)
async function loadOpt(){
  const data = await chrome.storage.sync.get([KEY_OPT]);
  return { ...DEFAULTS, ...(data?.[KEY_OPT] || {}) };
}

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
  if (!res.ok) {
    const txt = await res.text().catch(()=> "");
    throw new Error(`Responses APIエラー: ${res.status} ${res.statusText} ${txt}`.slice(0, 800));
  }
  const data = await res.json();
  const out = extractResponsesText(data);
  if (!out) throw new Error("Responses API: 出力が空");
  return out;
}

async function callChat({ apiKey, model, messages }){
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type":"application/json", "Authorization": `Bearer ${apiKey}` },
    body: JSON.stringify({ model, temperature: 0.2, messages })
  });
  if (!res.ok) {
    const txt = await res.text().catch(()=> "");
    throw new Error(`ChatCompletions APIエラー: ${res.status} ${res.statusText} ${txt}`.slice(0, 800));
  }
  const data = await res.json();
  const out = data?.choices?.[0]?.message?.content ?? "";
  if (!out) throw new Error("ChatCompletions API: 出力が空");
  return out;
}

// メッセージリスナー
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg) return;

  // OpenAI API
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
        return sendResponse({ ok:true, text: out });
      } catch (e1) {
        try {
          const out2 = await callChat({ apiKey, model, messages });
          return sendResponse({ ok:true, text: out2 });
        } catch (e2) {
          return sendResponse({ ok:false, error:(e2?.message || e1?.message || "OpenAI呼び出し失敗").slice(0, 600) });
        }
      }
    })().catch(e => sendResponse({ ok:false, error:(e?.message || "service worker error").slice(0, 600) }));
    return true;
  }

  // カウンター操作
  if (msg.type === "LFP_TOGGLE_TIMER") {
    (async () => {
      if (!statsCache) await initializeStats();
      const now = Date.now();
      
      if (statsCache.isCounterPaused) {
        // 再開
        statsCache.isCounterPaused = false;
        statsCache.currentSessionStartTime = now;
        statsCache.lastAsinInputTime = now;
        startTimer();
      } else {
        // 一時停止
        const elapsed = now - (statsCache.currentSessionStartTime || now);
        statsCache.totalWorkTimeToday = (statsCache.totalWorkTimeToday || 0) + elapsed;
        statsCache.isCounterPaused = true;
        statsCache.currentSessionStartTime = null;
        stopTimer();
      }
      await chrome.storage.local.set({ [KEY_STATS]: statsCache });
      notifyTabs();
      sendResponse({ ok: true, stats: statsCache });
    })();
    return true;
  }

  if (msg.type === "LFP_ASIN_INPUT") {
    (async () => {
      if (!statsCache) await initializeStats();
      const now = Date.now();
      statsCache.lastAsinInputTime = now;
      
      if (statsCache.isCounterPaused) {
        statsCache.isCounterPaused = false;
        statsCache.currentSessionStartTime = now;
        startTimer();
      }
      await chrome.storage.local.set({ [KEY_STATS]: statsCache });
      notifyTabs();
      sendResponse({ ok: true });
    })();
    return true;
  }

  if (msg.type === "LFP_CONFIRM_WORK") {
    (async () => {
      if (!statsCache) await initializeStats();
      const now = Date.now();
      
      if (!statsCache.isCounterPaused && statsCache.currentSessionStartTime) {
        const elapsed = now - statsCache.currentSessionStartTime;
        statsCache.totalWorkTimeToday = (statsCache.totalWorkTimeToday || 0) + elapsed;
        statsCache.currentSessionStartTime = now; // セッション継続
      }
      
      await chrome.storage.local.set({ [KEY_STATS]: statsCache });
      notifyTabs();
      sendResponse({ ok: true });
    })();
    return true;
  }
  
  if (msg.type === "LFP_STATS_UPDATED") {
    // ポップアップ等でリセットされた場合、キャッシュを再読み込み
    initializeStats();
    return false;
  }
});
