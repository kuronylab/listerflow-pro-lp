/**
 * vero.js
 * VeRO判定ロジック
 */

import { TITLE_LENGTH, COMPATIBILITY_PHRASES, ADULT_KEYWORDS } from './constants.js';
import { lc, escapeRegex } from './utils.js';

/**
 * VeRO Warningsテキストから「title:」と「brand:」の単語を抽出
 */
export function parseVeroTerms(blockText) {
  const lines = (blockText || "").split("\n").map(x => x.trim()).filter(Boolean);
  const result = [];

  for (const line of lines) {
    const brandMatch = line.match(/^brand:\s*(.+)/i);
    if (brandMatch) {
      result.push({ kind: "brand", term: brandMatch[1].trim() });
      continue;
    }

    const titleMatch = line.match(/^title:\s*(.+)/i);
    if (titleMatch) {
      result.push({ kind: "title", term: titleMatch[1].trim() });
      continue;
    }
  }

  return result;
}

/**
 * VeRO単語のマッチャーを生成
 */
export function buildVeroMatchers(terms) {
  return terms.map(word => {
    const esc = escapeRegex(word);
    let reCount, reRemove;

    if (word.length <= 3) {
      // 短い単語は完全一致のみ
      reCount = new RegExp(`\\b${esc}\\b`, "ig");
      reRemove = new RegExp(`\\b${esc}\\b`, "ig");
    } else {
      if (/^[a-z]+$/i.test(word)) {
        // 長い単語は語尾変化を許容（dove/doves等）
        reCount = new RegExp(`\\b${esc}\\w*\\b`, "ig");
        reRemove = new RegExp(`\\b${esc}\\w*\\b`, "ig");
      }
    }
    return { reCount, reRemove };
  });
}

/**
 * タイトルに含まれるVeRO単語の数をカウント
 */
export function countVeroInText(text, matchers) {
  const s = text || "";
  let count = 0;
  for (const m of matchers) {
    const hits = s.match(m.reCount);
    if (hits && hits.length) count += 1;
  }
  return count;
}

/**
 * タイトルからVeRO単語を削除
 */
export function removeVeroFromTitle(title, matchers) {
  let t = title || "";
  for (const m of matchers) t = t.replace(m.reRemove, " ");
  t = t.replace(/[|]+/g, " ");
  t = t.replace(/\s+/g, " ").trim();
  t = t.replace(/\s+([,.;:!?])/g, "$1");
  t = t.replace(/([,.;:!?])([A-Za-z0-9])/g, "$1 $2");
  t = t.replace(/\s+/g, " ").trim();
  return t;
}

/**
 * ローカル事前短縮関数（80文字超の時のみ適用）
 */
export function localShortenTitle(title) {
  const originalLen = (title || "").length;
  
  // 80文字以下の場合は短縮不要
  if (originalLen <= TITLE_LENGTH.MAX) return title;
  
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
  if (t.length < 50 && originalLen > TITLE_LENGTH.MIN) {
    return title;  // 短縮しすぎた場合は元のタイトルを返す
  }
  
  return t;
}

/**
 * ターゲット文字数判定関数
 */
export function determineTargetLength(title) {
  const len = (title || "").length;
  
  // 基本ターゲットは78文字
  let target = TITLE_LENGTH.TARGET;
  
  // 条件1: 入力タイトルが78文字以上
  if (len >= TITLE_LENGTH.TARGET) {
    target = TITLE_LENGTH.TARGET_SHORT;
    return target;
  }
  
  // 条件2: 品番っぽいトークンが3個以上（英数字4文字以上かつ数字を含むトークン）
  const modelPattern = /\b[A-Za-z0-9]*\d+[A-Za-z0-9]{3,}\b/g;
  const models = (title || "").match(modelPattern) || [];
  if (models.length >= 3) {
    target = TITLE_LENGTH.TARGET_SHORT;
    return target;
  }
  
  // 条件3: 寸法・規格トークンが多い（in, mm, cm, lb, oz, V, W, Ah, mAh, rpm, psi, NPT, M6等が合計3個以上）
  const unitPattern = /\b(in|mm|cm|lb|oz|V|W|Ah|mAh|rpm|psi|NPT|M\d+)\b/gi;
  const units = (title || "").match(unitPattern) || [];
  if (units.length >= 3) {
    target = TITLE_LENGTH.TARGET_SHORT;
    return target;
  }
  
  return target;
}

/**
 * アダルト商品の検出
 */
export function detectAdultGoods(descText) {
  const d = lc(descText || "");
  if (!d) return false;
  return ADULT_KEYWORDS.some(k => d.includes(k));
}

/**
 * 出品不可理由を計算
 */
export function computeShipReasons({ blockText, protectedText, descText, duplicationError }) {
  const reasons = [];
  if (protectedText) reasons.push("protected");

  const parsed = parseVeroTerms(blockText);
  const hasBrand = parsed.some(x => x.kind === "brand");
  if (hasBrand) reasons.push("brand");

  if (detectAdultGoods(descText)) reasons.push("adult goods");
  if (duplicationError) reasons.push("already listed");

  return reasons;
}

/**
 * VeRO判定のメインロジック
 * @returns {Object} { shipText, highlight, veroCountForDisplay, hasTitleVeroWarning }
 */
export function evaluateVeroStatus({ title, blockText, reasons }) {
  const parsed = parseVeroTerms(blockText);
  const titleTerms = parsed.filter(x => x.kind === "title").map(x => x.term);
  const titleWords = titleTerms.flatMap(t => t.split(/\s+/));

  const matchers = buildVeroMatchers(titleWords);
  const veroCountForCheck = countVeroInText(title, matchers);
  let veroCountForDisplay = veroCountForCheck;
  
  // Vero Warnings: title: のチェック
  let hasTitleVeroWarning = false;
  const fullText = blockText || "";
  const veroTitleMatch = fullText.match(/Vero Warnings:[\s\S]*?title:\s*(.+?)(?:\n|$)/i);
  
  if (veroTitleMatch) {
    const veroWords = veroTitleMatch[1].trim().split(/\s+/);
    const currentTitle = (title || "").toLowerCase();
    
    // title: 内の単語がタイトルに含まれている数をカウント（表示用）
    const titleVeroCount = veroWords.filter(word => 
      currentTitle.includes(word.toLowerCase())
    ).length;
    
    veroCountForDisplay += titleVeroCount;  // 表示用のみ加算
    
    // すべてのVero単語がタイトルに含まれているかチェック（判定用）
    const allVeroWordsPresent = veroWords.every(word => 
      currentTitle.includes(word.toLowerCase())
    );
    
    // Yaballe公式ルール：「FOR」「COMPATIBLE WITH」「FITS」があれば許容
    const hasCompatibilityPhrase = COMPATIBILITY_PHRASES.some(phrase => 
      new RegExp(`\\b${phrase}\\b`, 'i').test(currentTitle)
    );
    
    if (allVeroWordsPresent) {
      // すべての単語が残っている場合
      if (hasCompatibilityPhrase) {
        // 互換性を示す言い回しがあればOK
        hasTitleVeroWarning = false;
        console.log(`✅ [Vero Title] 互換性表現あり。VeRO単語: ${veroWords.join(', ')}`);
      } else {
        // 互換性表現がなければNG
        hasTitleVeroWarning = true;
        console.log(`⚠️ [Vero Title] すべてのVero単語が残っており、互換性表現なし: ${veroWords.join(', ')}`);
      }
    } else {
      // 一部でも削除されていればOK
      const remainingWords = veroWords.filter(word => 
        currentTitle.includes(word.toLowerCase())
      );
      hasTitleVeroWarning = false;
      console.log(`✅ [Vero Title] 最適化済み。残っている単語: ${remainingWords.join(', ')}`);
    }
  }

  const len = (title || "").length;
  let shipText = "-";
  let highlight = false;

  if (reasons.length) {
    shipText = `NG（${reasons.join(" / ")}）`;
  } else {
    if (len >= TITLE_LENGTH.MIN && len <= TITLE_LENGTH.MAX && veroCountForCheck === 0 && !hasTitleVeroWarning) {
      shipText = "OK";
      highlight = false;
    } else {
      shipText = "OK（最適化後）";
      highlight = true;
    }
  }

  return { shipText, highlight, veroCountForDisplay, hasTitleVeroWarning };
}
