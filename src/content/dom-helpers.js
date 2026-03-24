/* ListerFlow Pro – DOM helpers
   ※ utils.js の normSpace(), readText() に依存
   ※ content.js より前に読み込まれること
*/

/* ---------- DOM helpers ---------- */

function findButtonByText(re) {
  const btns = Array.from(document.querySelectorAll("button, a"));
  return btns.find(b => re.test(normSpace(b.textContent || ""))) || null;
}

function findInputNearButton(btn) {
  if (!btn) return null;
  const root = btn.closest("form, .row, .col, .panel, .card, .container, .form-group") || btn.parentElement;
  if (!root) return null;
  const inputs = Array.from(root.querySelectorAll("input[type='text'], input:not([type]), textarea"));
  if (inputs.length === 1) return inputs[0];
  inputs.sort((a, b) => (a.value || "").length - (b.value || "").length);
  return inputs[0] || null;
}

function findAsinInputSmart(btnGet) {
  // すべての入力・テキストエリアを取得し、非表示（display:none）でないものをフィルタ
  const cands = Array.from(document.querySelectorAll("input, textarea"))
    .filter(el => {
      if (!el || el.disabled) return false;
      // offsetParent !== null は基本だが、一部のCSS構成でnullになる場合があるため
      // getComputedStyle によるチェックをフォールバックとして追加
      if (el.offsetParent !== null) return true;
      try {
        const style = window.getComputedStyle(el);
        return style.display !== 'none' && style.visibility !== 'hidden';
      } catch (e) {
        return false;
      }
    });

  const hit = cands.find(el => {
    const attrs = [
      el.getAttribute("placeholder") || "",
      el.getAttribute("aria-label") || "",
      el.name || "",
      el.id || "",
      el.getAttribute("data-testid") || ""
    ].join(" ");
    return /asin/i.test(attrs) || /amazon/i.test(attrs) || /ＡＳＩＮ/.test(attrs);
  });

  return hit || findInputNearButton(btnGet);
}

function findLabelInput(labelRe) {
  const labels = Array.from(document.querySelectorAll("label, span, div"));
  const lab = labels.find(el => labelRe.test(normSpace(el.textContent || "")));
  if (!lab) return null;

  const root = lab.closest(".form-group, .row, .col, .panel, .card, form, div") || lab.parentElement;
  if (!root) return null;

  const cands = Array.from(root.querySelectorAll("input[type='text'], input:not([type]), textarea, [contenteditable='true']"))
    .filter(x => x && x.offsetParent !== null && !x.disabled);

  const inp = cands.find(x => x.tagName === "INPUT" || x.tagName === "TEXTAREA") || cands[0] || null;
  return inp;
}

function findTitleFieldSmart(ignoreVisibility = false) {
  let el = findLabelInput(/^(Title|Item Title|タイトル|商品タイトル)$/i);
  if (el) return el;

  const cands = Array.from(document.querySelectorAll("input[type='text'], textarea, [contenteditable='true']"))
    .filter(x => x && (ignoreVisibility || x.offsetParent !== null) && !x.disabled);

  let best = null;
  let bestScore = -1;

  for (const x of cands) {
    const attrs = [
      x.getAttribute("placeholder") || "",
      x.getAttribute("aria-label") || "",
      x.getAttribute("name") || "",
      x.getAttribute("id") || "",
      x.getAttribute("ng-model") || "",
      x.getAttribute("data-testid") || ""
    ].join(" ");

    let score = 0;
    if (/title/i.test(attrs)) score += 6;
    if (/item\s*title/i.test(attrs)) score += 2;
    if (/タイトル/.test(attrs)) score += 7;
    if (x.tagName === "TEXTAREA") score += 1;

    const val = readText(x);
    if (val && val.length >= 10) score += 1;

    if (score > bestScore) { bestScore = score; best = x; }
  }

  if (best && bestScore >= 6) return best;

  el = document.querySelector("input[ng-model*='title'], textarea[ng-model*='title'], div[contenteditable='true'][ng-model*='title']");
  return el || null;
}

function readText(el) {
  if (!el) return "";
  if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") return el.value || "";
  return el.innerText || el.textContent || "";
}

function setNativeValue(el, v) {
  try {
    const value = v ?? "";
    const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, "value");
    const setter = desc && desc.set;
    if (setter) setter.call(el, value);
    else el.value = value;
  } catch (_) {
    try { el.value = v ?? ""; } catch (__) { }
  }
}

function setInputValue(el, value) {
  if (!el) return;
  const v = value ?? "";
  if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
    el.focus({ preventScroll: true });  // スクロールを防止
    setNativeValue(el, v);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.blur();
  } else if (el.getAttribute("contenteditable") === "true") {
    el.focus({ preventScroll: true });  // スクロールを防止
    document.execCommand("selectAll", false, null);
    document.execCommand("insertText", false, v);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.blur();
  }
}

function isInsideLfp(node) {
  const el = (node && node.nodeType === 1) ? node : (node && node.parentElement) ? node.parentElement : null;
  if (!el) return false;
  return !!el.closest("#lfp-root, #lfp-asinbar, #lfp-quick-mip, #lfp-status-box");
}

/* ---------- Insert below Title ---------- */

function insertBeforeVeroWarnings(statusBox) {
  // div.asin-actionsを直接探す（Get Itemボタンを含む親コンテナ）
  const asinActions = document.querySelector('div.asin-actions');

  if (!asinActions) {
    console.warn('[ListerFlow Pro] div.asin-actions not found, appending to body');
    document.body.appendChild(statusBox);
    return;
  }

  // asin-actionsの次の兄弟要素を取得
  const nextSibling = asinActions.nextElementSibling;

  if (nextSibling) {
    // asin-actionsの直後に挿入（Get Itemボタンのすぐ下）
    asinActions.parentElement.insertBefore(statusBox, nextSibling);
  } else {
    // 次の兄弟がない場合はasin-actionsの直後に追加
    asinActions.parentElement.appendChild(statusBox);
  }
}

function insertBelowTitle(titleEl, root) {
  const container =
    titleEl.closest(".form-group, .form-row, .row, .field, .form-item, .ng-scope, .col, .card, .panel") ||
    titleEl.closest("div") ||
    titleEl.parentElement;

  if (container && container.parentElement) {
    if (container.nextSibling) container.parentElement.insertBefore(root, container.nextSibling);
    else container.parentElement.appendChild(root);
    return;
  }
  titleEl.parentElement?.appendChild(root);
}
