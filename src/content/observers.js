/* ListerFlow Pro – Modal Observer (エラー/成功モーダル監視)
   ※ store.js (STORE, noListingsObserver, listingSuccessObserver, okButtonCheckInterval) に依存
   ※ utils.js (okButtonClicked, listingCounted) に依存
   ※ content.js の refreshHistorySelect, updateHistoryFlags,
   ※ incrementListingCount, checkAndIncrementTurboCount, getOverlayContainer に依存
*/

/* ---------- Modal Observer ---------- */
/* 変数は store.js (noListingsObserver, listingSuccessObserver, okButtonCheckInterval) と
   utils.js (okButtonClicked, listingCounted) で宣言済み */

/* ---------- Error Modal Handler ---------- */

function handlePotentialErrorModal(modal) {
  if (!modal || modal.dataset.lfpModal || modal.dataset.lfpHandled) return false;

  const modalText = modal.textContent || '';

  // 1. エラーの種類を特定
  const isNoListings = /no listings for this product in amazon|could not fetch details/i.test(modalText);
  const isNoItem = /no item found in Amazon/i.test(modalText);
  const isAlreadyListed = /already listed|already monitored|Duplications are not possible/i.test(modalText);

  if (isAlreadyListed || isNoListings || isNoItem) {
    // 処理済みマークと出現時刻を付与
    modal.dataset.lfpHandled = "1";
    if (!modal.dataset.lfpCreatedAt) {
      modal.dataset.lfpCreatedAt = Date.now().toString();
    }
    console.log(`⚠️ [LFP] エラーモーダルを検知: Listed=${isAlreadyListed}, NoListings=${isNoListings}, NoItem=${isNoItem}`);

    // 2. 履歴フラグを更新
    if (STORE.lastRequestedAsin) {
      updateHistoryFlags(STORE.lastRequestedAsin, {
        already_listed: isAlreadyListed,
        no_listings: isNoListings,
        no_item: isNoItem,
        protected: false,
        brand: false
      }).then(() => refreshHistorySelect(true));
    }

    // 3. 自動クローズ処理
    // ターボリストモード、または自動Get Item設定（貼り付け/履歴）がONの場合は自動で閉じる

    const isAutoMode = STORE.opt.turboListingMode || STORE.opt.autoGetOnPaste || STORE.opt.autoGetOnHistory;

    if (isAutoMode) {
      // 現在のASINと時刻を確認
      const currentAsin = STORE.lastRequestedAsin;
      const now = Date.now();
      const isRecurrent = (currentAsin === STORE.errorHandling.lastAsin) &&
        (now - STORE.errorHandling.timestamp < 5000); // 5秒以内の再発は同一とみなす（短縮して精度向上）

      if (isRecurrent) {
        console.log('🔥 [LFP] エラー再発（ゾンビ）を検知: 待機なしで即座に焼却します');
        // 待機なしで即座に閉じる試行
        attemptCloseErrorModal(modal);
      } else {
        console.log('✅ [LFP] 初回エラー検知: 1秒後に処理を開始します');

        // 状態を更新
        STORE.errorHandling.lastAsin = currentAsin;
        STORE.errorHandling.timestamp = now;

        // 1.5秒後に実行
        setTimeout(() => {
          // ボタンを探してクリック
          attemptCloseErrorModal(modal);
          // 以降、5秒間は掃討モード（定期監視）に入り、復活するモーダルを潰し続ける
          startAggressiveCleaner();
        }, 1500);
      }
    }
    return true;
  }
  return false;
}

/**
 * モーダル内のクローズボタン/OKボタンを探してクリックする
 */
function attemptCloseErrorModal(modalOrDocument) {
  // モーダル自体が渡されていない場合はdocumentから探す
  const root = modalOrDocument || document;

  const closeBtn = Array.from(root.querySelectorAll('.modal button, [role="dialog"] button, .cdk-overlay-pane button, button[class*="close"], [role="button"]')).find(btn => {
    // 保護ロジック: 出現から1.5秒経っていないモーダル内のボタンは（掃討モードからは）無視する
    const modalParent = btn.closest('.modal, [role="dialog"], .cdk-overlay-pane');
    if (modalParent && modalParent.dataset.lfpCreatedAt) {
      const age = Date.now() - parseInt(modalParent.dataset.lfpCreatedAt);
      if (age < 1400) return false; // 1.4秒の安全マージン
    }

    return /ok|確定|確認|閉じる|close|×|キャンセル|cancel|got it/i.test(btn.textContent.trim()) ||
      btn.classList.contains('close') ||
      /close|dismiss/i.test(btn.getAttribute('aria-label') || '') ||
      btn.querySelector('i.fa-times, .close-icon');
  });

  if (closeBtn && closeBtn.isConnected) {
    console.log('💥 [LFP] エラークローズ実行');
    closeBtn.click();
    return true;
  }
  return false;
}

/**
 * 積極的クローズ機能（掃討モード）
 * エラー発生後の数秒間、定期的にボタンを探してクリックし続ける
 */
function startAggressiveCleaner() {
  stopAggressiveCleaner(); // 既存のものをクリア

  console.log('🧹 [LFP] 掃討モード開始（5秒間）');
  let count = 0;

  STORE.errorHandling.cleanerInterval = setInterval(() => {
    count++;
    // DOM全体からエラーっぽいモーダルのボタンを探して押す
    const hit = attemptCloseErrorModal(document);
    if (hit) console.log(`🧹 [LFP] 掃討ヒット (${count})`);

    if (count >= 10) { // 500ms * 10 = 5秒
      stopAggressiveCleaner();
    }
  }, 500);
}

function stopAggressiveCleaner() {
  if (STORE.errorHandling.cleanerInterval) {
    clearInterval(STORE.errorHandling.cleanerInterval);
    STORE.errorHandling.cleanerInterval = null;
  }
}

/* ---------- No Listings Observer ---------- */

function setupNoListingsObserver() {
  if (noListingsObserver) return; // 既に初期化済み
  noListingsObserver = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.addedNodes.length === 0) continue;
      for (const node of mutation.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;

        // モーダルの検出（Yaballeのモーダル構造を想定）
        const modal = node.matches('.modal, [role="dialog"], .cdk-overlay-pane') ? node : node.querySelector('.modal, [role="dialog"], .cdk-overlay-pane');
        if (modal) {
          handlePotentialErrorModal(modal);
        }
      }
    }
  });

  const container = document.body;
  console.log(`[LFP] Error Observer を開始します: 全体`);
  noListingsObserver.observe(container, {
    childList: true,
    subtree: true
  });
}

/* ---------- Listing Success Observer ---------- */

// ★ checkAndIncrementTurboCount は content.js に定義済み

/**
 * 成功モーダルの検知と自動処理（カウント・OKクリック）の統合関数
 */
function handlePotentialSuccessModal(modal) {
  if (!modal || modal.dataset.lfpModal || modal.dataset.lfpHandled) return false;

  const modalText = modal.textContent || '';
  // 成功を意味するキーワードを幅広く検知
  const isListingSuccess = /Listing Success|Success|Listed|完了|成功/i.test(modalText);

  if (isListingSuccess) {
    // 処理済みマークを速やかに付与
    modal.dataset.lfpHandled = "1";

    // 1. カウント処理（未カウントの場合のみ）
    if (!listingCounted) {
      listingCounted = true;
      console.log('✅ [LFP] 成功モーダルを検知: カウントを実行します');
      
      try {
        if (typeof incrementListingCount === 'function') {
          incrementListingCount();
        }
      } catch(e) {}

      // ★ Turbo Mode の試用カウントを加算する（ターボ動作済の場合のみ）
      // 条件を緩和：ターボモードがONで、自動最適化または自動MIPが1回でも走っていればカウント
      if (STORE.opt.turboListingMode && (STORE.turboExecuted.optimizeCount > 0 || STORE.turboExecuted.mip)) {
        console.log(`[LFP] Turbo activity detected (Opt:${STORE.turboExecuted.optimizeCount}, MIP:${STORE.turboExecuted.mip}). Incrementing count.`);
        checkAndIncrementTurboCount();
      }

      // 5秒後にフラグをリセット（タイムアウトによるバックアップ）
      setTimeout(() => {
        listingCounted = false;
      }, 5000);
    }

    // 2. OKボタン自動クリック処理（オプションONの場合のみ）
    if (STORE.opt.autoClickOkAfterMip) {
      console.log('✅ [LFP] 成功モーダルを検知: OKボタンを探して自動クリックします');

      // 少し待ってから（DOMの安定とボタンの出現を待つ）検索とクリックを実行
      setTimeout(() => {
        const okButton = Array.from(modal.querySelectorAll('button, [role="button"]')).find(btn =>
          /ok|確定|確認|閉じる|close|success/i.test(btn.textContent.trim()) ||
          btn.classList.contains('btn-primary') // 成功時のメインボタンは大抵primary
        );

        if (okButton && okButton.offsetParent !== null && okButton.isConnected) {
          if (okButtonClicked) return;
          okButtonClicked = true;

          okButton.click();
          console.log('✅ [Auto OK] OKボタンを直接クリックしました');
          if (typeof setBusy === 'function') setBusy(false);

          // 500ms後にフラグをリセット
          setTimeout(() => { okButtonClicked = false; }, 500);
        } else if (!okButtonCheckInterval) {
          // 見つからない場合は既存のインターバル監視にフォールバック（最大3秒）
          let checkCount = 0;
          okButtonCheckInterval = setInterval(() => {
            checkCount++;
            const currentModal = document.querySelector('.modal, [role="dialog"]');
            if (!currentModal || currentModal.dataset.lfpModal) {
              if (checkCount >= 30) {
                clearInterval(okButtonCheckInterval);
                okButtonCheckInterval = null;
              }
              return;
            }
            const currentOk = Array.from(currentModal.querySelectorAll('button, [role="button"]')).find(btn =>
              /ok|確定|確認|閉じる|close/i.test(btn.textContent.trim())
            );
            if (currentOk && currentOk.offsetParent !== null) {
              clearInterval(okButtonCheckInterval);
              okButtonCheckInterval = null;
              if (!okButtonClicked) {
                okButtonClicked = true;
                currentOk.click();
                console.log(`✅ [Auto OK] 監視によりOKボタンを自動クリックしました（${checkCount * 100}ms後）`);
                if (typeof setBusy === 'function') setBusy(false);
                setTimeout(() => { okButtonClicked = false; }, 500);
              }
            } else if (checkCount >= 30) {
              clearInterval(okButtonCheckInterval);
              okButtonCheckInterval = null;
              console.log('⚠️ [Auto OK] OKボタンが3秒以内に見つかりませんでした');
            }
          }, 100);
        }
      }, 150);
    }
    return true;
  }
  return false;
}

function setupListingSuccessObserver() {
  if (listingSuccessObserver) return; // 既に初期化済み
  listingSuccessObserver = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.addedNodes.length === 0) continue;
      for (const node of mutation.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;

        // モーダルの検出
        const modal = node.matches('.modal, [role="dialog"], .cdk-overlay-pane') ? node : node.querySelector('.modal, [role="dialog"], .cdk-overlay-pane');
        if (modal) {
          handlePotentialSuccessModal(modal);
        }
      }
    }
  });

  const container = getOverlayContainer();
  console.log(`[LFP] Success Observer を開始します: ${container === document.body ? '全体' : '.cdk-overlay-container'}`);
  listingSuccessObserver.observe(container, {
    childList: true,
    subtree: true
  });
}
