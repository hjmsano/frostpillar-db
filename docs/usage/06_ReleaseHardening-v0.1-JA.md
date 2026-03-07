# 使い方: リリースハードニング (v0.1)

Status: Draft  
Last Updated: 2026-03-07

このドキュメントは `v0.1` 向けのリリースハードニング確認項目を説明します。  
規範仕様は `docs/specs/14_ReleaseHardening_v0.1.md` を参照してください。

## 1. v0.1 の制約と非対象

`v0.1` は意図的にスコープを絞っています。

- 対応済みバックエンド: `location: "memory"` と `location: "file"`。
- `location: "browser"` のランタイムバックエンド実装は未対応です。
- ブラウザバンドルの任意プロファイル（`core-indexeddb`, `core-opfs`, `core-localstorage`, `full-browser`）は `planned` のままでもよい前提です。
- 公開 mutation API（`getById`, `updateById`, `deleteById`）は対象外です。
- レジストリ公開自動化は対象外です。

v0.1 後の方向性は ADR-51 で定義されており、ブラウザランタイムバックエンド実装を先行します。

## 2. ベンチマーク手法 (v0.1 baseline)

再現コマンド:

```bash
pnpm build
pnpm benchmark:v0.1
```

ベンチマークスクリプト: `scripts/benchmark-v0.1.mjs`

固定データセット形状:

| Dataset | Backend | Records | Payload 形状 |
| :------ | :------ | ------: | :----------- |
| `tiny-memory` | `memory` | 1000 | 狭いオブジェクト（`event`, `value`, `source`） |
| `small-file` | `file` | 2000 | ネストオブジェクト（深さ最大 3） |
| `medium-memory` | `memory` | 10000 | mixed scalar + nested flags |

出力メトリクス:

- `insertDurationMs`
- `selectDurationMs`
- `insertRecordsPerSecond`
- `selectRecordsPerSecond`
- 環境メタデータ（`node`, `platform`, `arch`, `cpuModel`）

解釈ポリシー:

- ローカル実行結果は証跡であり、厳密な性能保証ではありません
- リリース判定では前回ベースラインとの比較を行います
- いずれかのデータセットで throughput が 20% を超えて悪化した場合は、リリースノートに理由と緩和策を必ず記載します

## 3. ベースラインレポート (2026-03-07)

このレポートはローカル開発環境で `pnpm benchmark:v0.1` を実行して取得します。

環境:

- Node.js: `v24.13.0`
- Platform: `darwin`
- Arch: `arm64`

結果:

| Dataset | Insert ms | Select ms | Insert records/s | Select records/s |
| :------ | --------: | --------: | ---------------: | ---------------: |
| `tiny-memory` | `14.236` | `1.136` | `70244.45` | `880281.69` |
| `small-file` | `3535.308` | `0.743` | `565.72` | `2691790.04` |
| `medium-memory` | `71.261` | `3.864` | `140329.21` | `2587991.72` |

## 4. リリース判定コマンド

M5 検証には以下を実行します。

```bash
pnpm test --run
pnpm check
```
