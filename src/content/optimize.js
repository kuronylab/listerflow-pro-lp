/* ListerFlow Pro – Evaluate / Optimize
   ※ utils.js (normSpace, sleep), vero.js (extractWarningBlockText 等),
   ※ dom-helpers.js (findLabelInput, readText, setInputValue, findButtonByText),
   ※ openai.js (callOpenAI, buildOptimizePrompt),
   ※ content.js (UI, STORE, setBusy, setBadge, setStatusLine, ensureUIBelowTitle,
   ※            ensureQuickMipButton, clickRealMipButton, resetUIState等) に依存
*/

/* ---------- Evaluate / Optimize ---------- */

async function evaluateAndRender({ titleEl, btnGet }) {
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
  if (titleTerms.length > 0) {
    const currentTitleLower = (title || "").toLowerCase();
    const veroWords = titleTerms.map(t => t.term.toLowerCase());

    // ハイリスク・キーワードの定義（単体で残っているだけで警戒が必要なもの）
    const highRiskKeywords = ["nintendo", "playstation", "sony", "microsoft", "apple", "disney", "grinch", "pokemon", "lego"];

    // 判定用：一つでもハイリスク語が含まれているか
    const containsHighRisk = veroWords.some(word => highRiskKeywords.includes(word));

    // すべてのVero単語がタイトルに「単語として」含まれているかチェック（判定用）
    const allVeroWordsPresent = veroWords.every(word => {
      const esc = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const re = new RegExp(`\\b${esc}\\b`, "i");
      return re.test(currentTitleLower);
    });

    // 一部のVero単語が残っているかチェック
    const someVeroWordsPresent = veroWords.some(word => {
      const esc = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const re = new RegExp(`\\b${esc}\\b`, "i");
      return re.test(currentTitleLower);
    });

    // Yaballe公式ルール：「FOR」「COMPATIBLE WITH」「FITS」があれば許容
    const hasCompatibilityPhrase = /\b(for|compatible\s+with|fits)\b/i.test(currentTitleLower);

    if (containsHighRisk) {
      // ハイリスク語が含まれる場合：一つでも残っていればNG
      if (someVeroWordsPresent) {
        hasTitleVeroWarning = true;
        console.log(`⚠️ [Vero Title] ハイリスク語が残っています: ${veroWords.join(', ')}`);
      } else {
        hasTitleVeroWarning = false;
        console.log(`✅ [Vero Title] ハイリスク語がすべて削除されました。`);
      }
    } else {
      // 通常のキーワードの場合
      if (allVeroWordsPresent) {
        if (hasCompatibilityPhrase) {
          hasTitleVeroWarning = false;
          console.log(`✅ [Vero Title] 互換性表現あり。VeRO単語: ${veroWords.join(', ')}`);
        } else {
          hasTitleVeroWarning = true;
          console.log(`⚠️ [Vero Title] すべてのVero単語が残っており、互換性表現なし: ${veroWords.join(', ')}`);
        }
      } else {
        hasTitleVeroWarning = false;
        console.log(`✅ [Vero Title] 一部またはすべてのVero単語が削除されました。`);
      }
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

      // 点滅防止: 一度有効になったボタンを無効に戻さない（新しいASIN取得時にresetAllFlagsでリセット済み）
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

// optimizeRunning は STORE.state に移行

async function onOptimizeClick({ titleEl }) {
  if (STORE.state.optimizeRunning) return;
  STORE.state.optimizeRunning = true;

  try {
    // 1. 利用制限チェック（Basicプランは1日2回に増加）
    const canExecute = await checkUsageLimit();
    if (!canExecute) return;

    // すでに出品中（MIP後）なら一切動作させない
    if (STORE.turboExecuted.mip) return;

    try {
      await loadOptions();
    } catch(e) {
      if (typeof isContextInvalidatedError === 'function' && isContextInvalidatedError(e)) {
        throw e; // Throw to the top-level catch
      }
      // Other loadOptions errors can be handled here if needed, or rethrown
      console.error('[LFP] Error loading options:', e);
      setBadge("設定の読み込みに失敗しました。");
      return;
    }

    if (!STORE.opt.apiKey) {
      setBadge("API key未設定");
      ensureUIBelowTitle(titleEl);
      return; // Exit if no API key
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
        if (typeof isContextInvalidatedError === 'function' && isContextInvalidatedError(e)) {
          setBadge("拡張機能が更新されました。再読み込みしてください。");
          throw e; // Top-level catchへ
        }
        return; // Exit the function
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
              finalVero = STORE.opt.veroEnabled ? countVeroInText(finalTitle, allMatchers) : 0;
              STORE.optimizeState.lastOutputs.push(finalTitle);
              if (STORE.optimizeState.lastOutputs.length > 5) STORE.optimizeState.lastOutputs.shift();
              setInputValue(titleEl, finalTitle);
              await sleep(120);
              await evaluateAndRender({ titleEl, btnGet });
            }
          } catch (e) {
            console.error('[LFP] Veroリトライ中のAPIエラー:', e);
            if (typeof isContextInvalidatedError === 'function' && isContextInvalidatedError(e)) {
              throw e; // Throw to the top-level catch
            }
            // Other API errors during retry should break the retry loop
            setBadge("Veroリトライ中にAPIエラーが発生しました。");
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
          console.log("[LFP] オプションON: 最適化後の自動MIPを実行します");
          await sleep(250);
          clickRealMipButton();
        }
      }
    }

  } catch (err) {
    if (typeof isContextInvalidatedError === 'function' && isContextInvalidatedError(err)) {
      console.log('[LFP] 拡張機能の更新を確認。リカバリーを開始します。 (onOptimizeClick)');
      if (typeof attemptRecovery === 'function') attemptRecovery(true);
    } else {
      console.error('[LFP] onOptimizeClick error:', err);
    }
  } finally {
    // 成功・失敗・中断に関わらず、必ずフラグと表示をリセットする
    STORE.state.optimizeRunning = false;
    setBusy(false);
  }
}
