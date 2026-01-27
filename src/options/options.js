const KEY_OPT = "lfp_options_v1";

const DEFAULTS = {
  apiKey: "",
  model: "gpt-4o-mini",
  veroEnabled: true,
  autoGetOnPaste: true,
  autoGetOnHistory: true,
  autoMipAfterOptimize: false,
  quickMipButton: true,
  highlightOptimize: true,
  historyEnabled: true,
  autoClickOkAfterMip: true
};

function qs(id){ return document.getElementById(id); }

function setStatus(msg, isErr=false){
  const el = qs("status");
  if (!el) return;
  el.textContent = msg || "";
  el.style.color = isErr ? "#b00020" : "#0a7a2f";
  if (msg) setTimeout(() => { el.textContent = ""; }, 2500);
}

async function load(){
  const data = await chrome.storage.sync.get([KEY_OPT]);
  const opt = { ...DEFAULTS, ...(data?.[KEY_OPT] || {}) };

  qs("apiKey").value = opt.apiKey || "";
  qs("model").value = opt.model || "gpt-4o-mini";

  qs("swPasteGet").checked = !!opt.autoGetOnPaste;
  qs("swHistGet").checked = !!opt.autoGetOnHistory;
  qs("swAutoMip").checked = !!opt.autoMipAfterOptimize;
  qs("swAutoOk").checked = !!opt.autoClickOkAfterMip;
  qs("swQuickMip").checked = !!opt.quickMipButton;
  qs("swHL").checked = !!opt.highlightOptimize;
  qs("swHistory").checked = !!opt.historyEnabled;
}

async function save(){
  const opt = {
    apiKey: (qs("apiKey").value || "").trim(),
    model: qs("model").value || "gpt-4o-mini",
    veroEnabled: true,
    autoGetOnPaste: qs("swPasteGet").checked,
    autoGetOnHistory: qs("swHistGet").checked,
    autoMipAfterOptimize: qs("swAutoMip").checked,
    autoClickOkAfterMip: qs("swAutoOk").checked,
    quickMipButton: qs("swQuickMip").checked,
    highlightOptimize: qs("swHL").checked,
    historyEnabled: qs("swHistory").checked
  };

  await chrome.storage.sync.set({ [KEY_OPT]: opt });
  setStatus("保存した");
}

function toggleKey(){
  const el = qs("apiKey");
  if (!el) return;
  el.type = el.type === "password" ? "text" : "password";
}

document.addEventListener("DOMContentLoaded", () => {
  qs("save")?.addEventListener("click", () => save().catch(e => setStatus(e?.message || "保存に失敗", true)));
  qs("toggleKey")?.addEventListener("click", toggleKey);

  load().catch(e => setStatus(e?.message || "読み込みに失敗", true));
});
