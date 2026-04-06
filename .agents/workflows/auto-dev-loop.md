---
description: Gemini + Claude Code + Codex 連携による自動開発ループ
---

このワークフローは、Gemini (Antigravity) が設計を行い、Claude Code が実装を担当し、最後に Codex に記録を残す一連の自動化サイクルを定義します。

## 実行ステップ

### 1. 準備・コンテキスト解析
- ユーザーの依頼を受け、関連する `skills/` や `docs/` (Codex) を読み込む。
- 既存の設計ルールや制限事項を特定する。

### 2. 三位一体の計画書 (PLAN.md) の作成
- `.agents/plans/[日付]_[タスク名]/` ディレクトリを作成する。
- その中に `PLAN.md` を作成し、以下の内容を記述する：
    - **Reference**: 参照した Codex/Skill。
    - **Step-by-Step Instructions**: Claude Code への具体的実装指示。
    - **Validation**: 実装後の確認テスト/コマンド。
    - **Codex Update**: 完了後に更新すべき Codex ファイルのリスト。

### 3. Claude Code への実装委任 (実行)
// turbo
- `run_command` を使い、以下のコマンドを実行（または提案）する：
  ```bash
  claude "Apply implementation plan from .agents/plans/[日付]_[タスク名]/PLAN.md"
  ```
- **重要**: `/turbo` アノテーションにより、ユーザーの承認後に即座に実行されるようにする。

### 4. 実行結果の検証と Codex への書き込み
- Claude Code の実行が完了したら、生成されたコードやログを確認する。
- 問題がなければ、再度 Claude Code を呼び出し、Codex (architecture.md 等) を更新させる。
  ```bash
  claude "Based on the changes in .agents/plans/[日付]_[タスク名]/PLAN.md, update the project Codex/Skills to reflect the new implementation details."
  ```

### 5. 完了報告
- 実装されたファイルと、更新された Codex の箇所をユーザーに報告して終了。
