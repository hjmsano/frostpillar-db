# 使い方: 配布オプション（NPM とブラウザバンドル）

Status: Draft  
Last Updated: 2026-03-07

このガイドは、Frostpillar の配布方式と選択指針を説明します。

## 1. 配布方式

Frostpillar は次の 2 つの配布トラックを定義します。

1. NPM モジュール
2. ブラウザバンドル

規範ポリシーは `docs/specs/13_DistributionDeliveryTracks.md` を参照してください。

## 2. NPM モジュール配布

パッケージマネージャで依存管理するアプリケーションではこの方式を使います。

### インストール

```bash
npm install frostpillar
```

### 基本利用

```typescript
import { Datastore } from 'frostpillar';

const db = new Datastore({ location: 'memory' });
await db.insert({ timestamp: Date.now(), payload: { temp: 25.3 } });
```

### パッケージ契約の確認ポイント

- `package.json` の top-level `exports["."]` は runtime/type の named export エントリを定義します。
- `npm pack` 生成物には `dist/core` と `dist/queryEngine` の runtime および `.d.ts` ファイルが含まれます。
- クリーン fixture での install/import スモーク経路をテストで検証します。

## 3. ブラウザバンドル配布

スクリプト配信や静的ホスティングなど、ブラウザで直接読み込む場合に使います。

### ビルドコマンド

```bash
pnpm build
pnpm build:bundle
```

### 生成アーティファクト

- `dist/bundles/core/frostpillar-core.js`
- `dist/bundles/core/frostpillar-core.d.ts`
- `dist/bundles/manifest.json`

### プロファイル方針

- 必須: `core`
- 任意: `core-indexeddb`, `core-opfs`, `core-localstorage`, `full-browser`

### 選択ルール

- 必要なバックエンドを含む最小プロファイルを選ぶ
- 読み込んだバンドルに対象バックエンドが含まれない場合、初期化は型付きの unsupported-backend エラー相当で失敗しなければならない

## 4. 現在のスコープ注記（2026-03-07）

- 配布トラック自体は必須プロダクト要件です。
- 実行時バックエンド対応は datastore の runtime-slice spec に従います。
- ブラウザバックエンド対応は段階導入のため、bundle プロファイルでサポートを宣言できるのは runtime-slice で対応済みのもののみです。

## 5. 現在のプロファイル行列（2026-03-07）

プロファイル行列は `dist/bundles/manifest.json` の `profileMatrix` として公開します。

| Profile | 公開状態 | 現在のバックエンド | 補足 |
| :------ | :------- | :----------------- | :--- |
| `core` | `published` | `memory` | 現在のリリース生成物は `dist/bundles/core/frostpillar-core.js` |
| `core-indexeddb` | `planned`（計画中） | なし | runtime-slice で IndexedDB 対応が受理された後に有効化 |
| `core-opfs` | `planned`（計画中） | なし | runtime-slice で OPFS 対応が受理された後に有効化 |
| `core-localstorage` | `planned`（計画中） | なし | runtime-slice で localStorage 対応が受理された後に有効化 |
| `full-browser` | `planned`（計画中） | なし | ブラウザアダプタの runtime 対応拡張後に有効化 |

## 6. 次の方向性（2026-03-07）

次の方向性（v0.1 リリースハードニング後）: ブラウザバックエンド実装を先行。

- runtime-slice のブラウザバックエンド（`indexedDB` / `opfs` / `localStorage`）から段階的に実装する
- オプションプロファイルを `planned` から `published` へ移行するのは、tests/specs が green になった後だけに限定する
- ネイティブ mutation API 拡張は、ブラウザ runtime 基盤の完了後に着手する
