/* ListerFlow Pro – OpenAI API 呼び出し + プロンプト構築
   ※ utils.js の sleep() に依存
   ※ chrome.runtime.sendMessage を使用
*/

/* ---------- OpenAI ---------- */

async function callOpenAI({ messages }, retryCount = 0) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: "LFP_OPENAI", messages }, async (res) => {
      if (chrome.runtime.lastError) {
        // ネットワークエラー等の場合は1回だけリトライ
        if (retryCount === 0) {
          console.log("⚠️ [LFP] API呼び出し失敗。リトライします...", chrome.runtime.lastError.message);
          await sleep(1000);
          try {
            const retryRes = await callOpenAI({ apiKey, model, messages }, retryCount + 1);
            return resolve(retryRes);
          } catch (e) {
            return reject(e);
          }
        }
        return reject(new Error(chrome.runtime.lastError.message));
      }

      if (res && res.ok) {
        resolve(res.text);
      } else {
        // 5xx系やタイムアウト等の場合もリトライ検討（SW側で制御されている場合を想定）
        const isTransient = res?.error?.includes("timeout") || res?.error?.includes("500") || res?.error?.includes("fetch");
        if (isTransient && retryCount === 0) {
          console.log("⚠️ [LFP] API一時的エラー。リトライします...", res.error);
          await sleep(1000);
          try {
            const retryRes = await callOpenAI({ apiKey, model, messages }, retryCount + 1);
            return resolve(retryRes);
          } catch (e) {
            return reject(e);
          }
        }
        reject(new Error(res?.error || "OpenAI呼び出しに失敗しました"));
      }
    });
  });
}

function buildOptimizePrompt({ title, desc, forbiddenTerms, targetLen, tryNum, prevOutput, prevLen, rejectedOutputs }) {
  const forb = forbiddenTerms.length ? forbiddenTerms.join(", ") : "(none)";

  let sys = [
    "You are a high-speed and high-accuracy eBay product title optimization engine.",
    "Return exactly ONE optimized English title only (single line).",
    `Target length: ${targetLen} characters (must be 70–80 characters inclusive).`,
    "SEO-first, buyer-oriented, concise, natural phrasing.",
    "No brand names unless explicitly present in the input title/description.",
    "Avoid claims: genuine, official, certified, OEM, warranty.",
    "Never include any extra lines, counts, labels, quotes, or punctuation-only output.",
    `CRITICAL: Forbidden terms (must NEVER appear in ANY form, case-insensitive): ${forb}`,
    "If any forbidden term appears in the input, REMOVE it completely from the output.",
    "If you detect a forbidden term might appear, remove it and optimize naturally.",
    "Double-check your output: scan every word to ensure NO forbidden term is present."
  ];

  // 過去に却下されたタイトルがある場合、異なるタイトル生成を強制
  if (rejectedOutputs && rejectedOutputs.length > 0) {
    sys.push("IMPORTANT: The following titles have already been generated and REJECTED because they contained forbidden terms or were duplicates.");
    sys.push("You MUST output a COMPLETELY DIFFERENT title that avoids all forbidden terms:");
    rejectedOutputs.forEach((t, i) => sys.push(`  Rejected #${i + 1}: ${t}`));
    sys.push("Use different word choices, different structure, and different phrasing.");
  }

  let user = [];

  if (tryNum === 1) {
    // Try1: 通常最適化
    sys.push("If title is short, you may pull a few relevant words from the description to reach 70–80.");
    sys.push("If description is empty, use natural SEO keywords to supplement (no keyword stuffing, readability first).");
    user = [
      `INPUT TITLE:\n${title}`,
      `DESCRIPTION (may use to extend if needed):\n${desc || "(empty)"}`,
      "OUTPUT: one line title only."
    ];
  } else if (tryNum === 2) {
    // Try2: 前回結果を評価して分岐
    sys.push("IMPORTANT: You must output a DIFFERENT title from the previous attempt.");

    if (prevLen > 80) {
      // 長すぎる：削減指示
      sys.push(`Previous output was ${prevLen} chars (too long). You MUST shorten it by 2-6 characters.`);
      sys.push("凗長語削除、語順短縮、省略形、括弧整理、品番削減 to reach target.");
      user = [
        `PREVIOUS OUTPUT (${prevLen} chars, too long):\n${prevOutput}`,
        `DESCRIPTION:\n${desc || "(empty)"}`,
        `OUTPUT: Shortened version targeting ${targetLen} chars (70-80 range).`
      ];
    } else if (prevLen < 70) {
      // 短すぎる：補足指示
      sys.push(`Previous output was ${prevLen} chars (too short). You MUST extend it by 2-10 characters.`);
      sys.push("Pull relevant info from description, or add natural SEO keywords if description is empty.");
      user = [
        `PREVIOUS OUTPUT (${prevLen} chars, too short):\n${prevOutput}`,
        `DESCRIPTION:\n${desc || "(empty)"}`,
        `OUTPUT: Extended version targeting ${targetLen} chars (70-80 range).`
      ];
    } else {
      // 70〜80だが不自然：自然化指示
      sys.push(`Previous output was ${prevLen} chars (within range but may be unnatural).`);
      sys.push("キーワード詰め込み抑制、読みやすい構文 to improve readability.");
      user = [
        `PREVIOUS OUTPUT (${prevLen} chars):\n${prevOutput}`,
        `DESCRIPTION:\n${desc || "(empty)"}`,
        `OUTPUT: More natural version targeting ${targetLen} chars (70-80 range).`
      ];
    }
  } else if (tryNum === 3) {
    // Try3: 最終調整
    sys.push("FINAL ATTEMPT: You must output a DIFFERENT title from the previous two attempts.");

    if (prevLen > 80) {
      // さらに短縮
      sys.push(`Previous output was ${prevLen} chars (still too long). You MUST shorten it further.`);
      sys.push("必須語を残し、装飾語や重複表現を落とす、型番を最大2に制限.");
      user = [
        `PREVIOUS OUTPUT (${prevLen} chars, still too long):\n${prevOutput}`,
        `DESCRIPTION:\n${desc || "(empty)"}`,
        `OUTPUT: Final shortened version targeting ${targetLen} chars (70-80 range).`
      ];
    } else if (prevLen < 70) {
      // 最小限の補足
      sys.push(`Previous output was ${prevLen} chars (still too short). You MUST extend it minimally.`);
      sys.push("カテゴリ一般語を2語まで追加、自然文維持.");
      user = [
        `PREVIOUS OUTPUT (${prevLen} chars, still too short):\n${prevOutput}`,
        `DESCRIPTION:\n${desc || "(empty)"}`,
        `OUTPUT: Final extended version targeting ${targetLen} chars (70-80 range).`
      ];
    } else {
      // 70〜80だが再度不自然
      sys.push(`Previous output was ${prevLen} chars (within range but needs improvement).`);
      sys.push("Final polish: ensure natural flow, no keyword stuffing, buyer-friendly.");
      user = [
        `PREVIOUS OUTPUT (${prevLen} chars):\n${prevOutput}`,
        `DESCRIPTION:\n${desc || "(empty)"}`,
        `OUTPUT: Final polished version targeting ${targetLen} chars (70-80 range).`
      ];
    }
  }

  return { messages: [{ role: "system", content: sys.join("\n") }, { role: "user", content: user.join("\n\n") }] };
}
