# Claude Code 連携 (実装計画・実行フロー)

このスキルは、Gemini (Antigravity) が「設計・計画」を行い、Claude Code が「実行」するための連携パターンを定義します。

## 役割の定義

1.  **Gemini (Antigravity)**: 「実装計画 (Implementation Plan)」の策定。
    -   ユーザーの「やりたいこと」を深く理解し、詳細な設計書を作成する。
    -   既存コードへの影響、修正すべきファイル、新規作成するファイルのパスを特定する。
    -   **自身ではコードを書かない（コードブロックを出力せず、計画書へのポインタのみを示す）。**
2.  **Claude Code (ターミナル)**: 「実行」の担当。
    -   Gemini が作成した計画書を読み、ターミナル上で一気に実装を完了させる。

## Codex (長期記憶) との連携

このフローにおいて Codex は「プロジェクトの憲法・歴史・現状」を記録する SSOT (Single Source of Truth) です。

### 1. Gemini による Codex の読解
- 計画策定前に、必ず `.agents/skills/` やプロジェクト内のドキュメント（Codex）を読み込み、設計の不整合を防ぐ。
- 計画書の「背景・コンテキスト」セクションに、Codex のどの部分に基づいているかを明記する。

### 2. Claude Code による Codex の更新
- Gemini は計画書の最後に必ず「Codex の更新タスク」を含める。
- 実装が完了した後、その成果（新しい定数、データ構造、設計判断）を Codex ファイルに反映させるよう Claude Code に指示する。

## 実装計画 (Plan) の構成

Gemini は、`.agents/plans/[日付]_[タスク名]/` ディレクトリを作成し、以下のファイルを生成します：

-   `PLAN.md`: 実装の詳細。
    -   **Context (Codex Reference)**: 参照した Codex の情報。
    -   **Steps**: 実装の具体的なステップ。
    -   **Validation**: 動作確認方法。
    -   **Codex Updates**: 完了後に Codex のどのファイルをどう更新すべきかの指示。
-   `context/`: 必要に応じて、参考にするドキュメントやログを配置。

## 実行ワークフロー (ユーザーの指示)

### ステップ 1: Gemini (Antigravity) への相談
ユーザーが Gemini に対して「[アプリの詳細] を実現するための実装計画を作成して」と依頼します。

### ステップ 2: Gemini の対応
Gemini は、計画書ディレクトリを作成後、ユーザーに対して以下のメッセージを出力します。

> ✅ 実装計画を作成しました: `.agents/plans/yyyy-mm-dd_task-name/PLAN.md`
>
> 以下のコマンドをコピーして、Claude Code (ターミナル) で実行してください。
> ```bash
> claude "Read .agents/plans/yyyy-mm-dd_task-name/PLAN.md and implement it."
> ```

## 注意事項
-   計画書は「Claude Code が一発で理解できる」ように具体的に記載する。
-   ファイルパス、APIキーの名前、環境変数の扱いに注意する。
-   Gemini は、計画書作成ツール (`write_to_file`) を使い、プレビュー (`view_file`) を通じて整合性を確認する。
