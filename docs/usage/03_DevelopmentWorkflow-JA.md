# 使い方: 段階的コラボレーションワークフロー

Status: Draft  
Last Updated: 2026-03-07

このガイドは、機能開発を共通のフェーズゲートで進めるための実践手順を説明します。
基準仕様は `docs/specs/12_DevelopmentWorkflow.md` です。

## 1. セッションチェックリスト

各タスク開始時に次を確認します。

- スコープと非対象を明確化する
- 影響を受ける spec/ADR を特定する
- 実装前に受け入れ条件を決める
- 先に spec を更新する
- 次に失敗テストを書く
- 最小実装でテストを通す
- 全体検証を実行する（`pnpm test --run`, `pnpm check`）
- ユーザー影響がある場合は EN/JA の usage を更新する
- アーキテクチャ上の判断がある場合は ADR を追加/更新する

## 2. 実務ステップ

1. 意図の整合

- 何を変えるか、何を変えないかを合意する
- 参照する既存 spec/ADR を明記する

2. spec 更新

- 先に規範文（`MUST` / `MUST NOT` / 失敗条件）を書く

3. 失敗テスト（Red）

- 現状実装では満たせないことを示すテストを追加する

4. 実装（Green）

- テストを通すための最小変更を行う

5. リファクタと検証

- テストが緑のまま内部を整理する
- 全体ゲートを実行して回帰を防ぐ

## 3. 完了の定義（PR Ready）

以下をすべて満たしたときのみ PR Ready とします。

- スコープと受け入れ条件が明確
- 実装前に spec が更新済み
- 実装前に失敗テストが追加済み
- 関連テストがすべて成功
- `pnpm check` が成功
- 必要に応じて EN/JA usage が更新済み
- アーキテクチャや長期保守に影響する判断は ADR へ反映済み

## 4. レビュー観点

レビューでは次を優先します。

- 実装スタイルより spec とテストの整合性
- 境界条件での決定性（時間範囲、容量、耐久性）
- エラー型と失敗条件の明示性

## 5. TypeScript コード構成ポリシー

TypeScript 実装では次の実務ポリシーを適用します。

- ドメイン境界の `index.ts` は薄く、副作用のない barrel として維持する
- 複数責務が混在した時点、または 300 行超（空行・コメント除く）で分割する
- 220 行超（空行・コメント除く）の時点で機能追加前の先行分割を推奨する
- barrel は明示 re-export（`export { X } from './x'`）を使い、runtime 値での `export *` は避ける
- ドメイン間 import は公開 barrel 経由、同一ドメイン内は直接 import を基本とする
- validation / normalization は可能な限り pure function として実装する
- 同一領域で機能追加する前に、まず振る舞い不変の分割リファクタを分離する

## 6. GitHub Actions CI/CD

リポジトリの自動化は、次のトリガー分離で運用します。

- プルリクエスト作成/更新時（`opened`, `reopened`, `synchronize`, `ready_for_review`）は次を実行:
  - `pnpm check`
  - `pnpm test --run`
- デフォルトブランチに反映された push（例: マージ完了）では次を実行:
  - `pnpm check`
  - `pnpm test --run`
  - `pnpm build`
  - `pnpm build:bundle`

現時点のポリシーでは外部公開先へのアーティファクト配布は行いません。
ビルド成果物はワークフロー内検証用としてのみ生成します。

## 7. Feature PR チェックリストの強制

機能開発の Pull Request では `.github/pull_request_template.md` を必ず使用します。
テンプレート内のチェックリストは最小実行ゲートであり、マージ前に完了が必要です。

- intent alignment
- spec 先行更新
- 失敗テスト先行（TDD Red）
- Red テスト後に実装（TDD Green）
- 全体検証（`pnpm test --run`, `pnpm check`）
- ユーザー影響がある場合の EN/JA usage 更新
- アーキテクチャ/プロセス判断時の ADR 更新

## 8. docs index 整合ルール

ファイル追加やリネーム時は次を同時更新します。

- spec 変更時: `docs/specs/INDEX.md`
- ADR 変更時: `docs/adr/INDEX.md`

これらの整合チェックはテストで検証され、ガバナンスゲートとして扱います。
