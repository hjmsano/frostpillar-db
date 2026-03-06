# 使い方: 開発テンプレート

Status: Draft  
Last Updated: 2026-03-06

このガイドは、spec-first / TDD-first で進めるための再利用テンプレートを提供します。

## 1. Spec 更新テンプレート

```md
# Specification: <機能名>

Status: Draft
Last Updated: <YYYY-MM-DD>

## 1. 目的

## 2. スコープ

In scope:

- <項目>

Out of scope:

- <項目>

## 3. 規範要件

- The system MUST <振る舞い>.
- The system MUST NOT <禁止する振る舞い>.
- <失敗条件> では `<ErrorType>` を投げること。

## 4. 受け入れ条件

- <観測可能な条件>

## 5. テストへの反映

- <要件> の失敗テストを追加
- <境界> の回帰テストを追加
```

## 2. ADR テンプレート

```md
# ADR-XX: <意思決定タイトル>

Status: Proposed
Date: <YYYY-MM-DD>

## Context

## Decision

## Alternatives Considered

1. <代替案>
2. <代替案>

## Consequences

Positive:

- <効果>

Trade-off:

- <トレードオフ>
```

## 3. 段階別タスク分解テンプレート

```md
# <機能名> 実行計画

## Phase 0: Intent Alignment

Entry:

- <条件>

Tasks:

- [ ] <タスク>

Exit:

- <条件>

## Phase 1: Spec Update

Tasks:

- [ ] <タスク>

## Phase 2: Failing Tests

Tasks:

- [ ] <タスク>

## Phase 3: Implementation

Tasks:

- [ ] <タスク>

## Phase 4: Verification

Tasks:

- [ ] <タスク>

## Risks and Mitigations

- Risk: <リスク>
  Mitigation: <対策>
```

## 4. PR チェックリストテンプレート

```md
- [ ] スコープと非対象が明確
- [ ] 実装前に spec 更新済み
- [ ] 実装前に失敗テスト追加済み
- [ ] 実装は対象テストを通過
- [ ] 全体ゲート通過（`pnpm test --run`, `pnpm check`）
- [ ] ユーザー影響がある場合 EN/JA usage を更新
- [ ] アーキテクチャ影響がある場合 ADR を更新
```
