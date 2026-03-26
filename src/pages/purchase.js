/**
 * ListerFlow Pro - Purchase Page Logic
 * Handles plan display, Stripe checkout, and multi-language support.
 */

const translations = {
    ja: {
        "page.title": "ListerFlow Pro - 出品時間を80%削減する究極の自動化ツール",
        "page.desc": "eBay出品作業を60秒→12秒に短縮。AIタイトル最適化・Turbo Mode完全自動化で、毎月15時間以上の自由な時間を。",
        "hero.title": '<span class="hero-line">1品の出品時間を</span><span class="hero-highlight">60秒 → 12秒に。</span>',
        "hero.subtitle": '<span class="catch-highlight">AIタイトル最適化</span> × <span class="catch-highlight">ワンクリック自動化</span>で、<br>出品作業のすべてが<span class="catch-text-glow">変わる。</span>',
        "hero.persona.label": "🎯 対象ユーザー",
        "hero.persona.text": "Yaballeで月50〜1,200品<br>出品するセラーのための<br>出品特化ツール",
        "hero.stat.prefix.max": "最大",
        "hero.stat.1.label": "作業時間を削減",
        "hero.stat.2.label": "毎月の節約時間",
        "hero.stat.3.label": "初月の費用",
        "hero.stat.note": "※ 削減時間はPremium・月1,500品出品時の最大値。まずはProの1ヶ月無料トライアル（¥0）からお試しいただけます。",
        "hero.cta.btn": "✨ 1ヶ月無料で試してみる",
        "hero.cta.note": "クレジットカード登録後、1ヶ月間は完全無料。<br>期間中のキャンセルで費用は一切かかりません。",
        "comparison.tag": "実測データ",
        "comparison.title": "1日50品出品の場合",
        "comparison.before.label": "ツールなし",
        "comparison.unit": "分/日",
        "comparison.before.desc": "毎日50分、月に20時間の出品作業",
        "comparison.after.label": "Premiumプラン",
        "comparison.after.desc": "月1,200品でも、たった4時間で完了",
        "features.tag": "機能",
        "features.title": "その「地道な作業」を、テクノロジーで解決",
        "feature.1.title": "AI タイトル SEO 最適化",
        "feature.1.desc": "ChatGPTとの往復はもう不要。ターゲットキーワードを逃さず、eBay検索で有利なSEO最適化済みのタイトル（70-80文字）を、出品画面から離れず一瞬で生成。",
        "feature.2.title": "Turbo Mode",
        "feature.2.desc": "ASINを貼り付けた瞬間から、AI最適化→MIPクリック→完了まで全自動。あなたは次のASINを用意するだけ。",
        "feature.3.title": "Quick MIP & 自動OK",
        "feature.3.desc": "画面下部のMIPボタンを探す手間ゼロ。上部のQuick MIPボタンとOK自動クリックで視線移動を最小化。",
        "feature.4.title": "履歴 & 一括コピー",
        "feature.4.desc": "ASIN履歴で「どこまでやった？」を解消。CSV出力・一括コピーで結果入力は5秒以下。",
        "feature.5.title": "VeRO & 重複検出",
        "feature.5.desc": "VeRO警告やASIN重複を自動検出。安全な大量出品運用をサポートします。",
        "feature.6.title": "統計ダッシュボード",
        "feature.6.desc": "出品数・作業時間・スピードをリアルタイム表示。日次・週間で自分の生産性を可視化。",
        "screenshots.tag": "実際の画面",
        "screenshots.title": "百聞は一見にしかず",
        "ss.before.label": "❌ Before（最適化前）",
        "ss.before.caption": 'タイトル <span class="review-highlight">153文字</span>で上限オーバー。VeRO警告も見落としがち。',
        "ss.after.label": "✅ After（最適化後）",
        "ss.after.caption": 'ワンクリックで <span class="review-highlight">75文字</span>に最適化。VeRO・文字数チェックも自動。',
        "ss.stats.label": "📊 統計情報 & ASIN履歴",
        "ss.stats.caption": "出品数・作業時間・出品速度をリアルタイム表示。ASIN履歴は最大1,000件保持、CSV出力・一括コピーに対応。",
        "savings.tag": "コスト比較",
        "savings.title": "月1,200品出品の場合",
        "savings.col.none": "ツールなし",
        "savings.col.pro": "LFP Pro",
        "savings.col.premium": "LFP Premium",
        "savings.row.hours": "月の作業時間",
        "savings.val.hours.none": "20時間",
        "savings.val.hours.pro": "5時間",
        "savings.val.hours.premium": "4時間",
        "savings.row.cost": "人件費換算（時給1,500円）",
        "savings.val.cost.none": "30,000円",
        "savings.val.cost.pro": "7,500円",
        "savings.val.cost.premium": "6,000円",
        "savings.row.fee": "ツール費用",
        "savings.val.fee.none": "¥0",
        "savings.val.fee.pro": "2,980円",
        "savings.val.fee.premium": "4,980円",
        "savings.row.total": "実質コスト",
        "savings.val.total.none": "30,000円",
        "savings.val.total.pro": "10,480円",
        "savings.val.total.premium": "10,980円",
        "savings.row.result": "毎月の節約額",
        "savings.val.result.pro": "🎉 19,520円",
        "savings.val.result.premium": "🎉 19,020円",
        "savings.note": "※ ツール料金の<strong>6倍以上</strong>の価値を毎月生み出します",
        "pricing.tag": "料金プラン",
        "pricing.title": "あなたに最適なプランを選択",
        "pricing.unit.month": "/ 月",
        "plan.free.desc": "基本機能の確認に",
        "plan.free.feature.1": '<span class="check">✔</span> 1日2回 AIタイトル最適化',
        "plan.free.feature.2": '<span class="check">✔</span> Quick MIP ボタン配置',
        "plan.free.feature.3": '<span class="check">✔</span> ASIN履歴保持（最大1,000件）',
        "plan.btn.current": "現在のプラン",
        "plan.pro.badge": "🔥 一番人気",
        "plan.pro.trial": "✨ 1ヶ月無料トライアル",
        "plan.pro.desc": "出品効率を最大化し、作業を「快感」に",
        "plan.pro.feature.1": '<span class="check">✔</span> <strong>無制限</strong> AIタイトル最適化',
        "plan.pro.feature.2": '<span class="check">✔</span> ASIN履歴保持（最大1,000件）',
        "plan.pro.feature.3": '<span class="check">✔</span> <strong>Quick MIP</strong> & OKボタン自動化',
        "plan.pro.feature.4": '<span class="check">✔</span> 履歴のCSV出力・一括コピー',
        "plan.pro.feature.5": '<span class="check">✔</span> <div>1日5回 <strong>Turbo Mode</strong><br><span class="feature-note">(ASINペースト後は全自動)</span></div>',
        "plan.pro.btn": "無料で試してみる（1ヶ月間）",
        "plan.pro.note": "※ 1ヶ月間は完全無料。いつでもキャンセル可能。",
        "plan.premium.badge": "👑 Ultimate",
        "plan.premium.desc": "究極の自動化で「時間を買う」運用へ",
        "plan.premium.feature.1": '<span class="check">✔</span> Proプランの<strong>全機能</strong>',
        "plan.premium.feature.2": '<span class="check">✔</span> <div><strong>無制限</strong> Turbo Mode<br><span class="feature-note">(ASINペースト後は全自動)</span></div>',
        "plan.premium.feature.3": '<span class="check">✔</span> 優先サポート & ベータ先行試用',
        "plan.premium.feature.4": '<span class="check">✔</span> 大規模アカウントの生産性最大化',
        "plan.premium.btn": "Premiumプランで始める",
        "testimonials.tag": "利用者の声",
        "testimonials.title": "テスターの方々のレビュー",
        "review.a.user": "Aさん",
        "review.a.text": '出品速度が2倍どころか<span class="review-highlight">3倍</span>くらいでした。気付いたら30品終わっている感覚です。通常<span class="review-highlight">30品で約30分</span>かかるところが、<span class="review-highlight">約10分</span>で完了しました。ASIN入力後は自動で出品が進むので、複数画面やTab切り替え、ChatGPT貼り付けなどの煩わしい作業がすべて不要になりました。繁忙期（4月・5月）の毎日60品、100品出品でも重宝しそうです。',
        "review.b.user": "Bさん",
        "review.b.text": '体感で所要時間が<span class="review-highlight">1/3</span>くらいになりました。これまで出品に時間がかかっていたのは何だったのかと思うほど、あっさり終わりました。資格試験や年度末で本業が多忙な時期なので非常に助かります。今後も活用します。',
        "review.c.user": "Cさん",
        "review.c.text": "素晴らしいツールの開発ありがとうございます。感激しました。50出品が4名あった時を思い出すと、負担がまるで別物です。本日もトラブルなく出品完了できて感動しました。",
        "review.d.user": "Dさん",
        "review.d.text": "導入と出品作業を進めましたが、問題なく進められました。出品作業時間が短縮できて感動です。システムの開発と共有、本当にありがとうございます。",
        "review.e.user": "Eさん",
        "review.e.text": "ChatGPTを使わずに済み、Yaballeの出品画面もほぼスクロールせず出品できるようになり、かなり時間短縮できました。今月50品出品が3店舗あるので、効果が大きいです。開発ありがとうございます。",
        "testimonials.note": "※ v1.0.0（Turbo Mode実装前）時点での先行テスター様の声です。",
        "faq.tag": "FAQ",
        "faq.title": "よくある質問",
        "faq.q.1": "トライアル終了後に勝手に課金されますか？",
        "faq.a.1": "Proプランは1ヶ月間の無料トライアル付きです。トライアル期間中にキャンセルすれば<strong>一切費用はかかりません</strong>。キャンセルはStripeのカスタマーポータルからいつでも可能です。",
        "faq.q.2": "いつでもキャンセルできますか？",
        "faq.a.2": "はい。決済完了時に届くメール内のリンク、またはサポートへの連絡でいつでも解約できます。解約後も、現在の請求期間が終了するまではそのまま機能を利用可能です。",
        "faq.q.3": "複数アカウントで使えますか？",
        "faq.a.3": "1つのライセンスキーにつき1つのYaballe店舗アカウントに紐付けられます。複数のアカウントで使用する場合は、アカウント数分のライセンスが必要です。",
        "faq.q.4": "ProとPremiumの違いは？",
        "faq.a.4": 'Proは「手動出品の効率化（時短）」に特化し、Turbo Modeは1日5回までです。Premiumは「完全自動化（放置）」を実現するためにTurbo Modeが<strong>無制限</strong>になります。月600品以上出品する方にはPremiumがおすすめです。',
        "faq.q.5": "ライセンスはどうやって反映させますか？",
        "faq.a.5": "決済完了後、<strong>同じYaballeアカウントでログイン</strong>するだけで、自動的に反映されます。手動入力の必要はありません。<br><br>※ライセンスキーはメールでも送信されますので、念のため大切に保管してください。<br><span class=\"feature-note\" style=\"color: #e53e3e;\">※必ずYaballeで使用しているメールアドレスで購入を完了させてください。</span>",
        "footer.copy": "© 2026 ListerFlow Pro by KURONYLAB. All rights reserved.",
        "footer.hint": "※プラン購入後、同じアカウントでYaballeにログインすると自動的にライセンスが有効化されます。ライセンスキーはメールでも送信されますので、念のため大切に保管してください。",
        "nav.features": "機能",
        "nav.reviews": "レビュー",
        "nav.pricing": "料金",
        "nav.faq": "よくある質問",
        "nav.tokusho": "特商法",
        "nav.cta": "プランを見る",
        "plan.btn.current": "現在利用中",
        "plan.btn.current_manage": "現在利用中（管理）",
        "loading": "処理中...",
        "plan.btn.downgrade.pro": "Proプランにダウングレード",
        "tokusho.tag": "Legal",
        "tokusho.title": "特定商取引法に基づく表記",
        "tokusho.label.vendor": "販売業者",
        "tokusho.value.vendor": "KURONYLAB",
        "tokusho.label.manager": "運営責任者",
        "tokusho.value.manager": "黒木 皓基",
        "tokusho.label.location": "所在地",
        "tokusho.value.location": "（請求に応じて遅滞なく開示します）",
        "tokusho.label.contact": "お問い合わせ",
        "tokusho.value.contact.email": "メール：",
        "tokusho.value.contact.line": "サポートLINE：",
        "tokusho.value.contact.line.link": "こちらから参加",
        "tokusho.value.contact.line.note": "（返信：原則24時間以内）",
        "tokusho.label.price": "販売価格",
        "tokusho.value.price.free": "Freeプラン：無料",
        "tokusho.value.price.pro": "Proプラン：月額 2,980円（税込）",
        "tokusho.value.price.premium": "Premiumプラン：月額 4,980円（税込）",
        "tokusho.label.payment_method": "支払い方法",
        "tokusho.value.payment_method": "クレジットカード（Stripe決済）<br>対応ブランド：Visa / Mastercard / American Express など",
        "tokusho.label.payment_timing": "支払い時期",
        "tokusho.value.payment_timing": "お申し込み時に即時決済。以降、毎月同日に自動更新されます。",
        "tokusho.label.delivery_timing": "サービス提供時期",
        "tokusho.value.delivery_timing": "決済完了後、即時にライセンスが有効化されます。",
        "tokusho.label.service_content": "サービス内容",
        "tokusho.value.service_content": "Chrome拡張機能「ListerFlow Pro for Yaballe」の有料プランへのアクセス権（ライセンス）をオンラインにて提供するデジタルサービスです。物理的な商品の発送はありません。",
        "tokusho.label.cancellation": "キャンセル・解約",
        "tokusho.value.cancellation": "サブスクリプションはいつでも解約可能です。末日までに解約のご連絡をいただいた場合、翌月以降の請求は発生しません。デジタルサービスの性質上、既払いの料金の返金は原則承っておりませんが、個別にご相談ください。",
        "tokusho.label.environment": "動作環境",
        "tokusho.value.environment": "Google Chrome（最新版）がインストールされた PC。<br>対応サイト：app.yaballe.com",
        "footer.contact": "お問い合わせ"
    },
    en: {
        "page.title": "ListerFlow Pro - Ultimate Automation Tool to Reduce Listing Time by 80%",
        "page.desc": "Shorten eBay listing tasks from 60 to 12 seconds. Gain 15+ free hours every month with AI title optimization and Turbo Mode automation.",
        "hero.title": '<span class="hero-line">Listing Time per item</span><span class="hero-highlight">60s → 12s.</span>',
        "hero.subtitle": '<span class="catch-highlight">AI Title Optimization</span> × <span class="catch-highlight">One-Click Automation</span><br>changes everything about your workflow.',
        "hero.persona.label": "🎯 Target Audience",
        "hero.persona.text": "Specialized tool for<br>eBay sellers listing<br>50-1,200 items/month via Yaballe",
        "hero.stat.prefix.max": "Max",
        "hero.stat.1.label": "Time Reduction",
        "hero.stat.2.label": "Monthly Time Saved",
        "hero.stat.3.label": "First Month Cost",
        "hero.stat.note": "* Savings based on Premium plan at 1,500 items/month. Start with Pro 1-month free trial ($0) today.",
        "hero.cta.btn": "✨ Start Pro Free Trial",
        "hero.cta.note": "Completely free for the first month after registration.<br>No fees if cancelled during the trial period.",
        "comparison.tag": "Measured Data",
        "comparison.title": "For 50 listings per day",
        "comparison.before.label": "Without Tool",
        "comparison.unit": "min/day",
        "comparison.before.desc": "50 mins daily, 20 hours monthly listing work",
        "comparison.after.label": "Premium Plan",
        "comparison.after.desc": "Complete 1,200 items in just 4 hours",
        "features.tag": "Features",
        "features.title": "Solve tedious tasks with technology",
        "feature.1.title": "AI Title SEO Optimization",
        "feature.1.desc": "No more back-and-forth with ChatGPT. Instantly generate SEO-optimized titles (70-80 chars) designed to rank higher in eBay search results, all without leaving your listing page.",
        "feature.2.title": "Turbo Mode",
        "feature.2.desc": "Fully automated from ASIN paste to AI optimization and MIP click. Just prepare the next ASIN.",
        "feature.3.title": "Quick MIP & Auto OK",
        "feature.3.desc": "Zero effort to find the MIP button. Quick MIP and auto-clicking OK buttons minimize eye movement.",
        "feature.4.title": "History & Batch Copy",
        "feature.4.desc": "Track progress with ASIN history. Export to CSV or batch copy results in less than 5 seconds.",
        "feature.5.title": "VeRO & Duplicate Check",
        "feature.5.desc": "Automatically detect VeRO warnings and duplicate ASINs for safe high-volume operations.",
        "feature.6.title": "Statistics Dashboard",
        "feature.6.desc": "Real-time display of listing counts, time, and speed. Visualize your productivity daily and weekly.",
        "screenshots.tag": "Reality Check",
        "screenshots.title": "Seeing is believing",
        "ss.before.label": "❌ Before (Unoptimized)",
        "ss.before.caption": '<span class="review-highlight">153 characters</span>, exceeding limit. VeRO warnings often missed.',
        "ss.after.label": "✅ After (Optimized)",
        "ss.after.caption": 'One-click to <span class="review-highlight">75 characters</span>. Auto-check for VeRO and limits.',
        "ss.stats.label": "📊 Stats & ASIN History",
        "ss.stats.caption": "Real-time tracking of counts and speed. Up to 1,000 ASIN history with CSV export and batch copy.",
        "savings.tag": "Cost Comparison",
        "savings.title": "For 1,200 listings/month",
        "savings.col.none": "Without Tool",
        "savings.col.pro": "LFP Pro",
        "savings.col.premium": "LFP Premium",
        "savings.row.hours": "Labor (Hours/mo)",
        "savings.val.hours.none": "20 Hours",
        "savings.val.hours.pro": "5 Hours",
        "savings.val.hours.premium": "4 Hours",
        "savings.row.cost": "Labor Cost (@¥1,500/h)",
        "savings.val.cost.none": "¥30,000",
        "savings.val.cost.pro": "¥7,500",
        "savings.val.cost.premium": "¥6,000",
        "savings.row.fee": "Tool Fee",
        "savings.val.fee.none": "¥0",
        "savings.val.fee.pro": "¥2,980",
        "savings.val.fee.premium": "¥4,980",
        "savings.row.total": "Effective Cost",
        "savings.val.total.none": "¥30,000",
        "savings.val.total.pro": "¥10,480",
        "savings.val.total.premium": "¥10,980",
        "savings.row.result": "Monthly Savings",
        "savings.val.result.pro": "🎉 ¥19,520",
        "savings.val.result.premium": "🎉 ¥19,020",
        "savings.note": "* Delivers over <strong>6x value</strong> relative to the tool fee every month.",
        "pricing.tag": "Pricing Plans",
        "pricing.title": "Choose the best plan for you",
        "pricing.unit.month": "/ mo",
        "plan.free.desc": "To check basic features",
        "plan.free.feature.1": '<span class="check">✔</span> 2 AI Title Optimizations / day',
        "plan.free.feature.2": '<span class="check">✔</span> Quick MIP Button placement',
        "plan.free.feature.3": '<span class="check">✔</span> ASIN History (Up to 1,000)',
        "plan.btn.current": "Current Plan",
        "plan.pro.badge": "🔥 Most Popular",
        "plan.pro.trial": "✨ 1-Month Free Trial",
        "plan.pro.desc": "Maximize efficiency and make work enjoyable",
        "plan.pro.feature.1": '<span class="check">✔</span> <strong>Unlimited</strong> AI Title Optimization',
        "plan.pro.feature.2": '<span class="check">✔</span> ASIN History (Up to 1,000)',
        "plan.pro.feature.3": '<span class="check">✔</span> <strong>Quick MIP</strong> & Auto-OK Clicker',
        "plan.pro.feature.4": '<span class="check">✔</span> CSV Export & Batch Copy History',
        "plan.pro.feature.5": '<span class="check">✔</span> <div>5 <strong>Turbo Mode</strong> uses / day<br><span class="feature-note">(Fully automated after ASIN paste)</span></div>',
        "plan.pro.btn": "Start Pro Trial for Free",
        "plan.pro.note": "* Completely free for 1 month. Cancel anytime.",
        "plan.premium.badge": "👑 Ultimate",
        "plan.premium.desc": "Ultimate automation - Buy back your time",
        "plan.premium.feature.1": '<span class="check">✔</span> <strong>All features</strong> in Pro Plan',
        "plan.premium.feature.2": '<span class="check">✔</span> <div><strong>Unlimited</strong> Turbo Mode<br><span class="feature-note">(Fully automated after ASIN paste)</span></div>',
        "plan.premium.feature.3": '<span class="check">✔</span> Priority Support & Beta Early Access',
        "plan.premium.feature.4": '<span class="check">✔</span> Maximize productivity for large accounts',
        "plan.premium.btn": "Upgrade to Premium Plan",
        "testimonials.tag": "User Testimonials",
        "testimonials.title": "Reviews from Beta Testers",
        "review.a.user": "User A",
        "review.a.text": 'Listing speed wasn\'t just doubled; it was more like <span class="review-highlight">3x</span>. I finished 30 items before I knew it. Tasks that usually took <span class="review-highlight">30 minutes</span> were done in <span class="review-highlight">10 minutes</span>. ASIN automation eliminates annoying tasks like window switching and ChatGPT copying. Extremely helpful for high-volume seasons.',
        "review.b.user": "User B",
        "review.b.text": 'Listing time reduced to about <span class="review-highlight">1/3</span>. It was so easy that I wondered why I spent so much time before. Great help during my busy certification exams and fiscal year-end.',
        "review.c.user": "User C",
        "review.c.text": "Thank you for this amazing tool. The burden is completely different compared to when we had 4 people doing 50 listings. Very impressed with the smooth experience.",
        "review.d.user": "User D",
        "review.d.text": "The setup and listing process went perfectly. I'm moved by how much time I saved. Thank you so much for developing and sharing this system.",
        "review.e.user": "User E",
        "review.e.text": "Saved a lot of time by not using ChatGPT and barely scrolling on Yaballe. Since I manage 3 stores with 50 listings each, the impact is huge. Thanks for the development.",
        "testimonials.note": "* Feedback from beta testers as of v1.0.0 (before Turbo Mode).",
        "faq.tag": "FAQ",
        "faq.title": "Frequently Asked Questions",
        "faq.q.1": "Will I be charged automatically after the trial?",
        "faq.a.1": "Pro plan includes a 1-month free trial. There are <strong>no fees</strong> if you cancel during the trial period via Stripe Customer Portal.",
        "faq.q.2": "Can I cancel anytime?",
        "faq.a.2": "Yes. You can cancel via the link in your payment email or by contacting support. Access continues until the current billing period ends even after cancellation.",
        "faq.q.3": "Can I use it on multiple accounts?",
        "faq.a.3": "One license key is tied to one Yaballe store account. You need multiple licenses for multiple accounts.",
        "faq.q.4": "What's the difference between Pro and Premium?",
        "faq.a.4": "Pro focuses on speeding up manual tasks with 5 Turbo uses/day. Premium offers <strong>unlimited</strong> Turbo Mode for full automation. Recommended for users listing 600+ items/month.",
        "faq.q.5": "How is the license activated?",
        "faq.a.5": "After payment, simply <strong>log in to Yaballe</strong> with the same account. Your Pro features will be activated automatically. No manual input is required.<br><br>*The license key will also be sent via email, so please keep it as a backup.<br><span class=\"feature-note\" style=\"color: #e53e3e;\">*Please ensure you purchase using the same email address registered to your Yaballe account.</span>",
        "footer.copy": "© 2026 ListerFlow Pro by KURONYLAB. All rights reserved.",
        "footer.hint": "* After upgrading, your Pro features will be automatically activated when you log in to Yaballe with your purchase account. The license key is also sent via email; please keep it for your records.",
        "nav.features": "Features",
        "nav.reviews": "Reviews",
        "nav.pricing": "Pricing",
        "nav.faq": "FAQ",
        "nav.tokusho": "Terms",
        "nav.cta": "View Plans",
        "plan.btn.current": "Currently Using",
        "plan.btn.current_manage": "Currently Using (Manage)",
        "loading": "Processing...",
        "plan.btn.downgrade.pro": "Downgrade to Pro Plan",
        "plan.btn.downgrade.free": "Downgrade to Free Plan",
        "tokusho.tag": "Legal",
        "tokusho.title": "Act on Specified Commercial Transactions",
        "tokusho.label.vendor": "Vendor",
        "tokusho.value.vendor": "KURONYLAB",
        "tokusho.label.manager": "Representative",
        "tokusho.value.manager": "Kouki Kuroki",
        "tokusho.label.location": "Location",
        "tokusho.value.location": "(Disclosed without delay upon request)",
        "tokusho.label.contact": "Contact",
        "tokusho.value.contact.email": "Email: ",
        "tokusho.value.contact.line": "Support LINE: ",
        "tokusho.value.contact.line.link": "Join here",
        "tokusho.value.contact.line.note": " (Response: typically within 24 hours)",
        "tokusho.label.price": "Selling Price",
        "tokusho.value.price.free": "Free Plan: Free",
        "tokusho.value.price.pro": "Pro Plan: 2,980 yen/month (Tax included)",
        "tokusho.value.price.premium": "Premium Plan: 4,980 yen/month (Tax included)",
        "tokusho.label.payment_method": "Payment Method",
        "tokusho.value.payment_method": "Credit Card (Stripe Payment)<br>Supported: Visa / Mastercard / American Express, etc.",
        "tokusho.label.payment_timing": "Payment Timing",
        "tokusho.value.payment_timing": "Immediate payment upon application. Renews automatically on the same day each month.",
        "tokusho.label.delivery_timing": "Service Delivery",
        "tokusho.value.delivery_timing": "License is activated immediately after payment completion.",
        "tokusho.label.service_content": "Service Content",
        "tokusho.value.service_content": "Digital service providing access to paid plans for the 'ListerFlow Pro for Yaballe' Chrome extension. No physical items are shipped.",
        "tokusho.label.cancellation": "Cancellation/Refund",
        "tokusho.value.cancellation": "Subscriptions can be cancelled anytime. If cancelled by the last day, no further charges apply. Due to the nature of digital services, refunds for paid fees are generally not accepted.",
        "tokusho.label.environment": "Requirements",
        "tokusho.value.environment": "PC with Google Chrome (latest version) installed.<br>Supported site: app.yaballe.com",
        "footer.contact": "Contact Us"
    }
};

function setLanguage(lang) {
    if (!translations.hasOwnProperty(lang)) return;

    document.querySelectorAll("[data-i18n]").forEach(el => {
        const key = el.getAttribute("data-i18n");
        if (translations[lang].hasOwnProperty(key)) {
            const translation = translations[lang][key];
            if (el.tagName === 'META') {
                el.setAttribute('content', translation);
            } else if (el.tagName === 'TITLE') {
                document.title = translation;
            } else {
                el.innerHTML = translation;
            }
        }
    });

    localStorage.setItem("preferred_lang", lang);
    document.getElementById("langSwitch").value = lang;
}

function applyI18n() {
    const savedLang = localStorage.getItem("preferred_lang") || (navigator.language.startsWith('ja') ? 'ja' : 'en');
    setLanguage(savedLang);
}

document.addEventListener('DOMContentLoaded', () => {
    // Initialize i18n
    applyI18n();

    const upgradeProBtn = document.getElementById('upgradeProBtn');
    const upgradePremiumBtn = document.getElementById('upgradePremiumBtn');
    const freeBtn = document.getElementById('freeBtn');

    // UI Feedback function
    const showLoading = (btn) => {
        const lang = localStorage.getItem("preferred_lang") || (navigator.language.startsWith('ja') ? 'ja' : 'en');
        const loadingText = (translations[lang] && translations[lang]["loading"]) || (lang === 'ja' ? "処理中..." : "Processing...");
        const originalText = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = `<span class="spinner"></span> ${loadingText}`;
        return originalText;
    };

    const restoreButton = (btn, originalText) => {
        btn.disabled = false;
        btn.innerHTML = originalText;
    };

    // Plan check from URL or Storage
    const checkCurrentPlan = async () => {
        chrome.storage.local.get(['lfp_license_v1'], (result) => {
            const license = result.lfp_license_v1 || {};
            let plan = (license.plan || 'free').toLowerCase();

            // Proトライアル判定も念のため考慮
            if (plan === 'free') {
                // background.js等でのトライアル判定ロジックと合わせる必要があるが、
                // 基本的には license.plan が正しく同期されている前提
            }

            const lang = localStorage.getItem("preferred_lang") || (navigator.language.startsWith('ja') ? 'ja' : 'en');
            const currentText = translations[lang]["plan.btn.current"] || "現在利用中";
            const currentManageText = translations[lang]["plan.btn.current_manage"] || "現在利用中（管理）";
            const downProText = translations[lang]["plan.btn.downgrade.pro"] || "Proプランへ戻る";
            const downFreeText = translations[lang]["plan.btn.downgrade.free"] || "Freeプランへ戻る";

            // 全カードのリセット（初期化）
            document.querySelectorAll('.card').forEach(c => {
                c.classList.remove('current');
            });

            // ボタンのリセット
            [upgradeProBtn, upgradePremiumBtn, freeBtn].forEach(btn => {
                if (btn) {
                    btn.disabled = false;
                    btn.classList.remove('btn-current');
                    btn.dataset.action = ""; // Reset
                }
            });

            if (plan === 'pro' || plan === 'pro-trial') {
                // Proカード
                upgradeProBtn.innerHTML = currentManageText;
                upgradeProBtn.disabled = false;
                upgradeProBtn.classList.add('btn-current');
                upgradeProBtn.dataset.action = "portal";
                document.getElementById('card-pro')?.classList.add('current');
                
                // Premiumカード -> アップグレードボタン（ポータル経由）
                if (upgradePremiumBtn) {
                    upgradePremiumBtn.dataset.action = "portal";
                }

                // Freeカード -> ダウングレード（解約）ボタンに
                if (freeBtn) {
                    freeBtn.innerHTML = downFreeText;
                    freeBtn.disabled = false;
                    freeBtn.dataset.action = "portal";
                }
            } else if (plan === 'premium') {
                // Premiumカード
                upgradePremiumBtn.innerHTML = currentManageText;
                upgradePremiumBtn.disabled = false;
                upgradePremiumBtn.classList.add('btn-current');
                upgradePremiumBtn.dataset.action = "portal";
                document.getElementById('card-premium')?.classList.add('current');
                
                // Proカード -> ダウングレードボタンに
                if (upgradeProBtn) {
                    upgradeProBtn.innerHTML = `<span>${downProText}</span>`;
                    upgradeProBtn.disabled = false;
                    upgradeProBtn.dataset.action = "portal";
                }

                // Freeカード -> ダウングレードボタンに
                if (freeBtn) {
                    freeBtn.innerHTML = downFreeText;
                    freeBtn.disabled = false;
                    freeBtn.dataset.action = "portal";
                }
            } else {
                // Freeプラン (新規申し込み)
                if (freeBtn) {
                    freeBtn.innerHTML = currentText;
                    freeBtn.disabled = true;
                    freeBtn.classList.add('btn-current');
                    document.getElementById('card-free')?.classList.add('current');
                }
            }
        });
    };

    // カスタマーポータルを開く（ダウングレード/解約用）
    const openCustomerPortal = async (btnElement) => {
        let originalText = "";
        if (btnElement) {
            originalText = showLoading(btnElement);
        }

        const storage = await chrome.storage.local.get(['lfp_current_yaballe_email']);
        const email = storage.lfp_current_yaballe_email;
        if (!email) {
            if (btnElement) restoreButton(btnElement, originalText);
            alert("Yaballeのアカウント情報が見つかりません。");
            return;
        }

        chrome.runtime.sendMessage({
            type: "LFP_LICENSE_SERVER_REQUEST",
            payload: { action: "create_portal_session", email: email }
        }, (response) => {
            if (chrome.runtime.lastError) {
                console.error("[LFP-Purchase] Runtime Error (Portal):", chrome.runtime.lastError.message);
                if (btnElement) restoreButton(btnElement, originalText);
                alert("通信エラーが発生しました。拡張機能を再読み込みして再度お試しください。\n詳細: " + chrome.runtime.lastError.message);
                return;
            }
            console.log("[LFP-Purchase] Portal response:", JSON.stringify(response));
            if (response && response.ok && response.data?.status === 'success' && response.data?.portalUrl) {
                window.location.href = response.data.portalUrl;
            } else {
                if (btnElement) restoreButton(btnElement, originalText);
                const errorMsg = response?.data?.message || response?.error || "不明なエラー";
                alert("カスタマーポータルの作成に失敗しました。\nエラー: " + errorMsg);
            }
        });
    };

    checkCurrentPlan();

    const langSwitch = document.getElementById("langSwitch");
    if (langSwitch) {
        langSwitch.addEventListener("change", (e) => {
            setLanguage(e.target.value);
            checkCurrentPlan(); // スコープ内なので確実に動作
        });
    }

    // Event Listeners for Upgrade
    upgradeProBtn.addEventListener('click', async () => {
        if (upgradeProBtn.dataset.action === "portal") {
            openCustomerPortal(upgradeProBtn);
            return;
        }
        if (upgradeProBtn.classList.contains('btn-current')) return;
        
        const originalText = showLoading(upgradeProBtn);
        console.log("[LFP-Purchase] Upgrade Pro clicked. Email detection start...");
        try {
            // Yaballeのアカウント情報を取得
            const storage = await chrome.storage.local.get(['lfp_current_yaballe_email']);
            const email = storage.lfp_current_yaballe_email;
            console.log("[LFP-Purchase] Detected email:", email);

            if (!email) {
                restoreButton(upgradeProBtn, originalText);
                alert("Yaballeのアカウント情報が見つかりません。先にYaballe（app.yaballe.com）にログインしてからこのページをリロードしてください。");
                return;
            }

            console.log("[LFP-Purchase] Sending LFP_LICENSE_SERVER_REQUEST for Pro...");
            chrome.runtime.sendMessage({
                type: "LFP_LICENSE_SERVER_REQUEST",
                payload: {
                    action: "create_checkout",
                    plan: "pro",
                    email: email
                }
            }, (response) => {
                if (chrome.runtime.lastError) {
                    console.error("[LFP-Purchase] Runtime Error (Pro):", chrome.runtime.lastError.message);
                    restoreButton(upgradeProBtn, originalText);
                    alert("通信エラーが発生しました。拡張機能を再読み込みして再度お試しください。\n詳細: " + chrome.runtime.lastError.message);
                    return;
                }
                console.log("[LFP-Purchase] Received response for Pro:", JSON.stringify(response));
                if (response && response.ok && response.data && response.data.url) {
                    console.log("[LFP-Purchase] Redirecting to:", response.data.url);
                    window.location.href = response.data.url;
                } else {
                    const errorMsg = response?.data?.message || response?.error || "不明なエラー (Server Error)";
                    console.error("[LFP-Purchase] Failed to create checkout session:", errorMsg, response);
                    restoreButton(upgradeProBtn, originalText);
                    alert("チェックアウトセッションの作成に失敗しました。しばらくしてから再度お試しください。\nエラー: " + errorMsg);
                }
            });
        } catch (error) {
            console.error("[LFP-Purchase] System Error:", error);
            restoreButton(upgradeProBtn, originalText);
            alert("システムエラーが発生しました。");
        }
    });

    upgradePremiumBtn.addEventListener('click', async () => {
        if (upgradePremiumBtn.dataset.action === "portal") {
            openCustomerPortal(upgradePremiumBtn);
            return;
        }
        if (upgradePremiumBtn.classList.contains('btn-current')) return;
        
        const originalText = showLoading(upgradePremiumBtn);
        console.log("[LFP-Purchase] Upgrade Premium clicked. Email detection start...");
        try {
            // Yaballeのアカウント情報を取得
            const storage = await chrome.storage.local.get(['lfp_current_yaballe_email']);
            const email = storage.lfp_current_yaballe_email;
            console.log("[LFP-Purchase] Detected email:", email);

            if (!email) {
                restoreButton(upgradePremiumBtn, originalText);
                alert("Yaballeのアカウント情報が見つかりません。先にYaballe（app.yaballe.com）にログインしてからこのページをリロードしてください。");
                return;
            }

            console.log("[LFP-Purchase] Sending LFP_LICENSE_SERVER_REQUEST for Premium...");
            chrome.runtime.sendMessage({
                type: "LFP_LICENSE_SERVER_REQUEST",
                payload: {
                    action: "create_checkout",
                    plan: "premium",
                    email: email
                }
            }, (response) => {
                if (chrome.runtime.lastError) {
                    console.error("[LFP-Purchase] Runtime Error (Premium):", chrome.runtime.lastError.message);
                    restoreButton(upgradePremiumBtn, originalText);
                    alert("通信エラーが発生しました。拡張機能を再読み込みして再度お試しください。\n詳細: " + chrome.runtime.lastError.message);
                    return;
                }
                console.log("[LFP-Purchase] Received response for Premium:", JSON.stringify(response));
                if (response && response.ok && response.data && response.data.url) {
                    console.log("[LFP-Purchase] Redirecting to:", response.data.url);
                    window.location.href = response.data.url;
                } else {
                    const errorMsg = response?.data?.message || response?.error || "不明なエラー (Server Error)";
                    console.error("[LFP-Purchase] Failed to create checkout session:", errorMsg, response);
                    restoreButton(upgradePremiumBtn, originalText);
                    alert("チェックアウトセッションの作成に失敗しました。しばらくしてから再度お試しください。\nエラー: " + errorMsg);
                }
            });
        } catch (error) {
            console.error("[LFP-Purchase] System Error:", error);
            restoreButton(upgradePremiumBtn, originalText);
            alert("システムエラーが発生しました。");
        }
    });

    if (freeBtn) {
        freeBtn.addEventListener('click', async () => {
            if (freeBtn.classList.contains('btn-current')) return;
            if (freeBtn.dataset.action === "portal") {
                openCustomerPortal(freeBtn);
                return;
            }
        });
    }
});
