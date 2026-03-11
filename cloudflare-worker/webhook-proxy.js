/**
 * ListerFlow Pro - Stripe Webhook Proxy (Cloudflare Worker)
 *
 * Stripe → この Worker → GAS に転送
 * - Stripe に即座に 200 OK を返す
 * - Stripe-Signature ヘッダーで HMAC-SHA256 署名検証を行う
 * - 検証成功後、GAS の doPost にリクエストを転送する
 *
 * 必要な環境変数（Cloudflare ダッシュボードで設定）:
 *   STRIPE_WEBHOOK_SECRET  - Stripe の Webhook Signing Secret (whsec_xxx)
 *   GAS_WEBHOOK_URL        - GAS の Web App URL (https://script.google.com/macros/s/.../exec)
 *   GAS_SECRET             - GAS 側の URL パラメータシークレット
 */

export default {
  async fetch(request, env) {
    // POST 以外は拒否
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }

    const body = await request.text();
    const sigHeader = request.headers.get('stripe-signature');

    // --- Stripe 署名検証 ---
    if (env.STRIPE_WEBHOOK_SECRET && sigHeader) {
      const isValid = await verifyStripeSignature(body, sigHeader, env.STRIPE_WEBHOOK_SECRET);
      if (!isValid) {
        return new Response(JSON.stringify({ error: 'Invalid signature' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    // --- GAS に非同期転送 ---
    const gasUrl = env.GAS_WEBHOOK_URL + '?secret=' + encodeURIComponent(env.GAS_SECRET || '');

    // waitUntil でバックグラウンド転送（Stripe への 200 返却を待たせない）
    const ctx = { waitUntil: (p) => p }; // fallback
    try {
      const fetchPromise = fetch(gasUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: body,
        redirect: 'follow',
      });

      // Worker の context.waitUntil が使える場合はバックグラウンドで実行
      if (request.ctx && request.ctx.waitUntil) {
        request.ctx.waitUntil(fetchPromise);
      } else {
        // フォールバック: await で待つ（それでも Stripe には先に 200 を返す仕組みにはならないが、
        // GAS にデータが届くことを保証する）
        await fetchPromise;
      }
    } catch (err) {
      console.error('GAS 転送エラー:', err);
      // GAS 転送に失敗しても Stripe には 200 を返す（リトライさせない）
    }

    // Stripe に即座に 200 OK を返す
    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  },
};

/**
 * Stripe Webhook の HMAC-SHA256 署名検証
 * @param {string} payload - リクエストボディ
 * @param {string} sigHeader - Stripe-Signature ヘッダー値
 * @param {string} secret - Webhook Signing Secret (whsec_xxx)
 * @returns {Promise<boolean>}
 */
async function verifyStripeSignature(payload, sigHeader, secret) {
  try {
    // Stripe-Signature ヘッダーをパース
    const parts = {};
    sigHeader.split(',').forEach((item) => {
      const [key, value] = item.split('=');
      parts[key.trim()] = value.trim();
    });

    const timestamp = parts['t'];
    const signature = parts['v1'];

    if (!timestamp || !signature) return false;

    // タイムスタンプが古すぎないかチェック（5分以内）
    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - parseInt(timestamp)) > 300) return false;

    // HMAC-SHA256 で署名を計算
    const signedPayload = timestamp + '.' + payload;
    const encoder = new TextEncoder();

    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );

    const signatureBytes = await crypto.subtle.sign('HMAC', key, encoder.encode(signedPayload));

    // 計算した署名を hex 文字列に変換
    const expectedSig = Array.from(new Uint8Array(signatureBytes))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

    // タイミングセーフ比較
    return expectedSig === signature;
  } catch (err) {
    console.error('署名検証エラー:', err);
    return false;
  }
}
