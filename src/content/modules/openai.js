/**
 * openai.js
 * OpenAI API連携
 */

import { TITLE_LENGTH } from './constants.js';

/**
 * OpenAI APIを呼び出す
 */
export async function callOpenAI({ apiKey, model, messages }) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`
    },
    body: JSON.stringify({ model, temperature: 0.2, messages })
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`OpenAI APIエラー: ${res.status} ${res.statusText} ${txt}`.slice(0, 400));
  }

  const data = await res.json();
  return data?.choices?.[0]?.message?.content ?? "";
}

/**
 * タイトル最適化プロンプトを構築
 */
export function buildOptimizePrompt({ title, desc, forbiddenTerms, targetLen, tryNum, prevOutput, prevLen }) {
  const forb = forbiddenTerms.length ? forbiddenTerms.join(", ") : "(none)";
  
  let sys = [
    "You are a high-speed and high-accuracy eBay product title optimization engine.",
    "Return exactly ONE optimized English title only (single line).",
    `Target length: ${targetLen} characters (must be ${TITLE_LENGTH.MIN}–${TITLE_LENGTH.MAX} characters inclusive).`,
    "SEO-first, buyer-oriented, concise, natural phrasing.",
    "No brand names unless explicitly present in the input title/description.",
    "Avoid claims: genuine, official, certified, OEM, warranty.",
    "Never include any extra lines, counts, labels, quotes, or punctuation-only output.",
    `CRITICAL: Forbidden terms (must NEVER appear, case-insensitive): ${forb}`,
    "If any forbidden term appears in the input, REMOVE it completely from the output.",
    "If you detect a forbidden term might appear, remove it and optimize naturally."
  ];
  
  let user = [];
  
  if (tryNum === 1) {
    // Try1: 通常最適化
    sys.push(`If title is short, you may pull a few relevant words from the description to reach ${TITLE_LENGTH.MIN}–${TITLE_LENGTH.MAX}.`);
    sys.push("If description is empty, use natural SEO keywords to supplement (no keyword stuffing, readability first).");
    user = [
      `INPUT TITLE:\n${title}`,
      `DESCRIPTION (may use to extend if needed):\n${desc || "(empty)"}`,
      "OUTPUT: one line title only."
    ];
  } else if (tryNum === 2) {
    // Try2: 前回結果を評価して分岐
    sys.push("IMPORTANT: You must output a DIFFERENT title from the previous attempt.");
    
    if (prevLen > TITLE_LENGTH.MAX) {
      // 長すぎる：削減指示
      sys.push(`Previous output was ${prevLen} chars (too long). You MUST shorten it by 2-6 characters.`);
      sys.push("冗長語削除、語順短縮、省略形、括弧整理、品番削減 to reach target.");
      user = [
        `PREVIOUS OUTPUT (${prevLen} chars, too long):\n${prevOutput}`,
        `DESCRIPTION:\n${desc || "(empty)"}`,
        `OUTPUT: Shortened version targeting ${targetLen} chars (${TITLE_LENGTH.MIN}-${TITLE_LENGTH.MAX} range).`
      ];
    } else if (prevLen < TITLE_LENGTH.MIN) {
      // 短すぎる：補足指示
      sys.push(`Previous output was ${prevLen} chars (too short). You MUST extend it by 2-10 characters.`);
      sys.push("Pull relevant info from description, or add natural SEO keywords if description is empty.");
      user = [
        `PREVIOUS OUTPUT (${prevLen} chars, too short):\n${prevOutput}`,
        `DESCRIPTION:\n${desc || "(empty)"}`,
        `OUTPUT: Extended version targeting ${targetLen} chars (${TITLE_LENGTH.MIN}-${TITLE_LENGTH.MAX} range).`
      ];
    } else {
      // 70〜80だが不自然：自然化指示
      sys.push(`Previous output was ${prevLen} chars (within range but may be unnatural).`);
      sys.push("キーワード詰め込み抑制、読みやすい構文 to improve readability.");
      user = [
        `PREVIOUS OUTPUT (${prevLen} chars):\n${prevOutput}`,
        `DESCRIPTION:\n${desc || "(empty)"}`,
        `OUTPUT: More natural version targeting ${targetLen} chars (${TITLE_LENGTH.MIN}-${TITLE_LENGTH.MAX} range).`
      ];
    }
  } else if (tryNum === 3) {
    // Try3: 最終調整
    sys.push("FINAL ATTEMPT: You must output a DIFFERENT title from the previous two attempts.");
    
    if (prevLen > TITLE_LENGTH.MAX) {
      // さらに短縮
      sys.push(`Previous output was ${prevLen} chars (still too long). You MUST shorten it further.`);
      sys.push("必須語を残し、装飾語や重複表現を落とす、型番を最大2に制限.");
      user = [
        `PREVIOUS OUTPUT (${prevLen} chars, still too long):\n${prevOutput}`,
        `DESCRIPTION:\n${desc || "(empty)"}`,
        `OUTPUT: Final shortened version targeting ${targetLen} chars (${TITLE_LENGTH.MIN}-${TITLE_LENGTH.MAX} range).`
      ];
    } else if (prevLen < TITLE_LENGTH.MIN) {
      // 最小限の補足
      sys.push(`Previous output was ${prevLen} chars (still too short). You MUST extend it minimally.`);
      sys.push("カテゴリ一般語を2語まで追加、自然文維持.");
      user = [
        `PREVIOUS OUTPUT (${prevLen} chars, still too short):\n${prevOutput}`,
        `DESCRIPTION:\n${desc || "(empty)"}`,
        `OUTPUT: Final extended version targeting ${targetLen} chars (${TITLE_LENGTH.MIN}-${TITLE_LENGTH.MAX} range).`
      ];
    } else {
      // 70〜80だが再度不自然
      sys.push(`Previous output was ${prevLen} chars (within range but needs improvement).`);
      sys.push("Final polish: ensure natural flow, no keyword stuffing, buyer-friendly.");
      user = [
        `PREVIOUS OUTPUT (${prevLen} chars):\n${prevOutput}`,
        `DESCRIPTION:\n${desc || "(empty)"}`,
        `OUTPUT: Final polished version targeting ${targetLen} chars (${TITLE_LENGTH.MIN}-${TITLE_LENGTH.MAX} range).`
      ];
    }
  }
  
  return { messages: [{ role: "system", content: sys.join("\n") }, { role: "user", content: user.join("\n\n") }] };
}
