/**
 * ListerFlow Pro - Purchase Page Script (v2)
 *
 * Payment Links → Stripe Checkout Session API 方式に移行。
 * GAS バックエンドと連携し、トライアル使用済みユーザーには
 * トライアルなしの Checkout Session を生成する。
 */
document.addEventListener('DOMContentLoaded', async () => {
    const upgradeProBtn = document.getElementById('upgradeProBtn');
    const upgradePremiumBtn = document.getElementById('upgradePremiumBtn');
    const trialBanner = document.querySelector('.trial-banner');
    const trialNote = document.querySelector('.trial-note');
    const proBtn = document.getElementById('upgradeProBtn');

    // ─── 1. ページ読み込み時: トライアル使用状況を確認してUIを更新 ───
    let trialEligible = true; // デフォルトはtrue（通信失敗時はトライアル表示）
    let yaballeEmail = null;
    let isActiveSubscriber = false; // ★ アクティブなサブスクがあるかのフラグ

    try {
        const emailData = await chrome.storage.local.get(['lfp_current_yaballe_email']);
        yaballeEmail = emailData.lfp_current_yaballe_email;

        if (yaballeEmail) {
            const response = await chrome.runtime.sendMessage({
                type: "LFP_LICENSE_SERVER_REQUEST",
                payload: { action: "check_trial_eligibility", email: yaballeEmail }
            });

            if (response?.ok && response?.data?.status === 'success') {
                trialEligible = !response.data.trialUsed;
                const hasActive = response.data.hasActiveSubscription;

                if (hasActive) {
                    // 既にアクティブなサブスクがある場合
                    isActiveSubscriber = true;
                    updateUIForActiveSubscription();
                } else if (!trialEligible) {
                    // トライアル使用済みの場合
                    updateUIForTrialUsed();
                }
                // それ以外: デフォルト表示（トライアルバナーあり）
            }
        }
    } catch (err) {
        console.warn('[LFP Purchase] トライアル状態の確認に失敗:', err.message);
        // 通信失敗時はデフォルト表示のまま（トライアルバナーあり）
    }

    // ─── 2. Pro プラン購入ボタン（アクティブなサブスクがなければ購入用ハンドラをセット） ───
    if (!isActiveSubscriber && upgradeProBtn) {
        upgradeProBtn.onclick = async (event) => {
            await handleCheckout('pro', event);
        };
    }

    // ─── 3. Premium プラン購入ボタン（同上） ───
    if (!isActiveSubscriber && upgradePremiumBtn) {
        upgradePremiumBtn.onclick = async (event) => {
            await handleCheckout('premium', event);
        };
    }

    // ═══ Checkout Session 作成 & リダイレクト ═══
    async function handleCheckout(plan, eventOrBtn) {
        // ボタンのどこをクリックしても、確実に <button> 要素を取得する
        const btn = eventOrBtn instanceof HTMLElement ? eventOrBtn : eventOrBtn.currentTarget.closest('button');
        if (!btn || btn.disabled) return;

        // ボタンを無効化（二重クリック防止）
        const originalHTML = btn.innerHTML;
        btn.disabled = true;
        btn.style.opacity = '0.7';
        btn.style.cursor = 'wait';
        btn.innerHTML = '<span class="checkout-spinner"></span><span>準備中...</span>';

        try {
            // Yaballeメールアドレスの取得
            if (!yaballeEmail) {
                const emailData = await chrome.storage.local.get(['lfp_current_yaballe_email']);
                yaballeEmail = emailData.lfp_current_yaballe_email;
            }

            if (!yaballeEmail) {
                showError('Yaballeの作業画面を一度開いてから、この購入ページをご利用ください。\n（アカウント情報の取得が必要です）');
                return;
            }

            // トライアル使用済みの場合は事前確認（Pro のみ）
            if (plan === 'pro' && !trialEligible) {
                const ok = confirm(
                    '無料トライアルは既にご利用済みのため、初月から ¥2,980 が課金されます。\n\n続けますか？'
                );
                if (!ok) return;
            }

            // GAS Backend に Checkout Session 作成を依頼
            btn.querySelector('span:last-child').textContent = 'Stripe に接続中...';

            const response = await chrome.runtime.sendMessage({
                type: "LFP_LICENSE_SERVER_REQUEST",
                payload: {
                    action: "create_checkout",
                    email: yaballeEmail,
                    plan: plan
                }
            });

            if (!response?.ok) {
                throw new Error(response?.error || 'サーバーとの通信に失敗しました');
            }

            const result = response.data;

            if (result.status !== 'success' || !result.url) {
                throw new Error(result.message || 'Checkout Session の作成に失敗しました');
            }

            // Stripe Checkout ページへリダイレクト
            console.log('[LFP Purchase] Checkout Session 作成成功 - URL:', result.url);
            window.location.href = result.url;

        } catch (err) {
            console.error('[LFP Purchase] Checkout error:', err);
            showError('決済ページの準備中にエラーが発生しました:\n\n' + err.message + '\n\n時間をおいて再度お試しください。');
        } finally {
            btn.disabled = false;
            btn.innerHTML = originalHTML;
        }
    }

    // ═══ UI更新: トライアル使用済みの場合 ═══
    function updateUIForTrialUsed() {
        // トライアルバナーを変更
        if (trialBanner) {
            trialBanner.textContent = '💳 初月から ¥2,980/月（トライアル使用済み）';
            trialBanner.style.background = 'linear-gradient(135deg, rgba(245, 158, 11, 0.12), rgba(239, 68, 68, 0.08))';
            trialBanner.style.color = '#92400e';
        }

        // トライアルノートを変更
        if (trialNote) {
            trialNote.textContent = '※ 無料トライアルは1アカウント1回限りです。';
        }

        // ボタンテキストを変更
        if (proBtn) {
            const span = proBtn.querySelector('span');
            if (span) span.textContent = 'Proプランを開始する';
        }

        // ヒーロー統計の「初月の費用」を更新
        const statItems = document.querySelectorAll('.stat-item');
        statItems.forEach(item => {
            const label = item.querySelector('.stat-label');
            if (label && label.textContent.includes('初月の費用')) {
                const number = item.querySelector('.stat-number');
                if (number) number.textContent = '¥2,980';
            }
        });
    }

    // ═══ UI更新: 既にアクティブサブスクがある場合 ═══
    function updateUIForActiveSubscription() {
        // 現在のプラン情報をストレージから取得
        let currentPlanLabel = 'Pro';
        chrome.storage.local.get(['lfp_license_v1', 'lfp_pro_trial_start_date', 'lfp_cancel_at'], (data) => {
            const license = data.lfp_license_v1 || {};
            const plan = (license.plan || 'pro').toLowerCase();
            const trialStart = data.lfp_pro_trial_start_date;
            const cancelAt = data.lfp_cancel_at;

            let isTrialing = false;
            let trialDaysLeft = 0;
            if (trialStart) {
                const start = new Date(trialStart.split('T')[0] + 'T00:00:00');
                const today = new Date(new Date().toISOString().split('T')[0] + 'T00:00:00');
                const diff = Math.floor((today - start) / (1000 * 60 * 60 * 24));
                if (diff >= 0 && diff < 30) {
                    isTrialing = true;
                    trialDaysLeft = 30 - diff;
                }
            }

            if (plan === 'premium') currentPlanLabel = 'Premium';
            else if (isTrialing) currentPlanLabel = `Pro (Trial・残り${trialDaysLeft}日)`;
            else currentPlanLabel = 'Pro';

            // バナーにプラン情報を表示
            if (trialBanner) {
                let bannerText = `✅ 現在のプラン: ${currentPlanLabel}`;
                if (cancelAt) {
                    const cd = new Date(cancelAt);
                    bannerText += ` — ${cd.getMonth() + 1}/${cd.getDate()}に解約予定`;
                }
                trialBanner.textContent = bannerText;
                trialBanner.style.background = 'linear-gradient(135deg, rgba(16, 185, 129, 0.12), rgba(6, 182, 212, 0.08))';
                trialBanner.style.color = '#065f46';
            }
        });

        if (trialBanner) {
            trialBanner.textContent = '✅ 既にアクティブなプランをご利用中です';
            trialBanner.style.background = 'linear-gradient(135deg, rgba(16, 185, 129, 0.12), rgba(6, 182, 212, 0.08))';
            trialBanner.style.color = '#065f46';
        }

        if (trialNote) {
            trialNote.style.display = 'none';
        }

        // Freeプランのボタンを更新（ダウングレード＋ポータルに飛ぶ）
        const freeBtn = document.getElementById('freeBtn');
        if (freeBtn) {
            freeBtn.textContent = 'Freeプランへダウングレード';
            freeBtn.disabled = false;
            freeBtn.style.cursor = 'pointer';
            freeBtn.style.opacity = '1';
            freeBtn.onclick = (e) => openPortalWithConfirm(e, 'manage', freeBtn);
        }

        // カード外の注釈に表示
        const pricingNote = document.getElementById('pricingNote');
        if (pricingNote) {
            pricingNote.textContent = '※ プランの変更（アップグレード・ダウングレード）やキャンセルは、各プランのボタンからポータルを開いて行えます。';
            pricingNote.style.display = 'block';
        }

        // ポータルを開く共通関数（GAS経由でStripe APIからURLを動的に取得）
        async function openPortal(btnElement) {
            if (!btnElement) return;
            const span = btnElement.querySelector('span');
            const originalText = span ? span.textContent : btnElement.textContent;
            if (span) span.textContent = 'ポータルを準備中...';
            else btnElement.textContent = 'ポータルを準備中...';
            btnElement.disabled = true;

            try {
                const response = await chrome.runtime.sendMessage({
                    type: "LFP_LICENSE_SERVER_REQUEST",
                    payload: { action: "create_portal_session", email: yaballeEmail }
                });

                if (response?.ok && response.data?.status === 'success' && response.data.portalUrl) {
                    window.open(response.data.portalUrl, '_blank');
                } else {
                    const errMsg = response?.data?.message || response?.error || 'ポータルの取得に失敗しました';
                    showError('ポータルを開けませんでした:\n\n' + errMsg);
                }
            } catch (err) {
                showError('ポータルを開けませんでした:\n\n' + err.message);
            } finally {
                if (span) span.textContent = originalText;
                else btnElement.textContent = originalText;
                btnElement.disabled = false;
            }
        }

        // ★ P8: ポータルを開く前の確認モーダル
        async function openPortalWithConfirm(e, context, btnElement) {
            if (e) {
                e.preventDefault();
                e.stopPropagation();
            }
            const btn = btnElement || (e ? e.currentTarget : null);
            if (!btn) return;

            // context: 'manage' (管理) or 'upgrade' (Premium アップグレード)
            let confirmMessage = '';

            if (context === 'upgrade') {
                // 現在のプラン情報を取得して確認メッセージを構成
                const licData = await chrome.storage.local.get(['lfp_license_v1', 'lfp_pro_trial_start_date']);
                const license = licData.lfp_license_v1 || {};
                const plan = (license.plan || 'pro').toLowerCase();
                const trialStart = licData.lfp_pro_trial_start_date;

                let isTrialing = false;
                if (trialStart) {
                    const start = new Date(trialStart.split('T')[0] + 'T00:00:00');
                    const today = new Date(new Date().toISOString().split('T')[0] + 'T00:00:00');
                    const diff = Math.floor((today - start) / (1000 * 60 * 60 * 24));
                    isTrialing = (diff >= 0 && diff < 30);
                }

                if (isTrialing) {
                    confirmMessage =
                        '⚠️ Premiumへのアップグレードについて\n\n' +
                        '• 現在のPro無料トライアルは即時終了します\n' +
                        '• 本日から ¥4,980/月 の課金が開始されます\n' +
                        '• Premium機能（Turbo Mode無制限 等）が即時利用可能になります\n\n' +
                        'ポータルを開いてアップグレードしますか？';
                } else if (plan === 'pro') {
                    confirmMessage =
                        'Premiumへのアップグレードについて\n\n' +
                        '• 差額は次回請求に合算されます\n' +
                        '• Premium機能が即時利用可能になります\n\n' +
                        'ポータルを開いてアップグレードしますか？';
                }
            } else {
                // 管理ボタン: サブスク管理ポータルの案内
                confirmMessage =
                    'Stripeの管理ポータルを開きます。\n\n' +
                    'ポータルでは以下の操作が可能です:\n' +
                    '• プラン変更（アップグレード / ダウングレード）\n' +
                    '• お支払い方法の変更\n' +
                    '• サブスクリプションのキャンセル\n\n' +
                    '続けますか？';
            }

            if (confirmMessage) {
                const ok = confirm(confirmMessage);
                if (!ok) return;
            }

            // 確認OKならポータルを開く（btnを直接渡す）
            await openPortal(btn);
        }

        // Proプランボタンをポータル用に変更
        if (proBtn) {
            const span = proBtn.querySelector('span');
            if (span) span.textContent = '利用中のプランを管理する';
            proBtn.onclick = (e) => openPortalWithConfirm(e, 'manage', proBtn);
        }

        // Premiumプランボタンをポータル用に変更
        if (upgradePremiumBtn) {
            const premSpan = upgradePremiumBtn.querySelector('span');
            if (premSpan) premSpan.textContent = 'Premiumへアップグレード';
            upgradePremiumBtn.onclick = (e) => openPortalWithConfirm(e, 'upgrade', upgradePremiumBtn);
        }
    }

    // ═══ エラー表示（モーダル風） ═══
    function showError(message) {
        // 既存のモーダルがあれば削除
        const existing = document.querySelector('.lfp-purchase-error-overlay');
        if (existing) existing.remove();

        const overlay = document.createElement('div');
        overlay.className = 'lfp-purchase-error-overlay';
        overlay.style.cssText = `
      position: fixed; top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0,0,0,0.5); z-index: 10000;
      display: flex; align-items: center; justify-content: center;
      animation: fadeIn 0.2s ease;
    `;

        const dialog = document.createElement('div');
        dialog.style.cssText = `
      background: white; border-radius: 16px; padding: 32px;
      max-width: 420px; width: 90%; box-shadow: 0 20px 60px rgba(0,0,0,0.2);
      animation: scaleIn 0.25s cubic-bezier(0.4, 0, 0.2, 1);
    `;

        dialog.innerHTML = `
      <h3 style="margin: 0 0 16px; font-size: 18px; color: #0f172a;">⚠️ エラー</h3>
      <p style="white-space: pre-wrap; font-size: 14px; color: #475569; line-height: 1.7; margin: 0 0 24px;">${message}</p>
      <button style="
        width: 100%; padding: 12px; border: none; border-radius: 8px;
        background: #0f172a; color: white; font-weight: 700;
        font-size: 14px; cursor: pointer;
      ">閉じる</button>
    `;

        overlay.appendChild(dialog);
        document.body.appendChild(overlay);

        const closeBtn = dialog.querySelector('button');
        closeBtn.addEventListener('click', () => overlay.remove());
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) overlay.remove();
        });
    }
});
