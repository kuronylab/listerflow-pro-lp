# 実装計画: 多言語対応の完全修正 (残存日本語の排除)

## 1. コンテキスト (Codex 参照)
> 指摘事項: 言語設定を英語にしても、一部の UI (ボタン、統計ポップアップ、ラベル) が日本語のまま残っている。

- **参照 Codex/Skill**:
  - `skills/listerflow-architecture/SKILL.md` (全体構造)
  - `_locales/en/messages.json`, `_locales/ja/messages.json` (既存の翻訳ファイル)
- **現状の制約**:
  - コンテントスクリプト (`content.js`, `history-ui.js`, `worktime.js`) 内で UI 文字列が直接日本語でハードコードされている。
  - すでに `chrome.i18n` の仕組みは導入されているため、これを利用して統一する。

## 2. ゴール
- 言語を英語（EN）に設定した際、すべての UI 表示、ポップアップ、警告、履歴リストが英語で表示されるようにする。
- 翻訳キーを `messages.json` に集約し、保守性を高める。

## 3. 実装ステップ (Claude Code への指示)

### STEP 1: 翻訳ファイルの更新
`_locales/ja/messages.json` と `_locales/en/messages.json` に、不足している以下のキーを追加してください。

| キー | 日本語 (JA) | 英語 (EN) |
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

### STEP 2: コンテントスクリプトの修正
以下のファイル内の日本語テキストを `chrome.i18n.getMessage("キー")` に置き換えてください。

1.  **`src/content/content.js`**:
    -   `init()` 内のボタン (`resetBtn`, `copyBtn`, `csvBtn`, `statsBtn`) の `textContent` と `title`。
    -   `ensureUIBelowTitle`, `setBusy`, `setStatusLine` 内のステータス文字列（文字数、Vero、出品）。
    -   `handleTurboListing` 内の判定用文字列「出品：OK（最適化後）」などを定数またはキー判定に変更。
    -   `csvBtn` クリック時のファイル名（`LFP_ASIN履歴_...`）もローカライズ。

2.  **`src/content/history-ui.js`**:
    -   `refreshHistorySelect` 内の `ASIN履歴...`。
    -   `refreshListingCountUI` 内の「出品完了」「本日の作業時間」「ランク（爆速など）」
    -   `refreshCustomDropdown` 内の `No listings`, `No item` などのフラグ表示。

3.  **`src/content/worktime.js`**:
    -   `renderStatsOnlyPopup` 内のポップアップ内全てのラベル（本日の出品、出品統計など）。
    -   時間のフォーマット（`〜時間〜分〜秒` → $1h $2m $3s 形式へ）。

### STEP 3: ダイアログと通知の修正
- `alert` や `confirm` で使われている日本語（「統計リセットしますか？」など）をすべて `chrome.i18n.getMessage` に変更。

## 4. 動作確認 (Validation)
- [ ] 拡張機能の設定画面で言語を英語に変更した際、すべての UI が英語で表示されることを確認。
- [ ] 言語を日本語に戻した際、以前通りの日本語で正しく表示されることを確認。
- [ ] ASIN履歴のコピー・CSV出力が正常に動作することを確認。

## 5. Codex への記録 (Post-Implementation)
- **更新ファイル**: `.agents/skills/listerflow-architecture/SKILL.md`
- **追記内容**:
  - 新しく定義した翻訳キーを用語集として追記。
  - コンテントスクリプトでの UI 文字列実装は必ず `chrome.i18n.getMessage` を使用することを開発ルールに追記。
