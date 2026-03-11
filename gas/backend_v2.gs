/**
 * ListerFlow Pro - Backend (Google Apps Script) 【v2: サブスクリプション完全同期版】
 * 
 * ■ 主な機能:
 *   - トライアル即時記録（P2）
 *   - 支払い遅延時の猶予期間（P1）
 *   - 解約予定日の自動記録（P4）
 *   - プラン変更・二重サブスク防止（P3, P9）
 *   - 次回請求情報の取得（P7）
 */

const LICENSES_SHEET   = 'Licenses';
const STORES_SHEET     = 'Stores';
const TRIAL_USED_SHEET = 'TrialUsed';

// ★ スプレッドシートID（どのGoogleアカウントからでも確実に同じシートを参照するために必須）
const SPREADSHEET_ID = '1pe944tuOR4xL1S-8vRO6aNEqQw40g3zK5pS0j0WSflw';

function getSpreadsheet() {
  return SpreadsheetApp.openById(SPREADSHEET_ID);
}

// Stripe カスタマーポータル URL
const CUSTOMER_PORTAL_URL = 'https://billing.stripe.com/p/login/00waEYe6X2BC87f7yt63K00';

// トライアル日数
const TRIAL_DAYS = 30;

// Checkout 完了後のリダイレクト先
const SUCCESS_URL = 'https://app.yaballe.com/#/autolister?lfp_checkout=success';
const CANCEL_URL  = 'https://app.yaballe.com/#/autolister?lfp_checkout=cancel';

// ============================================================
//  Stripe API ヘルパー
// ============================================================

function getStripeKey() {
  const key = PropertiesService.getScriptProperties().getProperty('STRIPE_SECRET_KEY');
  if (!key) throw new Error('STRIPE_SECRET_KEY が未設定です');
  return key;
}

function getStripePriceId(plan) {
  const props = PropertiesService.getScriptProperties();
  const id = (plan === 'premium') ? props.getProperty('STRIPE_PREMIUM_PRICE_ID') : props.getProperty('STRIPE_PRO_PRICE_ID');
  if (!id) throw new Error(plan + ' の Price ID が未設定です');
  return id;
}

function createStripeCheckoutSession(params) {
  const stripeKey = getStripeKey();
  const payload = {
    'mode': 'subscription',
    'customer_email': params.customerEmail,
    'line_items[0][price]': params.priceId,
    'line_items[0][quantity]': '1',
    'success_url': SUCCESS_URL,
    'cancel_url': CANCEL_URL,
    'metadata[plan]': params.plan,
    'metadata[yaballe_email]': params.yaballeEmail || '',
    'metadata[trial_included]': params.trialDays ? 'true' : 'false',
    'subscription_data[metadata][plan]': params.plan,
    'subscription_data[metadata][yaballe_email]': params.yaballeEmail || ''
  };

  if (params.trialDays && params.trialDays > 0) {
    payload['subscription_data[trial_period_days]'] = String(params.trialDays);
  }

  const options = {
    method: 'post',
    headers: { 'Authorization': 'Bearer ' + stripeKey },
    payload: payload,
    muteHttpExceptions: true
  };

  const response = UrlFetchApp.fetch('https://api.stripe.com/v1/checkout/sessions', options);
  const result = JSON.parse(response.getContentText());
  if (result.error) {
    throw new Error('Stripe Checkout作成エラー: ' + (result.error.message || JSON.stringify(result.error)));
  }
  return result;
}

/**
 * P7: Stripe API から次回請求情報を取得
 */
function getStripeSubscriptionInfo(subscriptionId) {
  if (!subscriptionId) return null;
  try {
    const secretKey = getStripeKey();
    const response = UrlFetchApp.fetch('https://api.stripe.com/v1/subscriptions/' + subscriptionId, {
      method: 'get',
      headers: { 'Authorization': 'Bearer ' + secretKey },
      muteHttpExceptions: true
    });

    const sub = JSON.parse(response.getContentText());
    if (sub.error) return null;

    return {
      nextBillingDate: sub.current_period_end ? new Date(sub.current_period_end * 1000).toISOString() : null,
      nextBillingAmount: sub.items?.data?.[0]?.price?.unit_amount || null
    };
  } catch (err) {
    return null;
  }
}

// ============================================================
//  シート管理・ユーティリティ
// ============================================================

function getTrialUsedSheet() {
  const ss = getSpreadsheet();
  let sheet = ss.getSheetByName(TRIAL_USED_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(TRIAL_USED_SHEET);
    sheet.appendRow(['Email', 'Used Date', 'Subscription ID', 'Plan']);
  }
  return sheet;
}

function checkTrialUsed(email) {
  if (!email) return false;
  const rows = getTrialUsedSheet().getDataRange().getValues();
  const lowerEmail = email.toLowerCase().trim();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]).toLowerCase().trim() === lowerEmail) return true;
  }
  return false;
}

function markTrialUsed(email, subscriptionId, plan) {
  if (!email || checkTrialUsed(email)) return;
  getTrialUsedSheet().appendRow([email.toLowerCase().trim(), new Date(), subscriptionId || '', plan || 'pro']);
}

function hasActiveSubscription(email) {
  if (!email) return false;
  const sheet = getSpreadsheet().getSheetByName(LICENSES_SHEET);
  if (!sheet) return false;
  const rows = sheet.getDataRange().getValues();
  const lowerEmail = email.toLowerCase().trim();
  for (let i = 1; i < rows.length; i++) {
    const buyerEmail = String(rows[i][2]).toLowerCase().trim();
    const authEmail  = String(rows[i][5]).toLowerCase().trim();
    if ((buyerEmail === lowerEmail || authEmail === lowerEmail) && rows[i][3] === 'active') return true;
  }
  return false;
}

function jsonRes(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/**
 * Webhook リクエストの秘密トークン検証
 * GAS Web App では HTTP ヘッダーにアクセスできないため、
 * URL パラメータ ?secret=<token> で検証する
 * @param {Object} e - doPost のイベントオブジェクト
 * @returns {boolean} 検証成功時 true
 */
function verifyWebhookSecret(e) {
  const secret = PropertiesService.getScriptProperties().getProperty('STRIPE_WEBHOOK_SECRET');
  if (!secret) return true; // 未設定時はスキップ（後方互換）
  return e.parameter && e.parameter.secret === secret;
}

// ============================================================
//  エントリポイント
// ============================================================

function doGet(e) {
  return jsonRes({ status: 'ok', message: 'ListerFlow Pro API v2 is online.' });
}

function doPost(e) {
  if (!e || !e.postData) {
    console.error('[LFP] doPost が引数なしで実行されました（エディタからの実行は不可）');
    return jsonRes({ status: 'error', message: 'No post data' });
  }

  try {
    const contents = e.postData.contents;
    console.log('[LFP] doPost 受信内容:', contents);
    const data = JSON.parse(contents);

    // Stripe Webhook イベントかどうか判定（data.type が存在 = Webhookイベント）
    const isWebhook = !!(data.type && !data.action);
    console.log('[LFP] Webhook判定:', isWebhook);

    // Webhook の場合はシークレット検証
    if (isWebhook && !verifyWebhookSecret(e)) {
      console.error('[LFP] Webhook secret 検証失敗。不正なリクエストを拒否しました。');
      return jsonRes({ status: 'error', message: 'Unauthorized' });
    }

    // Webhook 処理
    if (data.type === 'checkout.session.completed') return handleStripeWebhook(data);
    if (data.type === 'customer.subscription.deleted') return handleSubscriptionDeleted(data);
    if (data.type === 'customer.subscription.updated') return handleSubscriptionUpdated(data);
    if (data.type === 'charge.refunded') return handleChargeRefunded(data);
    if (data.type === 'charge.dispute.created') return handleChargeDispute(data);

    // アクション処理
    if (data.action === 'create_checkout') return handleCreateCheckout(data);
    if (data.action === 'check_trial_eligibility') return handleCheckTrialEligibility(data);
    if (data.action === 'apply_license') return handleApplyLicense(data);
    if (data.action === 'check_trial') return handleCheckTrial(data);
    if (data.action === 'create_portal_session') return handleCreatePortalSession(data);

    return jsonRes({ status: 'error', message: 'Unknown action' });
  } catch (err) {
    console.error('[LFP] doPost error:', err);
    return jsonRes({ status: 'error', message: err.toString() });
  }
}

// ============================================================
//  各種ハンドル関数 (Action)
// ============================================================

function handleCreatePortalSession(data) {
  const email = (data.email || '').toLowerCase().trim();
  if (!email) return jsonRes({ status: 'error', message: 'メールアドレスが指定されていません' });

  try {
    const stripeKey = getStripeKey();
    const searchRes = UrlFetchApp.fetch('https://api.stripe.com/v1/customers?email=' + encodeURIComponent(email) + '&limit=1', {
      headers: { 'Authorization': 'Bearer ' + stripeKey },
      muteHttpExceptions: true
    });
    const customers = JSON.parse(searchRes.getContentText());
    if (customers.error) return jsonRes({ status: 'error', message: '顧客検索に失敗: ' + customers.error.message });
    if (!customers.data?.[0]) return jsonRes({ status: 'error', message: '顧客が見つかりません' });

    const portalRes = UrlFetchApp.fetch('https://api.stripe.com/v1/billing_portal/sessions', {
      method: 'post',
      headers: { 'Authorization': 'Bearer ' + stripeKey },
      payload: { customer: customers.data[0].id, return_url: SUCCESS_URL },
      muteHttpExceptions: true
    });
    const portalData = JSON.parse(portalRes.getContentText());
    if (portalData.error) return jsonRes({ status: 'error', message: 'ポータル作成に失敗: ' + portalData.error.message });
    if (!portalData.url) return jsonRes({ status: 'error', message: 'ポータルURLが取得できませんでした' });

    return jsonRes({ status: 'success', portalUrl: portalData.url });
  } catch (err) {
    console.error('[LFP] handleCreatePortalSession error:', err);
    return jsonRes({ status: 'error', message: 'ポータルセッション作成中にエラー: ' + err.toString() });
  }
}

function handleCreateCheckout(data) {
  const email = (data.email || '').toLowerCase().trim();
  if (!email) return jsonRes({ status: 'error', message: 'メールアドレスが指定されていません' });

  const plan = data.plan || 'pro';
  if (hasActiveSubscription(email)) return jsonRes({ status: 'error', message: '既にアクティブなサブスクがあります' });

  const trialUsed = checkTrialUsed(email);
  const trialDays = (plan === 'pro' && !trialUsed) ? TRIAL_DAYS : 0;

  try {
    const session = createStripeCheckoutSession({ customerEmail: email, priceId: getStripePriceId(plan), plan: plan, yaballeEmail: email, trialDays: trialDays });
    if (!session || !session.url) {
      return jsonRes({ status: 'error', message: 'Checkout Session URLが取得できませんでした' });
    }
    if (trialDays > 0) markTrialUsed(email, '', plan);
    return jsonRes({ status: 'success', url: session.url });
  } catch (err) {
    console.error('[LFP] handleCreateCheckout error:', err);
    return jsonRes({ status: 'error', message: 'Checkout作成中にエラー: ' + err.toString() });
  }
}

function handleCheckTrialEligibility(data) {
  const email = (data.email || '').toLowerCase().trim();
  const trialUsed = checkTrialUsed(email);
  const hasActive = hasActiveSubscription(email);
  return jsonRes({ status: 'success', eligible: !trialUsed && !hasActive, trialUsed: trialUsed, hasActiveSubscription: hasActive });
}

// ============================================================
//  Webhook 処理
// ============================================================

function handleStripeWebhook(stripeEvent) {
  const session = stripeEvent.data.object;
  const subscriptionId = session.subscription || '';
  const email = (session.customer_email || session.customer_details?.email || session.metadata?.yaballe_email || '').toLowerCase().trim();
  const plan = session.metadata?.plan || ((session.amount_total >= 498000) ? 'premium' : 'pro');
  const trialIncluded = session.metadata?.trial_included === 'true';

  // Session ID の重複チェック
  const storesSheet = getSpreadsheet().getSheetByName(STORES_SHEET);
  const storesData  = storesSheet.getDataRange().getValues();
  if (storesData.some(row => row[4] === session.id)) return jsonRes({ status: 'already_processed' });

  if (email && trialIncluded) markTrialUsed(email, subscriptionId, plan);

  const licSheet = getSpreadsheet().getSheetByName(LICENSES_SHEET);
  const key = 'LFP-' + Utilities.getUuid().replace(/-/g, '').substring(0, 8).toUpperCase();
  const now = new Date();
  
  licSheet.appendRow([key, plan, email, 'active', now, email, subscriptionId]);
  storesSheet.appendRow([now, email, plan, session.amount_total || 0, session.id, key, subscriptionId]);

  sendBulkLicenseEmail(email, [key], plan, trialIncluded);
  return jsonRes({ status: 'success', issued: 1 });
}

function handleSubscriptionDeleted(stripeEvent) {
  const subId = stripeEvent.data.object.id;
  const expiredCount = expireLicensesBySubscriptionId(subId);
  return jsonRes({ status: 'success', expired: expiredCount });
}

function handleSubscriptionUpdated(stripeEvent) {
  const sub = stripeEvent.data.object;
  const subId = sub.id;
  const status = sub.status;

  console.log('[LFP] サブスク更新: ' + subId + ' status=' + status + ' cancel_at_period_end=' + sub.cancel_at_period_end);

  // ★ 期末解約の検知を最優先
  if (sub.cancel_at_period_end === true && sub.cancel_at) {
    const cancelAtDate = new Date(sub.cancel_at * 1000);
    setCancelAtBySubscriptionId(subId, cancelAtDate);
    return jsonRes({ status: 'success', message: 'cancel_at recorded', cancelAt: cancelAtDate.toISOString() });
  } else if (sub.cancel_at_period_end === false) {
    clearCancelAtBySubscriptionId(subId);
  }

  if (status === 'canceled' || status === 'unpaid') {
    expireLicensesBySubscriptionId(subId);
  } else if (status === 'past_due') {
    const deadline = new Date();
    deadline.setDate(deadline.getDate() + 7);
    setGraceDeadlineBySubscriptionId(subId, deadline);
  } else if (status === 'active' || status === 'trialing') {
    clearGraceDeadlineBySubscriptionId(subId);
    const priceId = sub.items?.data?.[0]?.price?.id;
    if (priceId) {
      const newPlan = determinePlanFromPriceId(priceId);
      if (newPlan) updateLicensePlanBySubscriptionId(subId, newPlan);
    }
  }

  return jsonRes({ status: 'success', message: 'updated' });
}

function handleChargeRefunded(stripeEvent) {
  const email = stripeEvent.data.object.billing_details?.email || '';
  if (email) expireLicensesByEmail(email);
  return jsonRes({ status: 'success' });
}

// --- 未実装のハンドラ ---
function handleSubscriptionDeleted(data) {
  console.log('[LFP] subscription.deleted 受信:', JSON.stringify(data));
  const subId = data.data.object.id;
  expireLicensesBySubscriptionId(subId);
  return jsonRes({ status: 'success', message: 'subscription expired' });
}

function handleSubscriptionUpdated(data) {
  console.log('[LFP] subscription.updated 受信:', JSON.stringify(data));
  const sub = data.data.object;
  const subId = sub.id;
  const status = sub.status;
  const priceId = sub.items.data[0].price.id;

  if (status === 'active' || status === 'trialing') {
    const plan = determinePlanFromPriceId(priceId);
    if (plan) updateLicensePlanBySubscriptionId(subId, plan);
  } else if (status === 'past_due' || status === 'unpaid') {
    // 支払い失敗時の猶予期間設定（P1）
    const deadline = new Date();
    deadline.setDate(deadline.getDate() + 7); // 7日間猶予
    setGraceDeadlineBySubscriptionId(subId, deadline);
  }
  return jsonRes({ status: 'success', message: 'subscription updated' });
}

function handleChargeRefunded(data) {
  console.log('[LFP] charge.refunded 受信:', JSON.stringify(data));
  const charge = data.data.object;
  // 返金時はライセンス失効（必要に応じて）
  return jsonRes({ status: 'success', message: 'refund logged' });
}

function handleChargeDispute(stripeEvent) {
  const dispute = stripeEvent.data.object;
  const charge  = dispute.charge;

  console.log('[LFP] チャージバック通知 - ChargeID: ' + charge);
  // チャージバックの場合は手動対応が必要なため、ログだけ記録
  return jsonRes({ status: 'success', message: 'dispute logged' });
}

// ============================================================
//  データベース操作
// ============================================================

function setCancelAtBySubscriptionId(subId, cancelAt) {
  const sheet = getSpreadsheet().getSheetByName(LICENSES_SHEET);
  const data = sheet.getDataRange().getValues();
  const tid = String(subId).trim();
  for (let i = 1; i < data.length; i++) {
    const sid = String(data[i][6]).trim();
    if (sid === tid && data[i][3] === 'active') {
      sheet.getRange(i + 1, 9).setValue(cancelAt); // I列
      console.log('[LFP] CancelAt 記録成功: Row' + (i+1));
    }
  }
}

function clearCancelAtBySubscriptionId(subId) {
  const sheet = getSpreadsheet().getSheetByName(LICENSES_SHEET);
  const data = sheet.getDataRange().getValues();
  const tid = String(subId).trim();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][6]).trim() === tid) sheet.getRange(i + 1, 9).setValue('');
  }
}

function updateLicensePlanBySubscriptionId(subId, newPlan) {
  const sheet = getSpreadsheet().getSheetByName(LICENSES_SHEET);
  const data = sheet.getDataRange().getValues();
  const tid = String(subId).trim();
  let targetMail = null;
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][6]).trim() === tid && data[i][3] === 'active') {
      sheet.getRange(i + 1, 2).setValue(newPlan);
      targetMail = String(data[i][5]).toLowerCase().trim();
    }
  }
  // P9: 同一メールの別ライセンスを失効
  if (targetMail) {
    for (let j = 1; j < data.length; j++) {
      if (String(data[j][6]).trim() !== tid && String(data[j][5]).toLowerCase().trim() === targetMail && data[j][3] === 'active') {
        sheet.getRange(j + 1, 4).setValue('expired');
      }
    }
  }
}

function expireLicensesBySubscriptionId(subId) {
  const sheet = getSpreadsheet().getSheetByName(LICENSES_SHEET);
  const data = sheet.getDataRange().getValues();
  const tid = String(subId).trim();
  let count = 0;
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][6]).trim() === tid && data[i][3] === 'active') {
      sheet.getRange(i + 1, 4).setValue('expired');
      count++;
    }
  }
  return count;
}

function setGraceDeadlineBySubscriptionId(subId, deadline) {
  const sheet = getSpreadsheet().getSheetByName(LICENSES_SHEET);
  const data = sheet.getDataRange().getValues();
  const tid = String(subId).trim();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][6]).trim() === tid && data[i][3] === 'active') sheet.getRange(i + 1, 8).setValue(deadline);
  }
}

function clearGraceDeadlineBySubscriptionId(subId) {
  const sheet = getSpreadsheet().getSheetByName(LICENSES_SHEET);
  const data = sheet.getDataRange().getValues();
  const tid = String(subId).trim();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][6]).trim() === tid) sheet.getRange(i + 1, 8).setValue('');
  }
}

function expireLicensesByEmail(email) {
  const sheet = getSpreadsheet().getSheetByName(LICENSES_SHEET);
  const data = sheet.getDataRange().getValues();
  const mail = email.toLowerCase().trim();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][5]).toLowerCase().trim() === mail && data[i][3] === 'active') sheet.getRange(i + 1, 4).setValue('expired');
  }
}

function determinePlanFromPriceId(priceId) {
  const props = PropertiesService.getScriptProperties();
  if (priceId === props.getProperty('STRIPE_PREMIUM_PRICE_ID')) return 'premium';
  if (priceId === props.getProperty('STRIPE_PRO_PRICE_ID')) return 'pro';
  return null;
}

// ============================================================
//  外部通信関連 (ライセンス確認・認証)
// ============================================================

function handleCheckTrial(data) {
  const email = (data.email || '').toLowerCase().trim();
  if (!email) return jsonRes({ status: 'success', plan: 'free' });

  const rows = getSpreadsheet().getSheetByName(LICENSES_SHEET).getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][5]).toLowerCase().trim() === email && rows[i][3] === 'active') {
      
      // 猶予期限チェック
      if (rows[i][7]) {
        if (new Date() > new Date(rows[i][7])) {
          getSpreadsheet().getSheetByName(LICENSES_SHEET).getRange(i + 1, 4).setValue('expired');
          continue;
        }
      }

      const subId = rows[i][6];
      const info = getStripeSubscriptionInfo(subId);
      
      return jsonRes({
        status: 'success',
        plan: rows[i][1],
        licenseKey: rows[i][0],
        trialStartDate: rows[i][4] ? new Date(rows[i][4]).toISOString() : null,
        cancelAt: rows[i][8] ? new Date(rows[i][8]).toISOString() : null,
        nextBillingDate: info?.nextBillingDate || null,
        nextBillingAmount: info?.nextBillingAmount || null
      });
    }
  }
  return jsonRes({ status: 'success', plan: 'free' });
}

function handleApplyLicense(data) {
  const email = (data.email || '').toLowerCase().trim();
  const key = (data.licenseKey || '').trim();
  const sheet = getSpreadsheet().getSheetByName(LICENSES_SHEET);
  const rows = sheet.getDataRange().getValues();

  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === key) {
      if (rows[i][3] !== 'active') return jsonRes({ status: 'error', message: '無効なキーです' });
      if (!rows[i][5]) {
        sheet.getRange(i+1, 6).setValue(email);
        return jsonRes({ status: 'success', plan: rows[i][1] });
      }
      if (String(rows[i][5]).toLowerCase().trim() === email) return jsonRes({ status: 'success', plan: rows[i][1] });
      return jsonRes({ status: 'error', message: '他アカウントで使用中です' });
    }
  }
  return jsonRes({ status: 'error', message: 'キーが見つかりません' });
}

function sendBulkLicenseEmail(to, keys, plan, trial) {
  if (!to) return;
  const label = (plan === 'premium') ? 'Premium' : 'Pro';
  const list = keys.map((k, i) => (i + 1) + '. ' + k).join('\n');
  const trialMsg = trial ? '\n※ 30日間の無料トライアル付きです。\n' : '';
  const body = `ListerFlow Pro へのご購入ありがとうございます！\n\n■ プラン: ${label}${trialMsg}\n■ キー:\n${list}\n\n【管理・解約】\n拡張機能の「プラン管理」からいつでも調整可能です。`;
  MailApp.sendEmail(to, '【ListerFlow Pro】ライセンスキーのご案内', body);
}
