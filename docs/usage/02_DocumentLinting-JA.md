# 使い方: textlint による Markdown チェック

Status: Draft  
Last Updated: 2026-03-06

このガイドは、Frostpillar で Markdown の lint と自動修正を実行する方法を説明します。

## 1. Markdown をチェックする

```bash
pnpm textlint
```

このコマンドはリポジトリ内の `*.md` を走査し、ルール違反を報告します。

## 2. Markdown を自動修正する

```bash
pnpm textlint:fix
```

短い別名コマンドとして、次も使えます。

```bash
pnpm format:md
```

どちらのコマンドも、ルールが安全に自動修正できる項目に `--fix` を適用します。

## 3. 品質ゲート

`pnpm check` には `pnpm textlint` が含まれ、Markdown の品質を検証します。

