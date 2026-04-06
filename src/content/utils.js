/* ListerFlow Pro for Yaballe - utils.js
   汎用ユーティリティ関数（他モジュールから広く使われる基盤関数群）
   ※ store.js の後に読み込まれる必要があります
*/

// ストレージキー定数
const KEY_OPT = "lfp_options_v1";
const KEY_HIST = "lfp_asin_history_v1";

// 出品自動化およびOKボタン自動クリックの実行判定フラグ（ファイル全体で共有し、ASIN変更時のみリセット）
let okButtonClicked = false;
let listingCounted = false;

/* ---------- 基本ユーティリティ ---------- */

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function normSpace(s) { return (s || "").replace(/\s+/g, " ").trim(); }
function lc(s) { return (s || "").toLowerCase(); }
function now() { return Date.now(); }
function isListerRoute() {
  const hash = (location.hash || "").toLowerCase();
  // 'lister' が含まれていればリスター関連ページとみなす（より広範にカバー）
  return hash.includes("lister") || hash.includes("autolister") || hash.includes("add-items");
}

/* ---------- DOM コンテナ検出 ---------- */

/**
 * 監視対象となるメインコンテンツコンテナを特定する
 * 適切なコンテナが見つからない場合は document.body を返す
 */
function getContentContainer() {
  // Yaballeの構成に応じた主要なコンテナセレクタ
  const selectors = [
    'ui-view',           // Angular UI-Router (Yaballeでよく使われる)
    '[ui-view]',
    'md-content',        // Angular Material
    '.md-content',
    '#main-wrapper',
    'main',
    'div[role="main"]',
    '.main-content',
    '.content-wrapper',
    'section#content',
    '#inner-content',
    '[ng-view]'          // Angular standard router
  ];

  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el && el.isConnected) return el;
  }

  // フォールバック
  return document.body;
}

/**
 * モーダル等のオーバーレイが表示されるコンテナを特定する
 * Angular Materialではbody直下の .cdk-overlay-container に配置されることが多い
 */
function getOverlayContainer() {
  return document.querySelector('.cdk-overlay-container') || document.body;
}

/* ---------- Yaballeアカウント検出 ---------- */

/**
 * 現在ログインしているYaballeのアカウントのメールアドレスを取得する
 * @returns {string|null} メールアドレス、見つからない場合はnull
 */
function getYaballeCurrentEmail() {
  let email = null;
  const emailPattern = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;

  try {
    // 1. まずローカルストレージの PostHog データから抽出を試みる（最も安定）
    const lsKeys = Object.keys(localStorage);
    for (const key of lsKeys) {
      if (key.includes('posthog')) {
        const val = localStorage.getItem(key);
        if (val) {
          const parsed = JSON.parse(val);
          // distinct_id にメールアドレスが入っていることが多い
          if (parsed.distinct_id && emailPattern.test(parsed.distinct_id)) {
            email = parsed.distinct_id;
            break;
          }
          // e/user.email などを探す
          const strVal = JSON.stringify(parsed);
          const matches = strVal.match(emailPattern);
          if (matches && matches.length > 0) {
            email = matches[0];
            break;
          }
        }
      }
    }

    // 2. もしローカルストレージで見つからなければ、DOM上のテキストから探す
    if (!email) {
      const pageText = document.body.innerText || "";
      const matches = pageText.match(emailPattern);
      if (matches && matches.length > 0) {
        // 余分なメアド（サポートなど）を除外し、表示されているユーザー自身のメアドらしきものを採用する
        const uniqueEmails = [...new Set(matches)];
        email = uniqueEmails.find(e => !e.includes('support') && !e.includes('info')) || uniqueEmails[0];
      }
    }
  } catch (e) {
    console.warn('[LFP] Yaballeメールアドレスの取得でエラー:', e);
  }

  return email;
}

/* ---------- カスタムモーダル ---------- */

/**
 * カスタム確認モーダルを表示する（ブラウザ標準のconfirm()の代替）
 * 中央からポンと出現するアニメーション付き
 * @param {string} message - 確認メッセージ
 * @param {string} [title] - モーダルのタイトル（省略時は"確認"）
 * @returns {Promise<boolean>} ユーザーの選択結果
 */
function showLfpConfirm(message, title = chrome.i18n.getMessage("uiConfirmDefault")) {
  return new Promise((resolve) => {
    // 既存のオーバーレイがあれば削除
    const existing = document.querySelector('.lfp-confirm-overlay');
    if (existing) existing.remove();

    // オーバーレイを作成
    const overlay = document.createElement('div');
    overlay.className = 'lfp-confirm-overlay';

    // ダイアログ本体
    const dialog = document.createElement('div');
    dialog.className = 'lfp-confirm-dialog';

    // ヘッダー
    const header = document.createElement('div');
    header.className = 'lfp-confirm-header';
    const h3 = document.createElement('h3');
    h3.textContent = title;
    header.appendChild(h3);

    // ボディ
    const body = document.createElement('div');
    body.className = 'lfp-confirm-body';
    const p = document.createElement('p');
    p.textContent = message;
    body.appendChild(p);

    // フッター（ボタン）
    const footer = document.createElement('div');
    footer.className = 'lfp-confirm-footer';

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'lfp-confirm-btn cancel';
    cancelBtn.textContent = chrome.i18n.getMessage("uiCancel");

    const okBtn = document.createElement('button');
    okBtn.className = 'lfp-confirm-btn ok';
    okBtn.textContent = 'OK';

    footer.appendChild(cancelBtn);
    footer.appendChild(okBtn);

    dialog.appendChild(header);
    dialog.appendChild(body);
    dialog.appendChild(footer);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    // モーダルを閉じる共通処理
    const close = (result) => {
      overlay.style.opacity = '0';
      dialog.style.transform = 'scale(0.9)';
      dialog.style.opacity = '0';
      dialog.style.transition = 'all 0.12s ease-in';
      setTimeout(() => {
        overlay.remove();
        resolve(result);
      }, 120);
    };

    // 表示アニメーション（次フレームでactiveクラスを付与）
    requestAnimationFrame(() => {
      overlay.classList.add('active');
    });

    cancelBtn.addEventListener('click', () => close(false));
    okBtn.addEventListener('click', () => close(true));

    // オーバーレイクリックでキャンセル
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close(false);
    });
  });
}

/**
 * カスタム通知モーダルを表示する（ブラウザ標準のalert()の代替）
 * 中央からポンと出現するアニメーション付き
 * @param {string} message - 通知メッセージ
 * @param {string} [title] - モーダルのタイトル（省略時は"お知らせ"）
 * @returns {Promise<void>} OKボタンが押されたら解決
 */
function showLfpAlert(message, title = chrome.i18n.getMessage("uiAlertDefault")) {
  return new Promise((resolve) => {
    // 既存のオーバーレイがあれば削除
    const existing = document.querySelector('.lfp-confirm-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.className = 'lfp-confirm-overlay';

    const dialog = document.createElement('div');
    dialog.className = 'lfp-confirm-dialog';

    const header = document.createElement('div');
    header.className = 'lfp-confirm-header';
    const h3 = document.createElement('h3');
    h3.textContent = title;
    header.appendChild(h3);

    const body = document.createElement('div');
    body.className = 'lfp-confirm-body';
    const p = document.createElement('p');
    p.textContent = message;
    body.appendChild(p);

    const footer = document.createElement('div');
    footer.className = 'lfp-confirm-footer';

    const okBtn = document.createElement('button');
    okBtn.className = 'lfp-confirm-btn ok';
    okBtn.style.borderRight = 'none';
    okBtn.textContent = 'OK';
    footer.appendChild(okBtn);

    dialog.appendChild(header);
    dialog.appendChild(body);
    dialog.appendChild(footer);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    const close = () => {
      overlay.style.opacity = '0';
      dialog.style.transform = 'scale(0.9)';
      dialog.style.opacity = '0';
      dialog.style.transition = 'all 0.12s ease-in';
      setTimeout(() => {
        overlay.remove();
        resolve();
      }, 120);
    };

    requestAnimationFrame(() => {
      overlay.classList.add('active');
    });

    okBtn.addEventListener('click', close);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });
  });
}

/* ---------- エクステンションコンテキスト ---------- */

// エクステンションコンテキストの有効性チェック
function isExtensionContextValid() {
  try {
    // chrome.runtime.id だけでは不十分な場合があるため、
    // 実際にAPI（getURL等）を呼び出して例外が起きないか確認する
    return !!(chrome.runtime && chrome.runtime.id && chrome.runtime.getURL(''));
  } catch (e) {
    return false;
  }
}

// エラーがエクステンションコンテキスト無効によるものか判定
function isContextInvalidatedError(err) {
  const msg = (err && err.message) || (err && err.toString()) || "";
  return msg.includes('Extension context invalidated') || msg.includes('context_invalidated');
}

// エクステンションコンテキスト無効時のリカバリー処理
let recoveryAttempts = 0;
const MAX_RECOVERY_ATTEMPTS = 3;
let isReloadingPending = false;

async function attemptRecovery(forceReload = false) {
  if (isReloadingPending) return false;

  // コンテキストが無効化された場合は復旧不可能なので即座にリロード
  if (forceReload || !isExtensionContextValid() || recoveryAttempts >= MAX_RECOVERY_ATTEMPTS) {
    isReloadingPending = true;
    console.log("[LFP] 拡張機能の更新を確認しました。最新バージョンを適用するための準備をします。");
    // 確認なしで強制リロードするとユーザーが入力中のデータを失うため、alertで通知する
    const msg = "拡張機能の最新バージョンが読み込まれました。\n\n" +
                "動作を安定させるため、OKを押して画面を再読み込みしてください。\n" +
                "(※複数のタブを開いている場合は、それぞれのタブで再読み込みが必要です)";
    alert(msg);
    window.location.reload();
    return false;
  }

  recoveryAttempts++;
  console.log(`[LFP] リカバリーを試行中 (${recoveryAttempts}/${MAX_RECOVERY_ATTEMPTS})`);

  // 全てのフラグをリセット
  resetAllFlags();

  // Observerを再初期化
  if (typeof STORE !== 'undefined') {
    STORE.state.observersInitialized = false;
  }

  // 少し待ってから再初期化
  await sleep(500);

  if (isExtensionContextValid()) {
    console.log("[LFP] エクステンションコンテキストが復活しました");
    recoveryAttempts = 0;
    if (typeof scheduleInit === 'function') scheduleInit();
    return true;
  }

  return false;
}

// 全ての実行フラグをリセット（ページ遷移・ヘルスチェック用の完全リセット）
function resetAllFlags() {
  historyLock = false;

  if (typeof STORE !== 'undefined') {
    // 実行状態フラグをリセット
    STORE.state.evalRunning = false;
    STORE.state.initRunning = false;
    STORE.state.optimizeRunning = false;
    STORE.state.uiUnlocked = false;

    // オートメーション状態をリセット
    STORE.turboExecuted.mip = false;
    STORE.turboExecuted.optimizeCount = 0;
    STORE.optimizeState.needsRetry = false;
    STORE.optimizeState.lastOutputs = [];
    // 注意: STORE.lastRequestedAsin はリセットしない
    // ペーストハンドラーで先にセットされた後に呼ばれるため、クリアすると競合する
  }

  // 自動クリック中フラグをリセット
  okButtonClicked = false; 
  listingCounted = false;

  // UI要素もリセット（resetUIStateと同等のUI初期化）
  if (typeof UI !== 'undefined') {
    if (typeof setBadge === 'function') setBadge("");
    if (UI.btnOpt) {
      UI.btnOpt.disabled = false;
      if (UI.btnLabel) UI.btnLabel.textContent = chrome.i18n.getMessage("uiOptimize");
      if (UI.spin) UI.spin.style.display = "none";
    }
    if (UI.status) {
      UI.status.textContent = `${chrome.i18n.getMessage("uiCharacters")}：- / ${chrome.i18n.getMessage("uiVero")}：- / ${chrome.i18n.getMessage("uiListing")}：-`;
    }
    if (UI.quickMipBtn) UI.quickMipBtn._wasEnabled = false;
  }

  // setIntervalをクリア
  if (okButtonCheckInterval) {
    clearInterval(okButtonCheckInterval);
    okButtonCheckInterval = null;
  }

  // 掃討モード終了
  if (typeof stopAggressiveCleaner === 'function') {
    stopAggressiveCleaner();
  }

  console.log("[LFP] 全ての内部フラグとオートメーション状態を完全にリセットしました");
}
