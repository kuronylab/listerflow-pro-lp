---
name: Stripe × GAS バックエンド連携
description: Google Apps Script から Stripe API を呼び出してサブスクリプション課金を実現するパターン集。Checkout Session 作成、Webhook 処理、トライアル制御、カスタマーポータル連携を含む。
---

# Stripe × GAS バックエンド連携

## 概要

Chrome 拡張機能から GAS（Google Apps Script）をバックエンドとして利用し、Stripe のサブスクリプション課金を実現する統合パターン。Payment Links（固定URL）からCheckout Session API（動的制御）への移行を経て確立された設計。

---

## アーキテクチャ

```
Chrome拡張 (purchase.js)
  ↓ chrome.runtime.sendMessage({ type: "LFP_LICENSE_SERVER_REQUEST" })
Service Worker (background.js)
  ↓ POST({ action: "create_checkout", email, plan })
GAS Backend (backend_v2.gs)
  ↓ UrlFetchApp.fetch("https://api.stripe.com/v1/checkout/sessions")
Stripe API
  ↓ Webhook POST → GAS doPost()
GAS → スプレッドシートに記録
```

> **重要**: Chrome 拡張の Content Script / Pages から直接外部 API を呼べないため、Service Worker を中継局として使う。

---

## 1. 環境変数管理（スクリプトプロパティ）

Stripe のシークレットキーや Price ID はハードコードせず、GAS の **スクリプトプロパティ** で管理する。

```javascript
// 取得パターン
function getStripeKey() {
  const key = PropertiesService.getScriptProperties().getProperty('STRIPE_SECRET_KEY');
  if (!key) throw new Error('STRIPE_SECRET_KEY が未設定です');
  return key;
}

function getStripePriceId(plan) {
  const props = PropertiesService.getScriptProperties();
  const id = (plan === 'premium')
    ? props.getProperty('STRIPE_PREMIUM_PRICE_ID')
    : props.getProperty('STRIPE_PRO_PRICE_ID');
  if (!id) throw new Error(plan + ' の Price ID が未設定です');
  return id;
}
```

### 必須プロパティ一覧

| プロパティ名 | 値の例 | 用途 |
|---|---|---|
| `STRIPE_SECRET_KEY` | `sk_test_…` / `sk_live_…` | Stripe API 認証 |
| `STRIPE_PRO_PRICE_ID` | `price_XXXX` | Pro プランの Price ID |
| `STRIPE_PREMIUM_PRICE_ID` | `price_YYYY` | Premium プランの Price ID |

> **注意**: テスト時は `sk_test_` で始まるキー、本番では `sk_live_` を使用。切替を忘れると実課金が発生する。

---

## 2. Stripe API 呼び出しパターン

GAS から Stripe API を呼ぶ際は `UrlFetchApp.fetch` を使い、`form-urlencoded` 形式でパラメータを渡す。

### Checkout Session 作成

```javascript
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
    'subscription_data[metadata][plan]': params.plan
  };

  // トライアル付与（条件付き）
  if (params.trialDays && params.trialDays > 0) {
    payload['subscription_data[trial_period_days]'] = String(params.trialDays);
  }

  const response = UrlFetchApp.fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'post',
    headers: { 'Authorization': 'Bearer ' + stripeKey },
    payload: payload,
    muteHttpExceptions: true
  });
  return JSON.parse(response.getContentText());
}
```

### ポイント
- Stripe API は **form-urlencoded** を期待する。JSON ではない。
- ネストパラメータは `subscription_data[metadata][plan]` のようにブラケット記法で渡す。
- `muteHttpExceptions: true` で HTTP エラーでも例外にせず、レスポンスボディからエラー内容を読む。

### カスタマーポータルセッション作成

```javascript
function handleCreatePortalSession(data) {
  const email = (data.email || '').toLowerCase().trim();
  const stripeKey = getStripeKey();

  // 1. メールアドレスで Customer を検索
  const searchRes = UrlFetchApp.fetch(
    'https://api.stripe.com/v1/customers?email=' + encodeURIComponent(email) + '&limit=1',
    { headers: { 'Authorization': 'Bearer ' + stripeKey } }
  );
  const customers = JSON.parse(searchRes.getContentText());
  if (!customers.data?.[0]) return jsonRes({ status: 'error', message: '顧客が見つかりません' });

  // 2. Portal Session を作成
  const portalRes = UrlFetchApp.fetch('https://api.stripe.com/v1/billing_portal/sessions', {
    method: 'post',
    headers: { 'Authorization': 'Bearer ' + stripeKey },
    payload: { customer: customers.data[0].id, return_url: SUCCESS_URL }
  });
  return jsonRes({ status: 'success', portalUrl: JSON.parse(portalRes.getContentText()).url });
}
```

---

## 3. doPost ルーティングパターン

GAS の `doPost` は Stripe Webhook とアプリからのアクション呼び出しの両方を受ける。`type` フィールド（Webhook）と `action` フィールド（アプリ）で分岐する。

```javascript
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);

    // Stripe Webhook（type フィールドで分岐）
    if (data.type === 'checkout.session.completed') return handleStripeWebhook(data);
    if (data.type === 'customer.subscription.deleted') return handleSubscriptionDeleted(data);
    if (data.type === 'customer.subscription.updated') return handleSubscriptionUpdated(data);
    if (data.type === 'charge.refunded') return handleChargeRefunded(data);
    if (data.type === 'charge.dispute.created') return handleChargeDispute(data);

    // アプリからのアクション（action フィールドで分岐）
    if (data.action === 'create_checkout') return handleCreateCheckout(data);
    if (data.action === 'check_trial_eligibility') return handleCheckTrialEligibility(data);
    if (data.action === 'apply_license') return handleApplyLicense(data);
    if (data.action === 'check_trial') return handleCheckTrial(data);
    if (data.action === 'create_portal_session') return handleCreatePortalSession(data);

    return jsonRes({ status: 'error', message: 'Unknown action' });
  } catch (err) {
    return jsonRes({ status: 'error', message: err.toString() });
  }
}
```

---

## 4. Webhook 冪等性チェック

Stripe は Webhook を複数回送信する場合がある。重複処理を防ぐために Session ID でチェックする。

```javascript
// Session ID の重複チェック
const storesSheet = getSpreadsheet().getSheetByName(STORES_SHEET);
const storesData = storesSheet.getDataRange().getValues();
if (storesData.some(row => row[4] === session.id)) {
  return jsonRes({ status: 'already_processed' });
}
```

---

## 5. トライアル1回限り制御

スプレッドシートに `TrialUsed` シートを作り、メールアドレスごとにトライアル使用済みフラグを管理する。

### フロー
1. `handleCreateCheckout` でメールアドレスの `checkTrialUsed()` を確認
2. 未使用なら `trial_period_days=30` 付きで Checkout Session を作成
3. Session 作成直後に `markTrialUsed()` で即時記録（Race Condition 防止）
4. Webhook 到着時にも念のため `markTrialUsed()` を再度呼ぶ（冪等）

### 教訓
- **Payment Links では不可能**。Checkout Session API への移行が必須。
- `markTrialUsed()` は Checkout Session **作成直後**に呼ぶ。Webhook 到着を待つと、遅延中に別のトライアルを取得されるリスクがある。

---

## 6. JSON レスポンスヘルパー

```javascript
function jsonRes(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
```

---

## 7. テスト/本番切替チェックリスト

デプロイ前に以下を確認:

- [ ] GAS の `STRIPE_SECRET_KEY` が正しい環境のキーか（`sk_test_` or `sk_live_`）
- [ ] `STRIPE_PRO_PRICE_ID` / `STRIPE_PREMIUM_PRICE_ID` が正しい環境のIDか
- [ ] Stripe Dashboard の Webhook URL が本番 GAS のデプロイ URL を指しているか
- [ ] GAS のデプロイが「新しいバージョン」で更新されているか
- [ ] Chrome 拡張の `background.js` 内の GAS URL が正しいか

---

## 8. GAS デプロイ手順

1. GAS エディタ → **デプロイ** → **デプロイを管理**
2. 鉛筆アイコン → **バージョン**: **新しいバージョン** を選択
3. **デプロイ** ボタンをクリック

> **注意**: デプロイ URL は変わらない。新しいバージョンを選ぶだけでコードが反映される。

---

## よくあるハマりポイント

| 問題 | 原因 | 対策 |
|---|---|---|
| Stripe API が 401 | APIキーが未設定 or テスト/本番の不一致 | `getStripeKey()` のログを確認 |
| Webhook が届かない | GAS の URL が古い / Stripe に未登録 | Stripe Dashboard の Webhook ログを確認 |
| 同一ユーザーが複数サブスク | `hasActiveSubscription()` チェック漏れ | Checkout 作成時 + Webhook 到着時の二重チェック |
| GAS が 30秒でタイムアウト | スプレッドシートの行数が多すぎる | 不要な行の定期削除 or シート分割 |
| `doPost` が動かない | GAS のデプロイが古いバージョンのまま | 「新しいバージョン」で再デプロイ |
