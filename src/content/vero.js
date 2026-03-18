/* ListerFlow Pro – Vero / protected / brand / adult 検出、タイトル短縮
   ※ utils.js の normSpace(), lc() に依存
   ※ content.js の UI オブジェクトを参照（extractProtectedText, extractDuplicationError）
*/

/* ---------- Vero / protected / brand / adult ---------- */

function extractWarningBlockText() {
  const nodes = Array.from(document.querySelectorAll("div, pre, span, p"))
    .filter(n => (n.textContent || "").includes("Vero Warnings:"));
  if (nodes.length) {
    nodes.sort((a, b) => (b.textContent || "").length - (a.textContent || "").length);
    return nodes[0].textContent || "";
  }
  const all = document.body?.innerText || "";
  const idx = all.indexOf("Vero Warnings:");
  if (idx >= 0) return all.slice(idx, idx + 800);
  return "";
}

function extractProtectedText() {
  let all = document.body?.innerText || "";

  try {
    // 自前UIの文言が残っていると自己検出してしまうので除外
    const uiTexts = [];
    if (typeof UI !== "undefined") {
      if (UI?.root?.isConnected) uiTexts.push(UI.root.innerText || "");
      if (UI?.asinBar?.isConnected) uiTexts.push(UI.asinBar.innerText || "");
      if (UI?.quickMipBtn?.isConnected) uiTexts.push(UI.quickMipBtn.innerText || "");
    }
    for (const t of uiTexts) {
      if (t && t.length) all = all.split(t).join(" ");
    }

    // 文字列ベースでも除外（揺れ対策）
    all = all.replace(/×出品不可：[^\n]+/g, " ");
    all = all.replace(/出品：NG\([^\)]+\)/g, " ");
    all = all.replace(/NG\([^\)]+\)/g, " ");
    all = all.replace(/\blfp\b/ig, " ");
  } catch (_) {
  }

  if (/protected mode/i.test(all) || /\bprotected\b/i.test(all)) {
    const m = all.match(/.{0,40}protected.{0,200}/i);
    return m ? m[0] : "protected";
  }
  return "";
}

function extractDuplicationError() {
  let all = document.body?.innerText || "";

  try {
    // 自前UIの文言が残っていると自己検出してしまうので除外
    const uiTexts = [];
    if (typeof UI !== "undefined") {
      if (UI?.root?.isConnected) uiTexts.push(UI.root.innerText || "");
      if (UI?.asinBar?.isConnected) uiTexts.push(UI.asinBar.innerText || "");
      if (UI?.quickMipBtn?.isConnected) uiTexts.push(UI.quickMipBtn.innerText || "");
    }
    for (const t of uiTexts) {
      if (t && t.length) all = all.split(t).join(" ");
    }

    // 文字列ベースでも除外（揺れ対策）
    all = all.replace(/×出品不可：[^\n]+/g, " ");
    all = all.replace(/出品：NG\([^\)]+\)/g, " ");
    all = all.replace(/NG\([^\)]+\)/g, " ");
    all = all.replace(/\blfp\b/ig, " ");
  } catch (_) {
  }

  if (/SourceID already monitored/i.test(all) || /Duplications are not possible/i.test(all)) {
    const m = all.match(/.{0,40}(SourceID already monitored|Duplications are not possible).{0,200}/i);
    return m ? m[0] : "SourceID already monitored";
  }
  return "";
}

function parseVeroTerms(blockText) {
  const text = blockText || "";
  const lines = text.split("\n").map(x => x.trim()).filter(Boolean);
  const terms = [];
  for (const line of lines) {
    const m = line.match(/^(title|brand)\s*:\s*(.+)$/i);
    if (m) {
      const kind = lc(m[1]);
      const value = normSpace(m[2]);
      if (value) {
        if (kind === "title") {
          // titleの場合のみ、空白で分割して個別の単語として扱う（例: original nes -> ["original", "nes"]）
          const words = value.split(/\s+/).filter(Boolean);
          for (const word of words) {
            terms.push({ kind, term: word });
          }
        } else {
          terms.push({ kind, term: value });
        }
      }
    }
  }
  return terms;
}

function buildVeroMatchers(terms) {
  return terms.map(t => {
    const term = normSpace(t.term);
    const isPhrase = /\s/.test(term);
    const esc = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    let reCount;
    let reRemove;

    if (isPhrase) {
      // フレーズ型：連続した並びで出現した場合のみ検出
      // ハイフン等の軽い区切りを許容（例: zodiac-blade survival）
      const parts = esc.split(/\s+/).join("[\\s\\-]+");
      reCount = new RegExp(parts, "ig");
      reRemove = new RegExp(parts, "ig");
    } else {
      // 単語型：case-insensitive + 語尾変化対応
      if (term.length <= 3) {
        // 短い単語は完全一致のみ
        reCount = new RegExp(`\\b${esc}\\b`, "ig");
        reRemove = new RegExp(`\\b${esc}\\b`, "ig");
      } else {
        // 長い単語は語尾変化を許容（dove/doves等）
        reCount = new RegExp(`\\b${esc}\\w*\\b`, "ig");
        reRemove = new RegExp(`\\b${esc}\\w*\\b`, "ig");
      }
    }
    return { reCount, reRemove };
  });
}

function countVeroInText(text, matchers) {
  const s = text || "";
  let count = 0;
  for (const m of matchers) {
    const hits = s.match(m.reCount);
    if (hits && hits.length) count += 1;
  }
  return count;
}

function removeVeroFromTitle(title, matchers) {
  let t = title || "";
  for (const m of matchers) t = t.replace(m.reRemove, " ");
  t = t.replace(/[|]+/g, " ");
  t = t.replace(/\s+/g, " ").trim();
  t = t.replace(/\s+([,.;:!?])/g, "$1");
  t = t.replace(/([,.;:!?])([A-Za-z0-9])/g, "$1 $2");
  t = t.replace(/\s+/g, " ").trim();
  return t;
}

/* ローカル事前短縮関数（80文字超の時のみ適用） */
function localShortenTitle(title) {
  const originalLen = (title || "").length;

  // 80文字以下の場合は短縮不要
  if (originalLen <= 80) return title;

  let t = title;

  // 1. with → w/ (大小文字無視)
  t = t.replace(/\bwith\b/gi, "w/");

  // 2. 単独語 for を削除（before等は残す）
  t = t.replace(/\s+\bfor\b\s+/gi, " ");

  // 3. 省略辞書（安全に短縮できる範囲のみ）
  // inches/inch → in（数字に続く場合のみ）
  t = t.replace(/(\d+\.?\d*)\s*(inches|inch)\b/gi, "$1 in");

  // pounds/lbs → lb
  t = t.replace(/\b(pounds|lbs)\b/gi, "lb");

  // ounce/ounces → oz（fl ozは維持）
  t = t.replace(/\b(?<!fl\s)(ounces|ounce)\b/gi, "oz");

  // millimeter → mm、centimeter → cm（数字に続く場合のみ）
  t = t.replace(/(\d+\.?\d*)\s*millimeters?\b/gi, "$1 mm");
  t = t.replace(/(\d+\.?\d*)\s*centimeters?\b/gi, "$1 cm");

  // set of → set
  t = t.replace(/\bset\s+of\b/gi, "set");

  // pack of → pk（タイトル長次第でpk優先）
  if (t.length > 85) {
    t = t.replace(/\bpack\s+of\b/gi, "pk");
  } else {
    t = t.replace(/\bpack\s+of\b/gi, "pack");
  }

  // 4. 品番が複数なら1つ減らす（モデル番号っぽいトークン判定）
  const modelNumberPattern = /\b[A-Z0-9][\w\-\/]{3,}\b/g;
  const modelNumbers = t.match(modelNumberPattern);
  if (modelNumbers && modelNumbers.length > 1) {
    // 最後の品番を削除
    const lastModel = modelNumbers[modelNumbers.length - 1];
    const lastIndex = t.lastIndexOf(lastModel);
    t = t.substring(0, lastIndex) + t.substring(lastIndex + lastModel.length);
  }

  // 5. 不要空白/記号周り整形
  t = t.replace(/\s+/g, " ").trim();
  t = t.replace(/\s+([,.;:!?])/g, "$1");
  t = t.replace(/([,.;:!?])([A-Za-z0-9])/g, "$1 $2");
  t = t.replace(/\s+/g, " ").trim();

  // 自然で読みやすい構文を維持（不自然な詰め込み禁止）
  // 極端に短くなりすぎた場合は元に戻す
  if (t.length < 50 && originalLen > 70) {
    return title;  // 短縮しすぎた場合は元のタイトルを返す
  }

  return t;
}

/* ターゲット文字数判定関数 */
function determineTargetLength(title) {
  const len = (title || "").length;

  // 基本ターゲットは78文字
  let target = 78;

  // 条件1: 入力タイトルが78文字以上
  if (len >= 78) {
    target = 75;
    return target;
  }

  // 条件2: 品番っぽいトークンが3個以上（英数字4文字以上かつ数字を含むトークン）
  const modelPattern = /\b[A-Za-z0-9]*\d+[A-Za-z0-9]{3,}\b/g;
  const models = (title || "").match(modelPattern) || [];
  if (models.length >= 3) {
    target = 75;
    return target;
  }

  // 条件3: 寸法・規格トークンが多い（in, mm, cm, lb, oz, V, W, Ah, mAh, rpm, psi, NPT, M6等が合計3個以上）
  const unitPattern = /\b(in|mm|cm|lb|oz|V|W|Ah|mAh|rpm|psi|NPT|M\d+)\b/gi;
  const units = (title || "").match(unitPattern) || [];
  if (units.length >= 3) {
    target = 75;
    return target;
  }

  return target;
}

function detectAdultGoods(descText) {
  const d = lc(descText || "");
  if (!d) return false;
  const kws = [
    "dildo", "vibrator", "sex toy", "adult toy", "masturbat", "bdsm",
    "anal", "butt plug", "penis", "vagina", "clitoris", "fetish",
    "vibrating", "love toy"
  ];
  return kws.some(k => d.includes(k));
}

function computeShipReasons({ blockText, protectedText, descText, duplicationError }) {
  const reasons = [];
  if (protectedText) reasons.push("protected");
  if (duplicationError) reasons.push("already listed");
  const terms = parseVeroTerms(blockText);
  if (terms.some(x => x.kind === "brand")) reasons.push("brand");
  if (detectAdultGoods(descText)) reasons.push("adult goods");
  return Array.from(new Set(reasons));
}
