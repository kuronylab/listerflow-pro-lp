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
  return hash.includes("autolister") || hash.includes("add-items");
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
function showLfpConfirm(message, title = '確認') {
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
    cancelBtn.textContent = 'キャンセル';

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
function showLfpAlert(message, title = 'お知らせ') {
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
  return !!chrome.runtime && !!chrome.runtime.id;
}

// エラーがエクステンションコンテキスト無効によるものか判定
function isContextInvalidatedError(err) {
  const msg = (err && err.message) || (err && err.toString()) || "";
  return msg.includes('Extension context invalidated') || msg.includes('context_invalidated');
}

// エクステンションコンテキスト無効時のリカバリー処理
let recoveryAttempts = 0;
const MAX_RECOVERY_ATTEMPTS = 3;

async function attemptRecovery() {
  if (recoveryAttempts >= MAX_RECOVERY_ATTEMPTS) {
    console.warn("[LFP] リカバリー試行回数上限に達しました。ページをリロードします。");
    alert("拡張機能が更新されました。最新の状態を反映するため、ページを再読み込みしてください。");
    window.location.reload();
    return false;
  }

  recoveryAttempts++;
  console.log(`[LFP] 拡張機能が更新された可能性があるためリカバリーを試行中 (${recoveryAttempts}/${MAX_RECOVERY_ATTEMPTS})`);

  // 全てのフラグをリセット
  resetAllFlags();

  // Observerを再初期化
  observersInitialized = false;

  // 少し待ってから再初期化
  await sleep(500);

  if (isExtensionContextValid()) {
    console.log("[LFP] エクステンションコンテキストが復活しました");
    recoveryAttempts = 0;
    scheduleInit();
    return true;
  }

  return false;
}

// 全ての実行フラグをリセット
function resetAllFlags() {
  evalRunning = false;
  initRunning = false;
  optimizeRunning = false;
  historyLock = false;
  // okButtonClicked = false; // ASIN変更時以外はリセットしない（二重表示防止）
  uiUnlocked = false; 

  // setIntervalをクリア
  if (okButtonCheckInterval) {
    clearInterval(okButtonCheckInterval);
    okButtonCheckInterval = null;
  }

  // 掃討モード終了
  stopAggressiveCleaner();

  console.log("[LFP] 内部フラグをリセットしました（オートメーション記憶は維持）");
}
