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

## 3. ブラウザバンドル配布

スクリプト配信や静的ホスティングなど、ブラウザで直接読み込む場合に使います。

### ビルドコマンド

```bash
pnpm build
pnpm build:bundle
```

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

## 5. プロファイル表テンプレート

リリースノートでは次のような表を公開してください。

| Profile | 含まれるもの | 対象 |
| :------ | :----------- | :--- |
| `core` | ブラウザ永続化アダプタを除く core API | ブラウザ基盤 |
| `core-indexeddb` | core + IndexedDB アダプタ | IndexedDB 永続化 |
| `core-opfs` | core + OPFS アダプタ | OPFS 永続化 |
| `core-localstorage` | core + localStorage アダプタ | 互換フォールバック |
| `full-browser` | runtime-slice で対応済みの全ブラウザアダプタを含む core | 便利な all-in-one |
