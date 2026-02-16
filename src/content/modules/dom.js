/**
 * dom.js
 * DOM操作関連の関数
 */

import { normSpace } from './utils.js';

/**
 * テキストで要素を検索（ボタンやリンク）
 */
export function findButtonByText(re) {
  const btns = Array.from(document.querySelectorAll("button, a"));
  return btns.find(b => re.test(normSpace(b.textContent || ""))) || null;
}

/**
 * ボタンの近くにある入力欄を検索
 */
export function findInputNearButton(btn) {
  if (!btn) return null;
  const root = btn.closest("form, .row, .col, .panel, .card, .container, .form-group") || btn.parentElement;
  if (!root) return null;
  const inputs = Array.from(root.querySelectorAll("input[type='text'], input:not([type]), textarea"));
  if (inputs.length === 1) return inputs[0];
  inputs.sort((a, b) => (a.value || "").length - (b.value || "").length);
  return inputs[0] || null;
}

/**
 * ASIN入力欄をスマート検索
 */
export function findAsinInputSmart(btnGet) {
  const cands = Array.from(document.querySelectorAll("input, textarea"))
    .filter(el => el && el.offsetParent !== null && !el.disabled);

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

/**
 * ラベルから入力欄を検索
 */
export function findLabelInput(labelRe) {
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

/**
 * タイトル入力欄をスマート検索
 */
export function findTitleFieldSmart() {
  let el = findLabelInput(/^(Title|Item Title|タイトル|商品タイトル)$/i);
  if (el) return el;

  const cands = Array.from(document.querySelectorAll("input[type='text'], textarea, [contenteditable='true']"))
    .filter(x => x && x.offsetParent !== null && !x.disabled);

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

/**
 * 要素からテキストを読み取る
 */
export function readText(el) {
  if (!el) return "";
  if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") return el.value || "";
  return el.innerText || el.textContent || "";
}

/**
 * ネイティブのvalueセッターを使用して値を設定
 */
export function setNativeValue(el, v) {
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

/**
 * 入力欄に値を設定（イベント発火付き）
 */
export function setInputValue(el, value) {
  if (!el) return;
  const v = value ?? "";
  if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
    el.focus({ preventScroll: true });
    setNativeValue(el, v);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.blur();
  } else if (el.getAttribute("contenteditable") === "true") {
    el.focus({ preventScroll: true });
    document.execCommand("selectAll", false, null);
    document.execCommand("insertText", false, v);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.blur();
  }
}

/**
 * 要素が拡張機能のUI内にあるかチェック
 */
export function isInsideLfp(node) {
  if (!node || !node.parentElement) return false;
  let p = node;
  while (p) {
    if (p.id === "lfp-ui-root" || (p.classList && p.classList.contains("lfp-ui-root"))) return true;
    p = p.parentElement;
  }
  return false;
}

/**
 * VeRO Warningsテキストブロックを抽出
 */
export function extractWarningBlockText() {
  const all = document.body.innerText || "";
  const m = all.match(/Vero Warnings:[\s\S]*?(?=\n\n|\n[A-Z]|$)/i);
  return m ? m[0] : "";
}

/**
 * Protectedテキストを抽出
 */
export function extractProtectedText() {
  const all = document.body.innerText || "";
  const lines = all.split("\n").map(x => x.trim());
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/protected/i.test(line)) {
      const context = lines.slice(Math.max(0, i - 2), i + 3).join(" ");
      if (/item|product|listing|cannot|restricted|prohibited/i.test(context)) {
        return line;
      }
    }
  }
  
  const m = all.match(/protected[\s\S]{0,100}/i);
  return m ? m[0] : "";
}

/**
 * 重複エラーを抽出
 */
export function extractDuplicationError() {
  const all = document.body.innerText || "";
  const m = all.match(/already\s+listed|duplicate|重複/i);
  return m ? m[0] : "";
}

/**
 * 実際のMIPボタンを検索
 */
export function findRealMipButton() {
  const btns = Array.from(document.querySelectorAll("button, a"));
  return btns.find(b => {
    const text = normSpace(b.textContent || "");
    return /list\s+item\s+using\s+mip/i.test(text) || /move\s+it\s+to\s+production/i.test(text);
  }) || null;
}
