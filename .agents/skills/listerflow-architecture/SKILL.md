---
name: ListerFlow Pro アーキテクチャガイド
description: ListerFlow Pro for Yaballe プロジェクト全体の構造、データフロー、ストレージ設計、API仕様をまとめたリファレンス。新しい会話で即座にコンテキストを把握するためのドキュメント。
---

# ListerFlow Pro アーキテクチャガイド

## 概要

**ListerFlow Pro for Yaballe** は、eBay 向け出品ツール Yaballe での作業を効率化する Chrome 拡張機能。AI タイトル最適化、VeRO 検知、全自動出品（ターボモード）、サブスクリプション課金を提供する。

---

## 1. ファイル構成と役割

```
listerflow-pro-for-yaballe-sabscription/
├── manifest.json                    # Chrome 拡張設定（Manifest V3）
├── README.md                        # ユーザー向けドキュメント
├── LICENSE                          # 商用ライセンス
├── assets/icons/                    # 拡張機能アイコン
├── src/
│   ├── sw/
│   │   └── background.js           # Service Worker（中継局 + タイマー管理）
│   ├── content/
│   │   ├── content.js              # Content Script（Yaballe操作 + UI描画）
│   │   ├── content.css             # 作業画面内の注入CSS
│   │   └── modules/               # content.js のモジュール分割
│   ├── popup/
│   │   ├── popup.html              # ポップアップ画面
│   │   ├── popup.js                # ポップアップロジック（設定・統計）
│   │   ├── popup.css               # ポップアップスタイル
│   │   ├── popup_patch.js          # パッチ（段階的統合予定）
│   │   ├── export.html/js/css      # 履歴エクスポート画面
│   ├── pages/
│   │   ├── purchase.html           # 購入ページ（拡張機能内タブ）
│   │   ├── purchase.js             # 購入ロジック（Stripe連携）
│   │   └── purchase.css            # 購入ページスタイル
├── gas/
│   └── backend_v2.gs               # GAS バックエンド（Stripe + ライセンス管理）
└── github-pages/
    └── index.html                   # ランディングページ（GitHub Pages）
```

---

## 2. データフロー

```mermaid
graph LR
    subgraph "Chrome 拡張機能"
        CS[Content Script<br>content.js]
        SW[Service Worker<br>background.js]
        PP[Popup<br>popup.js]
        PG[Purchase Page<br>purchase.js]
    end

    subgraph "外部サービス"
        GAS[GAS Backend<br>backend_v2.gs]
        SS[スプレッドシート<br>Licenses/Stores/TrialUsed]
        ST[Stripe API]
        OAI[OpenAI API]
    end

    CS -->|"LFP_OPENAI"| SW
    SW -->|"fetch"| OAI
    CS -->|"LFP_UPDATE_STATS"| SW
    CS -->|"LFP_TIMER_CONTROL"| SW
    CS -->|"LFP_YABALLE_ACCOUNT_DETECTED"| SW
    PG -->|"LFP_LICENSE_SERVER_REQUEST"| SW
    PP -->|"LFP_GET_STATS"| SW
    SW -->|"POST"| GAS
    GAS -->|"read/write"| SS
    GAS -->|"UrlFetchApp"| ST
    SW -->|"LFP_SYNC_UI"| CS
```

---

## 3. メッセージタイプ一覧

### Content Script / Pages → Service Worker

| type | 用途 | 非同期 |
|---|---|---|
| `LFP_OPENAI` | OpenAI API 呼び出し | ✅ |
| `LFP_TIMER_CONTROL` | タイマー開始/停止 | ✅ |
| `LFP_UPDATE_STATS` | 出品完了時の統計更新 | ✅ |
| `LFP_UPDATE_INPUT_TIME` | ASIN入力時刻の更新 | ✅ |
| `LFP_SYNC_REQUEST` | UI同期リクエスト | ❌ |
| `LFP_HEARTBEAT` | Service Worker 生存確認 | ❌ |
| `LFP_GET_STATS` | 統計情報取得 | ✅ |
| `RESET_STATS` | 統計情報リセット | ✅ |
| `CLEAR_HISTORY` | ASIN履歴クリア | ✅ |
| `LFP_YABALLE_ACCOUNT_DETECTED` | Yaballe アカウント検知 | ✅ |
| `LFP_LICENSE_SERVER_REQUEST` | GAS サーバーへのリクエスト中継 | ✅ |

### Service Worker → Content Script

| type | 用途 |
|---|---|
| `LFP_SYNC_UI` | UI再描画トリガー |
| `LFP_ACCOUNT_CHANGED` | アカウント切り替え通知 |

---

## 4. GAS API エンドポイント

`LFP_LICENSE_SERVER_REQUEST` 経由で送るアクション一覧。

| action | 用途 | 入力 | 出力 |
|---|---|---|---|
| `create_checkout` | Checkout Session 作成 | `{ email, plan }` | `{ url }` |
| `check_trial_eligibility` | トライアル資格確認 | `{ email }` | `{ eligible, trialUsed, hasActiveSubscription }` |
| `apply_license` | ライセンスキー認証 | `{ email, licenseKey }` | `{ plan }` |
| `check_trial` | ライセンス状態確認 | `{ email }` | `{ plan, cancelAt, nextBillingDate, ... }` |
| `create_portal_session` | カスタマーポータルURL取得 | `{ email }` | `{ portalUrl }` |

---

## 5. chrome.storage キー一覧

### sync（デバイス間同期）

| キー | 型 | 内容 |
|---|---|---|
| `lfp_options_v1` | Object | 設定値（apiKey, model, 各種トグル） |

### local（ローカル専用）

| キー | 型 | 内容 |
|---|---|---|
| `lfp_stats_v1` | Object | 統計情報（todayListings, totalWorkTimeToday 等） |
| `lfp_asin_history_v1` | Array | ASIN 出品履歴 |
| `lfp_license_v1` | Object | ライセンス情報（plan, licenseKey, usageCount） |
| `lfp_license_plan` | String | 現在のプラン（`free`/`pro`/`premium`） |
| `lfp_current_yaballe_email` | String | 現在の Yaballe アカウントメール |
| `lfp_licenses_by_account` | Object | アカウント別ライセンス辞書 |
| `lfp_pro_trial_start_date` | String | ローカルトライアル開始日 |
| `lfp_turbo_auto_disabled` | Boolean | Turbo 自動OFF フラグ |
| `lfp_turbo_auto_disabled_{email}` | Boolean | アカウント別 Turbo 自動OFF |

---

## 6. デプロイ手順

### GAS バックエンド

1. GAS エディタでコードを更新
2. **デプロイ** → **デプロイを管理** → 鉛筆アイコン
3. **バージョン**: **新しいバージョン** を選択 → **デプロイ**
4. URL は変わらない（バージョンが切り替わるだけ）

### Chrome 拡張機能

1. ファイルを編集・保存
2. `chrome://extensions/` → ListerFlow Pro の **リロード** ボタン
3. Yaballe のタブをリロード

### Stripe 設定変更

1. Stripe Dashboard → 設定変更
2. 必要に応じて Webhook エンドポイントのイベントを追加
3. テストモードで動作確認後、ライブモードに切替

---

## 7. 環境切替

| 項目 | テスト | 本番 |
|---|---|---|
| Stripe Key | `sk_test_...` | `sk_live_...` |
| Price ID | テスト用 `price_...` | 本番用 `price_...` |
| GAS URL | テストデプロイ URL | 本番デプロイ URL |
| ポータル URL | `test_` 付き | 本番用 |

> **注意**: GAS のスクリプトプロパティを切り替えるだけで OK。コード変更は不要。

---

## 8. 多言語対応 (i18n) — 翻訳キー用語集

### 開発ルール
**コンテントスクリプト内 UI 文字列はすべて `chrome.i18n.getMessage("キー")` を使用すること。**  
ハードコードされた日本語を直接コードに書くことは禁止。翻訳ファイルは `_locales/ja/messages.json` および `_locales/en/messages.json` に集約する。

> **Turbo Mode の状態判定**は `UI.status.textContent` のテキストパースではなく、`STORE.optimizeState.needsOptimize` / `STORE.optimizeState.isListable` フラグで行うこと。`setStatusLine()` が `highlight` 引数から `needsOptimize` フラグを自動セットする。

### 2026-04-06 追加キー一覧

| キー | JA | EN |
| :--- | :--- | :--- |
| `uiOptimize` | 最適化 | Optimize |
| `uiOptimizing` | 最適化中 | Optimizing... |
| `uiReOptimize` | 再実行 | Re-optimize |
| `uiCharacters` | 文字数 | Chars |
| `uiVero` | Vero | Vero |
| `uiListing` | 出品 | List |
| `uiReset` | ×リセット | ×Reset |
| `uiCopy` | 📋コピー | 📋Copy |
| `uiCsv` | 📊CSV | 📊CSV |
| `uiStats` | 📈統計情報 | 📈Stats |
| `uiStatsDetailed` | 統計情報を表示 | View Statistics |
| `uiStatsTitle` | 統計情報 | Statistics |
| `uiStatsHeader` | 📊 出品統計 | 📊 Listing Stats |
| `uiWorkingEfficiency` | 🚀 作業効率 | 🚀 Efficiency |
| `uiTodayListings` | 本日の出品 | Today's Listings |
| `uiWeekListings` | 今週の出品 | Weekly Listings |
| `uiTotalListings` | 累計出品 | Total Listings |
| `uiLastListing` | 最後の出品 | Last Listing |
| `uiTodayWorkTime` | 本日の作業時間 | Today's Work Time |
| `uiListingSpeed` | 出品速度 | Listing Speed |
| `uiAsinHistoryTitle` | 📋 ASIN履歴 | 📋 ASIN History |
| `uiHistoryCountPlaceholder` | ASIN履歴（直近1000件） | ASIN History (Recent 1000) |
| `uiErrorRate` | エラー率 | Error Rate |
| `uiResetStats` | 統計をリセット | Reset Stats |
| `uiCompleted` | 出品完了 | Completed |
| `uiUnitItems` | 件 | items |
| `uiUnitItemsSuffix` | 品/時 | items/hr |
| `uiConfirmResetStats` | 統計情報をリセットしますか？ | Reset all statistics? |
| `uiResetStatsTitle` | 統計リセット | Reset Stats |
| `msgNoHistoryToCopy` | コピーする履歴がありません | No history to copy |
| `msgNoHistoryToExport` | 出力する履歴がありません | No history to export |
| `uiAdminMode` | 管理者モード：無制限 | Admin: Unlimited |
| `uiPlanProTrial` | Pro (Trial) | Pro (Trial) |
| `uiPlanDaysLeft` | 残り$1日 | $1 days left |
| `uiPlanCancelScheduled` | ($1解約予定) | (Cancels on $1) |
| `msgExtensionUpdated` | 拡張機能が更新されました。ページをリロードして再度お試しください。 | The extension was updated. Please reload the page and try again. |
| `msgTurboLimitReached` | 本日のTurbo Mode試用制限（5回）に達しました... | Daily Turbo Mode trial limit (5 uses) reached... |
| `msgTurboLimitTitle` | Premium限定機能 | Premium Feature |
| `msgConfirmClearHistory` | ASIN履歴をすべて削除しますか？ | Delete all ASIN history? |
| `msgConfirmClearHistoryTitle` | ASIN履歴リセット | Clear ASIN History |
| `msgHistoryCleared` | ASIN履歴をリセットしました | ASIN history has been cleared. |
| `msgHistoryClearedTitle` | 完了 | Done |
| `msgHistoryClearError` | リセット中にエラーが発生しました。 | An error occurred while clearing history. |
| `msgHistoryClearErrorTitle` | エラー | Error |
| `csvHeaderAsin` | ASINコード | ASIN |
| `csvHeaderResult` | 結果 | Result |
| `csvHeaderListedDate` | 出品日 | Listed Date |
| `csvHeaderErrorDate` | エラーにより出品不可 | Error Date |
| `msgDailyUsage` | 本日の使用状況: $1 / $2 | Today's usage: $1 / $2 |
| `msgTrialExpired` | 試用終了（アップグレードはこちら） | Trial ended — Upgrade here |
| `uiDeleteHistoryItem` | この履歴を削除 | Delete this entry |
| `uiConfirmDefault` | 確認 | Confirm |
| `uiAlertDefault` | お知らせ | Notice |
| `uiCancel` | キャンセル | Cancel |
| `uiPauseResume` | クリックで再開/一時停止 | Click to pause/resume |
| `uiResume` | クリックで再開 | Click to resume |
| `uiPause` | クリックで一時停止 | Click to pause |
| `uiCopyDone` | ✅完了 | ✅Done |
| `uiCopyFail` | ❌ コピー失敗 | ❌Failed |
