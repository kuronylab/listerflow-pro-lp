/* ListerFlow Pro for Yaballe - license.js
   ライセンス・サブスクリプション管理
   ※ store.js, utils.js の後に読み込まれる必要があります
*/

// サーバー同期中フラグ
let isSyncingWithServer = false;

/**
 * ユーザーの利用制限をチェックする
 * 無料プランの場合は1日1回まで。
 * @returns {Promise<boolean>} 実行可能な場合はtrue
 */
async function checkUsageLimit() {
  // 最新のライセンス情報を取得
  await loadLicenseData();

  // 管理者モードなら無条件OK
  if (STORE.license.isAdmin) return true;

  // プランが free 以外なら無制限（Pro/Premium等）
  if (STORE.license.plan !== "free") return true;

  const now = new Date();
  const today = now.toISOString().split('T')[0];

  // 日付チェック
  if (STORE.license.lastUsedDate !== today) {
    console.log('[LFP] 日付が変わったため、使用回数をリセットします');
    await loadLicenseData();
  }

  // アカウント別のカウントを取得
  const email = getYaballeCurrentEmail();
  const licData = await chrome.storage.local.get(['lfp_license_v1']);
  const license = licData?.lfp_license_v1 || {};
  if (!license.usageCounts) license.usageCounts = {};

  const currentUsage = email ? (license.usageCounts[email] || 0) : STORE.license.usageCount;

  // 制限チェック
  if (currentUsage >= (STORE.license.dailyLimit || 2)) {
    await showSubscriptionAlert();
    return false;
  }

  return true;
}

/**
 * 利用回数をカウントアップして保存する
 */
async function incrementUsageCount() {
  console.log('[LFP] incrementUsageCount called. Plan:', STORE.license.plan);

  const email = getYaballeCurrentEmail();
  const now = new Date();
  const today = now.toISOString().split('T')[0];
  STORE.license.lastUsedDate = today;

  // 統一オブジェクトを更新
  const licData = await chrome.storage.local.get(['lfp_license_v1']);
  const license = licData?.lfp_license_v1 || { plan: "free" };

  if (!license.usageCounts) license.usageCounts = {};

  if (email) {
    license.usageCounts[email] = (license.usageCounts[email] || 0) + 1;
    STORE.license.usageCount = license.usageCounts[email];
    console.log(`[LFP] Account: ${email}, Usage count incremented to:`, STORE.license.usageCount);
  } else {
    STORE.license.usageCount++;
    license.usageCount = STORE.license.usageCount;
  }

  license.lastUsedDate = today;
  license.lastResetDate = Date.now();
  license.dailyLimit = Math.max(license.dailyLimit || 0, 2);

  await chrome.storage.local.set({
    'lfp_license_v1': license,
    'lfp_usage_count': STORE.license.usageCount, // 互換性のために最新値を保存
    'lfp_last_used_date': today
  });
  console.log('[LFP] Usage count saved to storage for current account');

  // ポップアップなどのUIを同期
  chrome.runtime.sendMessage({ type: "LFP_SYNC_REQUEST" });
}

/**
 * サブスクリプション購入を促すアラートを表示する
 */
async function showSubscriptionAlert() {
  const msg = `【無料版の制限】 本日の「AIタイトル最適化」の利用回数制限に達しました。\n\nListerFlow Pro にアップグレードすると、無制限に「爆速出品」を継続できます。1つ1つの地道な作業から解放されませんか？`;
  const confirmed = await showLfpConfirm(msg, "1日2回無料トライアル終了");
  if (confirmed) {
    if (!isExtensionContextValid()) {
      alert("拡張機能が更新されたため、コンテキストが無効になりました。ページをリロードしてからもう一度お試しください。");
      return;
    }
    // 購入ページへ誘導
    window.open(chrome.runtime.getURL("src/pages/purchase.html"), "_blank");
  }
}

/**
 * サーバー(GAS)と通信して、このYaballe店舗のアカウント状態（トライアル開始日など）を同期する
 */
async function syncTrialStatusWithServer(email) {
  if (!email || !isExtensionContextValid() || isSyncingWithServer) return;

  // 最後に同期したメールアドレスを取得
  const lastSyncData = await chrome.storage.local.get(['lfp_last_sync_email', 'lfp_last_server_sync']);
  const lastEmail = lastSyncData.lfp_last_sync_email;
  const lastSync = lastSyncData.lfp_last_server_sync || 0;

  const nowTs = Date.now();
  // メールアドレスが変わっておらず、かつ最後に同期してから60秒以内ならスキップ
  if (email === lastEmail && nowTs - lastSync < 60000) return;

  isSyncingWithServer = true;
  try {
    console.log(`[LFP] バックグラウンド経由でアカウント状態を問い合わせ中... (${email})`);

    // 背景経由でGASにリクエストを送る（SendMessage自体にタイムアウトを設ける）
    const sendMessagePromise = chrome.runtime.sendMessage({
      type: "LFP_LICENSE_SERVER_REQUEST",
      payload: { action: "check_trial", email: email }
    });

    // background.js側で最大2回（約26秒×2）のリトライを行うため、
    // ここでの待機時間は余裕を持たせて60秒に設定
    const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('タイムアウト(60s)')), 60000));

    const response = await Promise.race([sendMessagePromise, timeoutPromise]);

    if (!response || !response.ok) {
      throw new Error(response?.error || 'サーバー通信失敗');
    }

    const result = response.data;
    if (result.status === 'success') {
      console.log('[LFP] サーバー同期完了:', result);

      // 1. トライアル開始日の同期
      if (result.trialStartDate) {
        await chrome.storage.local.set({
          'lfp_pro_trial_start_date': result.trialStartDate,
          'lfp_last_server_sync': nowTs,
          'lfp_last_sync_email': email // 同期したアカウントを記録
        });
        STORE.license.proTrialStartDate = result.trialStartDate;
        // 残り日数を再計算
        updateTrialDaysLeft(result.trialStartDate);
      }

      // 2. ライセンス状態（プラン）の同期
      // サーバーから返ってきたプラン・キー情報をローカルに反映させる
      const currentLicData = await chrome.storage.local.get(['lfp_license_v1']);
      const currentLic = currentLicData.lfp_license_v1 || { plan: 'free', usageCount: 0 };
      let changed = false;

      const serverPlan = result.plan || "free";
      const serverKey = result.licenseKey || "";

      if (currentLic.plan !== serverPlan || currentLic.licenseKey !== serverKey) {
        console.log(`[LFP] プラン変更検知: ${currentLic.plan} -> ${serverPlan}`);
        const wasBasic = (currentLic.plan === 'free');
        currentLic.plan = serverPlan;
        currentLic.licenseKey = serverKey;
        changed = true;

        if (serverPlan !== 'free') {
          await checkAndAutoEnable(serverPlan);
        }

        // ★ サブスク失効: Freeに降格した場合、Pro/Premium機能を無効化
        if (serverPlan === 'free' && !wasBasic) {
          console.log('[LFP] サブスク失効を検知。Freeプランに降格します。');
          const optData = await chrome.storage.sync.get(['lfp_options_v1']);
          const opt = optData.lfp_options_v1 || {};
          opt.turboListingMode = false;
          opt.autoMipAfterOptimize = false;
          opt.autoClickOkAfterMip = false;
          opt.showCopyCsvButtons = false;
          STORE.opt.turboListingMode = false;
          await chrome.storage.sync.set({ 'lfp_options_v1': opt });
          // ライセンスキーと初期化実行済フラグをクリア
          currentLic.licenseKey = '';
          // ★ トライアル開始日もクリア（トライアル表示を消す）
          STORE.license.isProTrial = false;
          STORE.license.proTrialDaysLeft = 0;
          STORE.license.proTrialStartDate = null;
          await chrome.storage.local.remove([
            'lfp_pro_trial_start_date',
            'lfp_auto_enabled_plan_pro',
            'lfp_auto_enabled_plan_premium',
            'lfp_auto_enabled_plan_pro-trial',
            'lfp_auto_enabled_plan_pro_trial'
          ]);
        }

      }

      // 常にアカウント別ライセンス辞書を更新して、切り替え時のFreeへのリセットを防ぐ
      const storedDictData = await chrome.storage.local.get(['lfp_licenses_by_account']);
      const dict = storedDictData.lfp_licenses_by_account || {};
      dict[email] = { plan: serverPlan, licenseKey: serverKey };
      await chrome.storage.local.set({ 'lfp_licenses_by_account': dict });

      if (changed) {
        await chrome.storage.local.set({ 'lfp_license_v1': currentLic });
        await chrome.storage.local.set({ 'lfp_license_plan': currentLic.plan });
        STORE.license.plan = currentLic.plan;

        // ★ Premiumに変わった場合、Turboを強制ONにする
        if (serverPlan === 'premium') {
          console.log('[LFP] Premiumプランを同期。TurboをONにします。');
          STORE.opt.turboListingMode = true;
          await chrome.storage.local.remove(['lfp_turbo_auto_disabled']);
          if (email) await chrome.storage.local.remove([`lfp_turbo_auto_disabled_${email}`]);

          const optData = await chrome.storage.sync.get(['lfp_options_v1']);
          const opt = optData.lfp_options_v1 || {};
          opt.turboListingMode = true;
          await chrome.storage.sync.set({ 'lfp_options_v1': opt });
        }

        // UIを即時更新
        if (typeof refreshListingCountUI === 'function') refreshListingCountUI();
      }

      // 3. ★ P4-UI: 解約予定日の同期
      if (result.cancelAt) {
        STORE.license.cancelAt = result.cancelAt;
        await chrome.storage.local.set({ 'lfp_cancel_at': result.cancelAt });
      } else {
        STORE.license.cancelAt = null;
        await chrome.storage.local.remove(['lfp_cancel_at']);
      }

      // 4. ★ P7: 次回請求情報の同期
      if (result.nextBillingDate) {
        STORE.license.nextBillingDate = result.nextBillingDate;
        STORE.license.nextBillingAmount = result.nextBillingAmount;
        await chrome.storage.local.set({
          'lfp_next_billing_date': result.nextBillingDate,
          'lfp_next_billing_amount': result.nextBillingAmount
        });
      } else {
        STORE.license.nextBillingDate = null;
        STORE.license.nextBillingAmount = null;
        await chrome.storage.local.remove(['lfp_next_billing_date', 'lfp_next_billing_amount']);
      }

      // 5. サーバー側で強制終了されている場合への対応
      if (result.isTrialExpired === true) {
        await chrome.storage.local.set({ 'lfp_pro_trial_expired_forced': true });
      }
    }
  } catch (err) {
    const msg = err.message || "";
    // ページ遷移時やバックグラウンド一時中断時のメッセージチャネルエラーは無視する
    if (msg.includes("message channel closed") || msg.includes("Extension context invalidated")) {
      // ログを出さずに終了
    } else {
      console.error('[LFP] syncTrialStatusWithServer error:', {
        message: err.message,
        email: email,
        url: window.location.href,
        timestamp: new Date().toISOString(),
        error: err
      });
    }
  } finally {
    isSyncingWithServer = false;
  }
}

/* ---------- Options / License Data ---------- */

/**
 * トライアル開始日から残り日数と有効フラグを更新する
 */
function updateTrialDaysLeft(startDateStr) {
  try {
    if (!startDateStr) {
      STORE.license.isProTrial = false;
      STORE.license.proTrialDaysLeft = 0;
      return;
    }
    const today = new Date().toISOString().split('T')[0];
    const start = new Date(startDateStr.split('T')[0] + 'T00:00:00');
    const current = new Date(today + 'T00:00:00');

    if (isNaN(start.getTime())) {
      STORE.license.isProTrial = false;
      STORE.license.proTrialDaysLeft = 0;
      return;
    }

    const diffMs = current - start;
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    // 当日を1日目として30日間
    STORE.license.isProTrial = (diffDays >= 0 && diffDays < 30);
    STORE.license.proTrialDaysLeft = Math.max(0, 30 - diffDays);
  } catch (err) {
    console.error('[LFP] updateTrialDaysLeft error:', err);
    STORE.license.isProTrial = false;
    STORE.license.proTrialDaysLeft = 0;
  }
}

async function loadOptions() {
  // エクステンションコンテキストの有効性をチェック
  if (!isExtensionContextValid()) {
    console.log("[LFP] エクステンションコンテキストが無効です。デフォルト設定を使用します。");
    return;
  }

  try {
    const data = await chrome.storage.sync.get([KEY_OPT]);
    const saved = data?.[KEY_OPT];
    if (saved && typeof saved === "object") STORE.opt = { ...STORE.opt, ...saved };

    // ライセンス情報をローカルストレージから読み込み
    await loadLicenseData();
  } catch (err) {
    // エラーメッセージのチェックをより堅牢に
    const errMsg = err.message || "";
    if (errMsg.includes("Extension context invalidated") || errMsg.includes("context_invalidated")) {
      console.log("[LFP] 拡張機能の更新を検知。リカバリーを試行します。");
      attemptRecovery(true);
    } else {
      console.error("[LFP] loadOptions error:", err);
    }
  }
}

/**
 * ライセンス・利用状況データをストレージから読み込む
 * パフォーマンス向上のため、2秒以内の連続呼び出しはキャッシュを返す
 */
let lastLicenseLoadTime = 0;
async function loadLicenseData(force = false) {
  const nowTs = Date.now();
  if (!force && nowTs - lastLicenseLoadTime < 2000) {
    return; // キャッシュを使用
  }
  lastLicenseLoadTime = nowTs;

  try {
    const localData = await chrome.storage.local.get(['lfp_license_v1', 'lfp_license_plan', 'lfp_usage_count', 'lfp_last_used_date', 'lfp_admin_mode', 'lfp_pro_trial_start_date', 'lfp_cancel_at', 'lfp_next_billing_date', 'lfp_next_billing_amount']);

    // 管理者モードフラグ
    STORE.license.isAdmin = localData.lfp_admin_mode === true;

    const now = new Date();
    const today = now.toISOString().split('T')[0];

    // Proトライアルの判定（サーバー同期で設定される。未設定なら非トライアル）
    let trialStartDate = localData.lfp_pro_trial_start_date || null;
    STORE.license.proTrialStartDate = trialStartDate;

    if (trialStartDate) {
      updateTrialDaysLeft(trialStartDate);
    } else {
      // トライアル開始日が未設定 → トライアルではない
      STORE.license.isProTrial = false;
      STORE.license.proTrialDaysLeft = 0;
    }


    // 新しい形式 (lfp_license_v1) を優先
    if (localData.lfp_license_v1) {
      const lic = localData.lfp_license_v1;
      STORE.license.plan = lic.plan || "free";

      const email = getYaballeCurrentEmail();
      if (email && lic.usageCounts && lic.usageCounts[email] !== undefined) {
        STORE.license.usageCount = lic.usageCounts[email];
      } else {
        STORE.license.usageCount = lic.usageCount || 0;
      }

      STORE.license.lastUsedDate = lic.lastUsedDate || "";
      STORE.license.dailyLimit = Math.max(lic.dailyLimit || 0, 2);

      // ★ P4/P7: 解約予定日・請求情報の初期化
      STORE.license.cancelAt = localData.lfp_cancel_at || null;
      STORE.license.nextBillingDate = localData.lfp_next_billing_date || null;
      STORE.license.nextBillingAmount = localData.lfp_next_billing_amount || null;

      // ポップアップ用に現在のアカウントを記録
      if (email) {
        await chrome.storage.local.set({ 'lfp_active_email': email });
      }

    } else {
      if (localData.lfp_license_plan) STORE.license.plan = localData.lfp_license_plan;
      if (typeof localData.lfp_usage_count === 'number') STORE.license.usageCount = localData.lfp_usage_count;
      if (localData.lfp_last_used_date) STORE.license.lastUsedDate = localData.lfp_last_used_date;
      STORE.license.dailyLimit = 2;
    }

    // トライアル期間中かつライセンス未適用の場合はProプランとして扱う
    if (STORE.license.isProTrial && STORE.license.plan === 'free') {
      STORE.license.plan = 'pro-trial';
    }

    // プラン格上げ時の自動ON処理 (一回だけ実行)
    if (STORE.license.plan !== 'free') {
      await checkAndAutoEnable(STORE.license.plan);
    }


    // 日付が変わっていればリセットして保存
    const licToSave = localData.lfp_license_v1 || { plan: 'free' };
    const savedLastDate = licToSave.lastUsedDate || (typeof localData.lfp_last_used_date === 'string' ? localData.lfp_last_used_date : "");

    if (savedLastDate !== today) {
      console.log(`[LFP] 日付が変わりました (${savedLastDate} -> ${today})。回数をリセットします。`);

      licToSave.usageCount = 0;
      licToSave.turboTrialCount = 0; // Turbo回数もリセット
      licToSave.turboTrialCounts = {}; // アカウント別Turbo回数もリセット
      licToSave.lastUsedDate = today;
      licToSave.lastResetDate = Date.now();
      licToSave.dailyLimit = 2;

      STORE.license.usageCount = 0;
      STORE.license.lastUsedDate = today;

      // 前日にTurbo自動無効化されていた場合、ONに戻す
      const autoDisabledData = await chrome.storage.local.get(['lfp_turbo_auto_disabled']);
      if (autoDisabledData.lfp_turbo_auto_disabled) {
        console.log("[LFP] Turbo Trial制限の翌日になったため、Turbo Mode設定を自動でONに戻します");
        const newOpt = Object.assign({}, STORE.opt, { turboListingMode: true });
        STORE.opt.turboListingMode = true;
        await chrome.storage.sync.set({ lfp_options_v1: newOpt });
        await chrome.storage.local.remove(['lfp_turbo_auto_disabled']);
        // ★ アカウント固有のフラグも全てクリア
        const currentEmail = getYaballeCurrentEmail();
        if (currentEmail) {
          await chrome.storage.local.remove([`lfp_turbo_auto_disabled_${currentEmail}`]);
        }
      }

      // ストレージ即時更新
      await chrome.storage.local.set({
        'lfp_license_v1': licToSave,
        'lfp_usage_count': 0,
        'lfp_last_used_date': today
      });
    }

    if (STORE.license.isAdmin) {
      console.log('[LFP] 管理者モードのため全制限を解除しています');
    }

    console.log('[LFP] ライセンス情報を読み込みました:', STORE.license);

    // ★ 現在ログインしているYaballeのアカウント情報を取得・記録 ★
    const currentYaballeEmail = getYaballeCurrentEmail();
    if (currentYaballeEmail) {
      STORE.yaballeEmail = currentYaballeEmail;
      console.log(`[LFP] 現在のYaballe操作アカウントを認識しました: ${currentYaballeEmail}`);

      // サーバーと同期して正確なトライアル日を取得
      syncTrialStatusWithServer(currentYaballeEmail).catch(() => { });

      // ここでバックグラウンドに送信してデータベース側と照合・記録する（今後の開発用）
      chrome.runtime.sendMessage({
        type: "LFP_YABALLE_ACCOUNT_DETECTED",
        email: currentYaballeEmail
      });
    } else {
      console.log('[LFP] Yaballeの操作アカウントを認識できませんでした');
    }

    // 強制終了フラグの確認
    const forcedExpired = await chrome.storage.local.get(['lfp_pro_trial_expired_forced']);
    if (forcedExpired.lfp_pro_trial_expired_forced) {
      STORE.license.isProTrial = false;
      if (STORE.license.plan === 'pro-trial') STORE.license.plan = 'free';
    }
  } catch (err) {
    if (typeof isContextInvalidatedError === 'function' && isContextInvalidatedError(err)) {
      console.log('[LFP] 拡張機能の更新によりコンテキストが無効化されました (loadLicenseData)');
      if (typeof attemptRecovery === 'function') attemptRecovery(true);
    } else {
      console.error('[LFP] loadLicenseData error:', err);
    }
  }
}

// 設定変更をリッスンしてUIを更新
if (isExtensionContextValid()) {
  chrome.storage.onChanged.addListener((changes, namespace) => {
    // 既にコンテキストが無効な場合は何もしない（エラー出力を防ぐ）
    if (!isExtensionContextValid()) return;

    if (namespace === 'sync' && changes[KEY_OPT]) {
      const newOptions = changes[KEY_OPT].newValue;
      if (newOptions) {
        STORE.opt = { ...STORE.opt, ...newOptions };
        console.log('[LFP] 設定が更新されました:', STORE.opt);
        // ここでUIの更新処理を呼び出す
        updateUIBasedOnSettings();
      }
    }

    // 統計リセットの指示を受け取る
    if (changes[KEY_HIST] && !changes[KEY_HIST].newValue) {
      console.log('[LFP] 履歴がリセットされました');
      refreshHistorySelect(true).catch(() => { });
    }

    // ライセンス情報やトライアル情報の変更を即座に検知してUIを更新
    if (namespace === 'local' && (changes['lfp_license_v1'] || changes['lfp_pro_trial_start_date'])) {
      console.log('[LFP] ライセンス/トライアル情報がローカルストレージで更新されました');
      // ストレージ変更を検知した場合は強制的に再読み込みしてメモリと同期
      loadLicenseData(true).then(() => {
        refreshListingCountUI().catch(() => { });
      });
    }
  });
}

// バックグラウンドからのメッセージを処理
if (isExtensionContextValid()) {
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    // 既にコンテキストが無効な場合は何もしない（エラー出力を防ぐ）
    if (!isExtensionContextValid()) return;

    if (msg.type === 'LFP_RESET_UI') {
      console.log('[LFP] UIリセット指示を受信');
      loadLicenseData().then(() => {
        refreshListingCountUI().catch(() => { });
        refreshHistorySelect(true).catch(() => { });
      });
      return true;
    }
    // バックグラウンドからの同期放送を受信
    if (msg.type === 'LFP_SYNC_UI') {
      loadLicenseData().then(() => {
        refreshListingCountUI().catch(() => { });
      });
      return true;
    }
    // アカウント切り替えを検知 → ライセンス情報を即座にリセット
    if (msg.type === 'LFP_ACCOUNT_CHANGED') {
      console.log('[LFP] アカウント切り替えを検知。ライセンス情報をリセットします。');

      // メモリ上のSTOREを完全リセット
      STORE.license.plan = 'free';
      STORE.license.usageCount = 0;
      STORE.license.isProTrial = false;
      STORE.license.proTrialDaysLeft = 0;
      STORE.license.proTrialStartDate = null;
      STORE.license.licenseKey = '';
      STORE.license.cancelAt = null;
      STORE.license.nextBillingDate = null;
      STORE.license.nextBillingAmount = null;

      // ストレージ上のキャッシュもすべてクリア（古いアカウントのデータを完全消去）
      (async () => {
        await chrome.storage.local.remove([
          'lfp_license_v1',
          'lfp_license_plan',
          'lfp_pro_trial_start_date',
          'lfp_pro_trial_expired_forced',
          'lfp_cancel_at',
          'lfp_next_billing_date',
          'lfp_next_billing_amount',
          'lfp_last_sync_email',      // ★ 同期キャッシュもクリア（60秒スキップを防止）
          'lfp_last_server_sync'
        ]);
        // クリア完了後にライセンスデータを再読み込み（新アカウントでサーバー問い合わせ）
        await loadLicenseData();
        refreshListingCountUI().catch(() => { });
      })();
      return true;
    }
  });
}

/**
 * 指定したプランに対して自動ON処理が未実行なら実行する
 */
async function checkAndAutoEnable(planName) {
  const key = `lfp_auto_enabled_plan_${planName}`;
  const res = await chrome.storage.local.get([key]);
  if (!res[key]) {
    console.log(`[LFP] 新プラン(${planName})への自動化設定を適用します`);
    await autoEnableAllFeatures();
    await chrome.storage.local.set({ [key]: true });
  }
}

/**
 * 有料プラン・トライアル開始時にすべての自動化機能を一括でONにする
 */
async function autoEnableAllFeatures() {
  try {
    const data = await chrome.storage.sync.get([KEY_OPT]);
    const options = data?.[KEY_OPT] || {};

    // 全自動化設定を強制的にONにする
    options.autoGetOnPaste = true;
    options.autoGetOnHistory = true;
    options.autoMipAfterOptimize = true;
    options.autoClickOkAfterMip = true;
    options.quickMipButton = true;
    options.showCopyCsvButtons = true;
    options.turboListingMode = true;
    options.highlightOptimize = true; // ついでに強調表示もON

    await chrome.storage.sync.set({ [KEY_OPT]: options });
    STORE.opt = { ...STORE.opt, ...options };

    console.log('[LFP] すべての自動化機能を有効にしました');

    // UI反映（ボタンの表示など）
    if (typeof updateUIBasedOnSettings === 'function') updateUIBasedOnSettings();
  } catch (err) {
    console.error('[LFP] autoEnableAllFeatures error:', err);
  }
}

async function updateUIBasedOnSettings() {
  // Quick MIPボタンの表示/非表示（設定変更時のみ）
  const quickMipBtn = document.getElementById("lfp-quick-mip");
  if (quickMipBtn) {
    quickMipBtn.style.display = STORE.opt.quickMipButton ? "inline-flex" : "none";
  }

  // 最適化ボタンのハイライト表示
  const optimizeBtn = document.getElementById("optimize-button");
  if (optimizeBtn) {
    if (STORE.opt.highlightOptimize) {
      optimizeBtn.classList.add("highlight");
    } else {
      optimizeBtn.classList.remove("highlight");
    }
  }

  // コピー・CSV出力ボタンの表示制御
  const copyBtn = document.getElementById("lfp-copy-btn-id");
  if (copyBtn) copyBtn.style.display = STORE.opt.showCopyCsvButtons ? "inline-block" : "none";

  const csvBtn = document.getElementById("lfp-csv-btn-id");
  if (csvBtn) csvBtn.style.display = STORE.opt.showCopyCsvButtons ? "inline-block" : "none";

  // 他のUI要素も必要に応じて更新
}

/* ---------- Storage Change Listener ---------- */

/**
 * ストレージの変更を監視し、設定やライセンス情報が変わったらUIに反映させる
 * これによりポップアップでのプラン変更や設定変更が即座にタブに反映される
 */
chrome.storage.onChanged.addListener((changes, areaName) => {
  // エクステンションコンテキストの有効性をチェック（リロード時のエラー抑制）
  if (!isExtensionContextValid()) return;

  if (areaName !== 'sync' && areaName !== 'local') return;

  console.log('[LFP] Storage change detected:', Object.keys(changes));

  const needsOptionReload = changes[KEY_OPT] || changes['lfp_options_v1'];
  const needsLicenseReload = changes['lfp_license_v1'] || changes['lfp_active_email'];

  if (needsOptionReload || needsLicenseReload) {
    console.log('[LFP] Reloading options/license due to storage change...');
    loadOptions().then(() => {
      if (typeof refreshListingCountUI === 'function') refreshListingCountUI();
      if (typeof refreshHistorySelect === 'function') refreshHistorySelect();
      // UIの状態も最新の設定に合わせて再調整
      if (STORE.opt.highlightOptimize && UI.btnOpt) {
        UI.btnOpt.classList.add("highlight");
      }
    }).catch(err => {
      console.warn('[LFP] Error reloading options after storage change:', err);
    });
  }
});
