/* ListerFlow Pro – Evaluate / Optimize
   ※ utils.js (normSpace, sleep), vero.js (extractWarningBlockText 等),
   ※ dom-helpers.js (findLabelInput, readText, setInputValue, findButtonByText),
   ※ openai.js (callOpenAI, buildOptimizePrompt),
   ※ content.js (UI, STORE, setBusy, setBadge, setStatusLine, ensureUIBelowTitle,
   ※            ensureQuickMipButton, clickRealMipButton, resetUIState等) に依存
*/

/* ---------- Evaluate / Optimize ---------- */

async function evaluateAndRender({ titleEl, btnGet }) {
  const modal = document.querySelector('.modal, [role="dialog"]');
  if (modal && !modal.dataset.lfpModal && modal.offsetParent !== null) {
    // 競合防止：ここでは判定のみを行い、自動クリック等の副作用はMutationObserver（setupListingSuccessObserver / setupNoListingsObserver）に任せる
    return;
  }

  const title = readText(titleEl);
  const len = (title || "").length;

  const block = extractWarningBlockText();
  const terms = parseVeroTerms(block);
  const titleTerms = terms.filter(t => t.kind === "title");
  const matchers = buildVeroMatchers(titleTerms);

  // 判定用のveroCount（従来通り）
  const veroCountForCheck = STORE.opt.veroEnabled ? countVeroInText(title, matchers) : 0;
  let veroCountForDisplay = veroCountForCheck;

  const descEl =
    findLabelInput(/^(Description|説明|商品説明)$/i) ||
    document.querySelector("textarea[ng-model*='description'], div[contenteditable='true'][ng-model*='description']") ||
    null;
  const descText = readText(descEl);

  const protectedText = extractProtectedText();
  const duplicationError = extractDuplicationError();
  const reasons = computeShipReasons({ blockText: block, protectedText, descText, duplicationError });

  if (reasons.length) setBadge(`×出品不可：${reasons.join(" / ")}`);
  else setBadge("");

  // title: のチェック（案7）
  let hasTitleVeroWarning = false;
  const fullText = block || "";
  const veroTitleMatch = fullText.match(/Vero Warnings:[\s\S]*?title:\s*(.+?)(?:\n|$)/i);
  if (veroTitleMatch) {
    const veroWords = veroTitleMatch[1].trim().split(/\s+/);
    const currentTitle = (title || "").toLowerCase();

    // title: 内の単語がタイトルに含まれている数をカウント（表示用）
    const titleVeroCount = veroWords.filter(word => {
      const esc = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const re = new RegExp(`\\b${esc}\\b`, "i");
      return re.test(currentTitle);
    }).length;

    veroCountForDisplay += titleVeroCount;  // 表示用のみ加算

    // すべてのVero単語がタイトルに「単語として」含まれているかチェック（判定用）
    const allVeroWordsPresent = veroWords.every(word => {
      const esc = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const re = new RegExp(`\\b${esc}\\b`, "i");
      return re.test(currentTitle);
    });

    // Yaballe公式ルール：「FOR」「COMPATIBLE WITH」「FITS」があれば許容
    const hasCompatibilityPhrase = /\b(for|compatible\s+with|fits)\b/i.test(currentTitle);

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
      const remainingWords = veroWords.filter(word => {
        const esc = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const re = new RegExp(`\\b${esc}\\b`, "i");
        return re.test(currentTitle);
      });
      hasTitleVeroWarning = false;
      console.log(`✅ [Vero Title] 最適化済み。残っている単語: ${remainingWords.join(', ')}`);
    }
  }

  let shipText = "-";
  let highlight = false;

  if (reasons.length) {
    shipText = `NG（${reasons.join(" / ")}）`;
  } else {
    // MIP実行済み（出品開始後）の場合は、強制的に「OK」として表示を安定させる
    if (STORE.turboExecuted.mip) {
      shipText = "OK";
      highlight = false;
    } else if (len >= 70 && len <= 80 && veroCountForCheck === 0 && !hasTitleVeroWarning) {
      shipText = "OK";
      highlight = false;
    } else {
      shipText = "OK（最適化後）";
      highlight = true;
    }
  }

  // 出品可否をストアに保存
  STORE.optimizeState.isListable = (reasons.length === 0);

  // 出品NGの場合、または既にMIP実行済みの場合は最適化ボタンを無効化
  if (UI.btnOpt) {
    UI.btnOpt.disabled = (!STORE.optimizeState.isListable || STORE.turboExecuted.mip);
  }

  setStatusLine(len, veroCountForDisplay, shipText, highlight);

  // Quick MIPボタンの表示・有効化制御：常に表示、「出品：OK」の時のみクリック可能
  if (STORE.opt.quickMipButton && btnGet) {
    // MIPボタンが存在しない場合は生成
    if (!UI.quickMipBtn || !UI.quickMipBtn.isConnected) {
      ensureQuickMipButton(btnGet);
    }

    if (UI.quickMipBtn) {
      const shouldEnable = (reasons.length === 0 && len >= 70 && len <= 80 && veroCountForCheck === 0 && !hasTitleVeroWarning);

      // 点滅防止: 一度有効になったボタンを無効に戻さない（新しいASIN取得時にresetUIStateでリセット済み）
      if (shouldEnable || !UI.quickMipBtn._wasEnabled) {
        UI.quickMipBtn.disabled = !shouldEnable;
        if (shouldEnable) UI.quickMipBtn._wasEnabled = true;
      }

      UI.quickMipBtn.style.display = "inline-flex";
      UI.quickMipBtn.style.width = `${btnGet.getBoundingClientRect().width}px`;
    }
  }

  // フラグ判定とASIN履歴更新
  if (STORE.lastRequestedAsin) {
    // まず、現在の履歴を確認してno_listingsフラグが立っているかチェック
    const history = await loadHistory();
    const currentEntry = history.find(entry => entry.asin === STORE.lastRequestedAsin);
    const hasNoListingsFlag = currentEntry && currentEntry.flags && currentEntry.flags.no_listings;

    // 画面が更新されたかどうかをチェック（前回のタイトルと現在のタイトルが異なるか）
    const currentTitle = normSpace(title || "");
    const titleChanged = !STORE.lastTitle || currentTitle !== STORE.lastTitle;

    // no_listingsフラグが立っている場合、または画面が更新されていない場合、他のフラグ判定をスキップ
    if (!hasNoListingsFlag && titleChanged) {
      const flags = {};

      // protected検出
      if (protectedText && protectedText.length > 0) {
        flags.protected = true;
      }

      // brand検出（VeRO Warningsのkindがbrandを含む場合）
      const brandTerms = terms.filter(t => t.kind === "brand");
      if (brandTerms.length > 0) {
        flags.brand = true;
      }

      // already_listed検出
      if (duplicationError && duplicationError.length > 0) {
        flags.already_listed = true;
      }

      // 履歴を更新（フラグがなくても更新して、lastSeenを記録）
      await updateHistoryFlags(STORE.lastRequestedAsin, flags);
    }
  }
}

let optimizeRunning = false;

async function onOptimizeClick({ titleEl }) {
  // 1. 利用制限チェック（Basicプランは1日2回に増加）
  const canExecute = await checkUsageLimit();
  if (!canExecute) return;

  // すでに出品中（MIP後）なら一切動作させない
  if (STORE.turboExecuted.mip) return;

  // 連打防止（APIリクエスト中のみ）
  if (optimizeRunning) return;
  optimizeRunning = true;

  try {
    await loadOptions();

    if (!STORE.opt.apiKey) {
      setBadge("API key未設定");
      ensureUIBelowTitle(titleEl);
    }

    const currentTitle = normSpace(readText(titleEl));
    const blockText = extractWarningBlockText();
    const terms = parseVeroTerms(blockText);
    const titleTerms = terms.filter(t => t.kind === "title");
    const matchers = buildVeroMatchers(titleTerms);
    const forbidden = STORE.opt.veroEnabled ? titleTerms.map(t => normSpace(t.term)) : [];

    const descEl =
      findLabelInput(/^(Description|説明|商品説明)$/i) ||
      document.querySelector("textarea[ng-model*='description'], div[contenteditable='true'][ng-model*='description']") ||
      null;
    const descText = readText(descEl);

    const protectedText = extractProtectedText();
    const duplicationError = extractDuplicationError();
    const reasons = computeShipReasons({ blockText, protectedText, descText, duplicationError });
    if (reasons.length) {
      setBadge(`×出品不可：${reasons.join(" / ")}`);
      // return; // ロックを排除するため継続
    }

    let srcTitle = readText(titleEl);
    if (!srcTitle) return;

    // ターゲット文字数を判定
    const targetLen = determineTargetLength(srcTitle);

    // ローカル事前短縮（80文字超の時のみ適用）
    srcTitle = localShortenTitle(srcTitle);

    // Vero除去もローカルで実施（GPTに投げる前に保険）
    if (STORE.opt.veroEnabled && matchers.length) {
      srcTitle = removeVeroFromTitle(srcTitle, matchers);
    }

    setBusy(true);

    let finalTitle = "";
    let finalVero = 999;
    let finalLen = 0;
    let prevOutput = "";
    let prevLen = 0;

    // 1クリック = 最大3リクエスト
    for (let tryNum = 1; tryNum <= 3; tryNum++) {
      const prompt = buildOptimizePrompt({
        title: tryNum === 1 ? srcTitle : prevOutput,
        desc: descText,
        forbiddenTerms: forbidden,
        targetLen: targetLen,
        tryNum: tryNum,
        prevOutput: prevOutput,
        prevLen: prevLen,
        rejectedOutputs: STORE.optimizeState.lastOutputs
      });

      try {
        const raw = await callOpenAI({ apiKey: STORE.opt.apiKey, model: STORE.opt.model, messages: prompt.messages });
        let out = normSpace((raw || "").split("\n")[0] || "");

        // GPT出力後もVero除去を実施（保険）
        if (STORE.opt.veroEnabled && matchers.length) out = removeVeroFromTitle(out, matchers);
        if (!out) continue;

        // 同一出力対策：Try2以降で前回と同じ場合はスキップ
        if (tryNum > 1 && out === prevOutput) {
          continue;
        }

        finalTitle = out;
        finalLen = finalTitle.length;
        finalVero = STORE.opt.veroEnabled ? countVeroInText(finalTitle, matchers) : 0;

        prevOutput = finalTitle;
        prevLen = finalLen;

        // 70〜80に収束したら終了
        if (finalLen >= 70 && finalLen <= 80) break;
      } catch (e) {
        console.error('[LFP] OpenAI API Error:', e);

        // Extension context invalidated エラーのハンドリング
        if (e.message && (e.message.includes('Extension context invalidated') || e.message.includes('context_invalidated'))) {
          alert('拡張機能が更新されました。正常に動作させるためにページを再読み込みしてください。');
        }

        setBusy(false);
        optimizeRunning = false;
        return;
      }
    }

    if (finalTitle) {
      // 出力を履歴に記録（同一タイトル生成防止用）
      STORE.optimizeState.lastOutputs.push(finalTitle);
      // 最大5件まで保持
      if (STORE.optimizeState.lastOutputs.length > 5) {
        STORE.optimizeState.lastOutputs.shift();
      }

      setInputValue(titleEl, finalTitle);
      await sleep(120);
      const btnGet = findButtonByText(/^Get Item$/i);
      await evaluateAndRender({ titleEl, btnGet });

      // 最適化が実行されたのでカウントアップ
      await incrementUsageCount();
      await refreshListingCountUI();

      // === Vero残存リトライループ ===
      // evaluateAndRender後にVeroが残っていないか再チェックし、
      // 残っている場合は自動で再最適化を試みる（最大2回）
      const MAX_VERO_RETRIES = 2;
      for (let veroRetry = 0; veroRetry < MAX_VERO_RETRIES; veroRetry++) {
        // 現在のステータスを確認
        const currentStatus = UI.status?.textContent || "";
        const isShipOk = currentStatus.includes("出品：OK") && !currentStatus.includes("（最適化後）");
        if (isShipOk) break; // 出品OKなら終了

        // Veroワード残存チェック: Yaballeの警告ブロックを再パース
        const retryBlock = extractWarningBlockText();
        const retryTerms = parseVeroTerms(retryBlock);
        const retryTitleTerms = retryTerms.filter(t => t.kind === "title");
        const retryMatchers = buildVeroMatchers(retryTitleTerms);
        const retryForbidden = STORE.opt.veroEnabled ? retryTitleTerms.map(t => normSpace(t.term)) : [];
        const currentTitle = readText(titleEl);
        const retryVeroCount = STORE.opt.veroEnabled ? countVeroInText(currentTitle, retryMatchers) : 0;

        if (retryVeroCount === 0 && retryForbidden.length === 0) break; // Veroなしなら終了

        console.log(`🔄 [LFP] Vero残存リトライ ${veroRetry + 1}/${MAX_VERO_RETRIES}: Vero ${retryVeroCount}件検出、再最適化します`);
        setBadge(`Vero残存を検出、再最適化中... (${veroRetry + 1}/${MAX_VERO_RETRIES})`);

        // まずローカルでVero除去を試みる
        let retryTitle = currentTitle;
        if (retryMatchers.length) {
          retryTitle = removeVeroFromTitle(retryTitle, retryMatchers);
        }

        // ローカル除去後もVeroが残っている、または文字数条件を満たさない場合はAPI再最適化
        const localVeroCount = countVeroInText(retryTitle, retryMatchers);
        const localLen = retryTitle.length;

        if (localVeroCount === 0 && localLen >= 70 && localLen <= 80) {
          // ローカル除去で解決
          setInputValue(titleEl, retryTitle);
          await sleep(120);
          await evaluateAndRender({ titleEl, btnGet });
        } else {
          // API再最適化が必要
          const allForbidden = [...new Set([...forbidden, ...retryForbidden])];
          const retryPrompt = buildOptimizePrompt({
            title: retryTitle,
            desc: descText,
            forbiddenTerms: allForbidden,
            targetLen: targetLen,
            tryNum: 2,
            prevOutput: retryTitle,
            prevLen: retryTitle.length,
            rejectedOutputs: STORE.optimizeState.lastOutputs
          });

          try {
            const raw = await callOpenAI({ apiKey: STORE.opt.apiKey, model: STORE.opt.model, messages: retryPrompt.messages });
            let out = normSpace((raw || "").split("\n")[0] || "");
            // Vero除去（新旧両方のmatcherで）
            const allMatchers = [...matchers, ...retryMatchers];
            if (STORE.opt.veroEnabled && allMatchers.length) out = removeVeroFromTitle(out, allMatchers);
            if (out && out !== finalTitle) {
              finalTitle = out;
              finalLen = finalTitle.length;
              STORE.optimizeState.lastOutputs.push(finalTitle);
              if (STORE.optimizeState.lastOutputs.length > 5) STORE.optimizeState.lastOutputs.shift();
              setInputValue(titleEl, finalTitle);
              await sleep(120);
              await evaluateAndRender({ titleEl, btnGet });
            }
          } catch (e) {
            console.error('[LFP] Veroリトライ中のAPIエラー:', e);
            break;
          }
        }
      }
    }


    // 最終的に70〜80文字に収束したかどうかで状態を切り替え
    if (!(finalLen >= 70 && finalLen <= 80)) {
      // 収束失敗：「再実行」表示に切り替え
      STORE.optimizeState.needsRetry = true;
      setBadge("70〜80文字に収束しない。「再実行」を押すか手動調整してください。");
    } else {
      // 収束成功：「最適化」表示に戻す
      STORE.optimizeState.needsRetry = false;
    }

    // 最終ステータスチェック
    const finalStatus = UI.status?.textContent || "";
    const isFinalOk = finalStatus.includes("出品：OK") && !finalStatus.includes("（最適化後）");

    if (STORE.opt.autoMipAfterOptimize && isFinalOk) {
      if (finalLen >= 70 && finalLen <= 80 && finalVero === 0) {
        // ターボモードと重複しないように、ターボモードがOFFの時だけ実行
        if (!STORE.opt.turboListingMode) {
          await sleep(250);
          clickRealMipButton();
        }
      }
    }

  } finally {
    // 成功・失敗・中断に関わらず、必ずフラグと表示をリセットする
    optimizeRunning = false;
    setBusy(false);
  }
}
