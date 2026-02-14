const KEY_OPT = "lfp_options_v1";
const DEFAULTS = { apiKey: "", model: "gpt-4o-mini" };

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

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== "LFP_OPENAI") return;

  (async () => {
    const opt = await loadOpt();
    const apiKey = (opt.apiKey || "").trim();
    const model = (opt.model || "gpt-4o-mini").trim();

    if (!apiKey) return sendResponse({ ok:false, error:"API key未設定（拡張機能オプションで保存）" });
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
});
