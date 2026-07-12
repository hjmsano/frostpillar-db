# Frostpillar DB

[English/英語](./README.md) | [Japanese/日本語](./README-JA.md)

[![npm version](https://img.shields.io/npm/v/@frostpillar/frostpillar-db)](https://www.npmjs.com/package/@frostpillar/frostpillar-db)
[![Node.js >=24](https://img.shields.io/badge/Node.js-%3E%3D24-green.svg)](https://nodejs.org/)
[![CI](https://github.com/hjmsano/frostpillar-db/actions/workflows/ci.yml/badge.svg)](https://github.com/hjmsano/frostpillar-db/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

軽量・高速で、サードパーティ依存のない TypeScript / Node.js / ブラウザ向けデータベース。

[frostpillar-storage-engine](https://github.com/hjmsano/frostpillar-storage-engine) の上に構築され、フィルタリング、更新演算子、メソッドチェーンによるクエリ API を提供します。SQL パーサーや外部依存は不要です。

```
frostpillar-db          ← データベース管理とクエリ API（このパッケージ）
├── frostpillar-query-interface  ← SQL / Lucene ライクなクエリ API（計画中）
├── frostpillar-storage-engine   ← コアストレージとチャンク管理
│   └── frostpillar-btree        ← B+ ツリーインデックス
frostpillar-http-api    ← RESTful API レイヤー（計画中）
frostpillar-mcp         ← AI エージェント連携用 MCP インターフェース（計画中）
frostpillar-cli         ← コマンドラインインターフェース（計画中）
```

## 特徴

- **マルチランタイム** — Node.js、ブラウザ、ブラウザ拡張機能で動作
- **流暢なクエリ API** — `$` 演算子フィルタと遅延実行（`find`、`sort`、`skip`、`limit`、`project`、`toArray`、`count`）
- **CRUD + 更新演算子** — `insert`、`insertMany`、`find`、`findOne`、`update`、`remove`、`count` と `$set`、`$unset`、`$inc`、`$rename`、`$push`、`$pull`、`$addToSet`
- **Upsert サポート** — `update` に `{ upsert: true }` を指定すると、マッチするドキュメントがない場合に新規挿入
- **組み込み集約** — フィルタ後データセットに対する `sum`、`avg`、`min`、`max`、`percentile`、`median`、`stdDevPop`、`stdDevSamp`、`variancePop`、`varianceSamp`、`distinct`、`countDistinct`、`groupBy`（単一または複数フィールド、グループごとの値を返す `$first`/`$last`/`$countDistinct`/`$push`/`$addToSet` アキュムレータ付き）
- **変更イベント** — `watch()` リスナーで insert、update、remove 操作を監視
- **TTL（Time-To-Live）** — コレクション単位でドキュメントの自動有効期限を設定
- **非同期カーソル** — `for await...of` による結果のイテレーション
- **スキーマレス** — JSON 互換のドキュメントをそのまま格納。事前のスキーマ定義不要
- **プラガブルストレージ** — インメモリ、ファイル、localStorage、IndexedDB、OPFS、ブラウザ拡張同期ストレージ（frostpillar-storage-engine 経由）
- **サードパーティ依存ゼロ** — Frostpillar ファミリーのパッケージのみ
- **Tree-shakable** — `sideEffects: false` の ESM

## クイックスタート

### Node.js / TypeScript

**1. インストール**

```bash
npm install @frostpillar/frostpillar-db
```

**2. `example.mjs` を作成**

```js
import { Database } from '@frostpillar/frostpillar-db';

const db = new Database({});
const users = db.collection('users');

// 挿入
await users.insert({ name: 'Alice', age: 30, dept: 'engineering' });
await users.insert({ name: 'Bob', age: 25, dept: 'design' });
await users.insert({ name: 'Carol', age: 35, dept: 'engineering' });

// フィルタ、ソート、ページネーション付き検索
const results = await users
  .find({ age: { $gte: 25 } })
  .sort({ age: -1, name: 1 })
  .limit(10)
  .toArray();

console.log(results);
// [{ name: 'Carol', age: 35, ... }, { name: 'Alice', age: 30, ... }, ...]

// 更新
await users.update({ name: 'Alice' }, { $set: { age: 31 } });

// 削除
await users.remove({ dept: 'design' });

await db.close();
```

**3. 実行**

```bash
node example.mjs
```

### ブラウザ

[GitHub Releases](https://github.com/hjmsano/frostpillar-db/releases) から IIFE バンドルをダウンロードし、`<script>` タグで読み込みます。

| バンドル                     | グローバル変数      | 内容                                                    |
| ---------------------------- | ------------------- | ------------------------------------------------------- |
| `frostpillar-db.min.js`      | `FrostpillarDB`     | フルパッケージ（全ドライバー含む）                      |
| `frostpillar-db-core.min.js` | `FrostpillarDBCore` | コア + `localStorageDriver` + `indexedDBDriver`（軽量） |

すべてのエクスポートは対応するグローバルオブジェクト（`window.FrostpillarDB` または `window.FrostpillarDBCore`）で利用できます。

```html
<script src="frostpillar-db.min.js"></script>
<script>
  const { Database } = window.FrostpillarDB;

  async function main() {
    const db = new Database({});
    const tasks = db.collection('tasks');

    // 挿入
    await tasks.insert({ title: '牛乳を買う', done: false, priority: 1 });
    await tasks.insert({ title: 'コードを書く', done: false, priority: 3 });
    await tasks.insert({ title: 'ランニングする', done: true, priority: 2 });

    // 未完了タスクの検索
    const pending = await tasks
      .find({ done: false })
      .sort({ priority: -1 })
      .toArray();
    console.log(pending);

    await db.close();
  }

  main().catch(console.error);
</script>
```

> **注意:** トップレベルの `async`/`await` は `<script type="module">` 内でのみ動作します。IIFE バンドルを通常の `<script>` タグで読み込む場合は、上記のように `async` 関数でコードをラップしてください。

---

## Frostpillar の用途

**適している:** 組み込みアプリ、プロトタイピング、ブラウザローカルデータ、ブラウザ拡張機能、小〜中規模データセット、CLI ツール、Electron/Tauri アプリ。

**適さない:** 数 GB 規模のデータセット、高頻度書き込みサーバー、複雑な結合を伴うリレーショナルデータ。

## 目次

- [クイックスタート](#クイックスタート)
- [動作環境](#動作環境)
- [エントリーポイント](#エントリーポイント)
- [ユーザーマニュアル](#ユーザーマニュアル)
  - [Database](#database)
    - [エラー監視](#エラー監視)
  - [コレクション](#コレクション)
    - [コレクション単位のオプション](#コレクション単位のオプション)
    - [コレクションの内部情報](#コレクションの内部情報)
  - [CRUD 操作](#crud-操作)
  - [ID クエリ](#id-クエリ)
  - [クエリフィルタ](#クエリフィルタ)
  - [パフォーマンスノート](#パフォーマンスノート)
  - [ResultChain（ソート、ページネーション、プロジェクション）](#resultchain)
  - [集約](#集約)
  - [グルーピング](#グルーピング)
  - [更新演算子](#更新演算子)
  - [変更イベント](#変更イベント)
  - [TTL（Time-To-Live）](#ttl-time-to-live)
  - [非同期カーソル](#非同期カーソル)
  - [永続ストレージ](#永続ストレージ)
  - [ペイロード制限](#ペイロード制限)
  - [運用上の制限](#運用上の制限)
    - [予約キー](#予約キー)
  - [インデックス設定](#インデックス設定)
  - [エラーハンドリング](#エラーハンドリング)
- [API リファレンス](#api-リファレンス)
- [コントリビュート](#コントリビュート)
- [ライセンス](#ライセンス)

---

## 動作環境

| 環境       | 要件                                                         |
| ---------- | ------------------------------------------------------------ |
| Node.js    | >= 24.0.0（ESM / CJS）                                       |
| ブラウザ   | ES2020 対応（Chrome 80+、Firefox 74+、Safari 14+、Edge 80+） |
| TypeScript | >= 5.0                                                       |

> **Pre-1.0 について:** メジャーバージョンが `0` の間は、マイナーバージョンのアップデートで破壊的変更が含まれる場合があります。依存バージョンを固定し、アップグレード前に [GitHub Releases](https://github.com/hjmsano/frostpillar-db/releases) ページを確認してください。

---

## エントリーポイント

### ESM / CJS サブパスエクスポート

| インポートパス                        | エクスポート内容                                                 |
| ------------------------------------- | ---------------------------------------------------------------- |
| `frostpillar-db`                      | Database、Collection、エラー、型 — ドライバーは含まない          |
| `frostpillar-db/core`                 | `frostpillar-db` と同一 — 互換性のために維持されているエイリアス |
| `frostpillar-db/drivers/file`         | `fileDriver`（Node.js ファイルストレージ）                       |
| `frostpillar-db/drivers/localStorage` | `localStorageDriver`（ブラウザ localStorage）                    |
| `frostpillar-db/drivers/indexedDB`    | `indexedDBDriver`（ブラウザ IndexedDB）                          |
| `frostpillar-db/drivers/opfs`         | `opfsDriver`（Origin Private File System）                       |
| `frostpillar-db/drivers/syncStorage`  | `syncStorageDriver`（ブラウザ拡張機能 sync）                     |

`frostpillar-db` と `frostpillar-db/core` はどちらもドライバーを含まず、エクスポート内容は同一です。ドライバーは常に上記の `frostpillar-db/drivers/*` サブパスから個別にインポートしてください。`frostpillar-db/core` は互換性のために維持されているエイリアスです。

### ブラウザ IIFE バンドル

| バンドル                     | グローバル変数      | 内容                                                          |
| ---------------------------- | ------------------- | ------------------------------------------------------------- |
| `frostpillar-db.min.js`      | `FrostpillarDB`     | フルパッケージ（全ドライバー含む）                            |
| `frostpillar-db-core.min.js` | `FrostpillarDBCore` | コア + `localStorageDriver` + `indexedDBDriver`（軽量ビルド） |

両バンドルは [GitHub Releases](https://github.com/hjmsano/frostpillar-db/releases) から入手できます。

---

## ユーザーマニュアル

### Database

`Database` はトップレベルのエントリーポイントです。コレクションごとに専用の `Datastore` インスタンスを管理し、コレクションへのアクセスを提供します。

**Node.js / TypeScript:**

```ts
import { Database } from '@frostpillar/frostpillar-db';

const db = new Database({});
```

**ブラウザ:**

```js
const { Database } = window.FrostpillarDB;

const db = new Database({});
```

**ライフサイクル:**

```js
// データベースを使用...
await db.commit(); // 永続ストレージへの明示的なフラッシュ
await db.close(); // リソースとロックの解放
```

> **逐次処理:** `commit()` および `close()` はコレクションを逐次的に処理します。個々のコレクションの操作でエラーが発生した場合、そのエラーが即座に伝播し、残りのコレクションはスキップされます。ベストエフォートのセマンティクスが必要な場合は、コレクション単位で try/catch を使用してください。

#### エラー監視

auto-commit などのバックグラウンド処理で発生する非同期エラーは、ユーザー呼び出しからはスローされません。`db.on('error', ...)` で購読してください:

```ts
const unsubscribe = db.on('error', (event) => {
  console.error(event.source, event.error, event.occurredAt);
});

// 購読解除
unsubscribe();
```

リスナーは現在および今後作成されるすべてのコレクション単位の datastore に登録されます。返却される関数は、登録されたすべての datastore からリスナーを解除します。

> **リスナー上限:** `maxErrorListeners`（デフォルト `32`）はエラーリスナー数の閾値を設定します。登録数が閾値を超えると `console.warn` が出力されます。リスナーが解除されて閾値以下に戻ると警告がリセットされ、再び超過した際に再度発火します。`maxErrorListeners: 'unlimited'` を指定すると警告を無効化できます。
>
> ```ts
> const db = new Database({ maxErrorListeners: 64 });
> ```

### コレクション

コレクションは名前でアクセスするドキュメントの論理的なグループです:

```ts
const users = db.collection('users');
const posts = db.collection('posts');
```

コレクションは遅延作成されます。事前の登録は不要です。

```ts
// 登録済みの全コレクション一覧（空のコレクションを含む）
const names = await db.listCollections();

// コレクションの削除（全ドキュメントを削除）
await db.dropCollection('posts');
```

> **注意:** `dropCollection()` の後、その名前で以前に取得した `Collection` 参照は無効になります。無効な参照での操作は `ClosedDatabaseError` をスローします。必要に応じて `db.collection(name)` で再取得してください。

> **注意:** `listCollections()` は現在のセッションで `db.collection()` を通じてアクセスされたコレクションのみを返します。前のセッションで永続化されたコレクションでも、まだアクセスされていない場合は結果に表示されません。コレクションを結果に含めるには、先に `db.collection(name)` を呼び出してセッションに登録してください。

> **パフォーマンス:** `listCollections()` はストレージエンジンに問い合わせず、追跡中のコレクション名を直接返します。登録済みコレクション数に対して O(n) です。

#### 重複キーポリシー

各コレクションには、同じ `_id` を持つドキュメントの `insert()` 時の挙動を制御する重複キーポリシーを設定できます。これはストレージエンジンのキーハンドリングモデルと対応しています。

```ts
const users = db.collection('users'); // デフォルト: 'reject'
const settings = db.collection('settings', { duplicateKeys: 'replace' });
const logs = db.collection('logs', { duplicateKeys: 'allow' });
```

| ポリシー    | 動作                                      | ユースケース                                             |
| ----------- | ----------------------------------------- | -------------------------------------------------------- |
| `'reject'`  | 重複 `_id` で `DuplicateIdError` をスロー | ユーザーアカウント、ユニークなエンティティ（デフォルト） |
| `'replace'` | 既存ドキュメントをサイレントに上書き      | 設定、キャッシュ                                         |
| `'allow'`   | 同じ `_id` の複数ドキュメントが共存可能   | ログ、イベント、時系列データ                             |

```ts
// 'reject'（デフォルト）— _id のユニーク制約
const users = db.collection('users');
await users.insert({ _id: 'u1', name: 'Alice' });
await users.insert({ _id: 'u1', name: 'Bob' }); // DuplicateIdError をスロー

// 'replace' — 後勝ち上書き
const settings = db.collection('settings', { duplicateKeys: 'replace' });
await settings.insert({ _id: 'theme', value: 'dark' });
await settings.insert({ _id: 'theme', value: 'light' }); // 上書き

// 'allow' — 追記のみ
const logs = db.collection('logs', { duplicateKeys: 'allow' });
await logs.insert({ _id: 'session-1', event: 'login' });
await logs.insert({ _id: 'session-1', event: 'logout' }); // 両方保存
```

> **パフォーマンス注記:** `'reject'` ポリシーでは、ストレージエンジン内部の Bloom フィルタにより重複検出が高速化されます。多くの否定判定は B+ ツリーにアクセスせずに完了します。この挙動は透過的で、設定は不要です。

**異なるオプションでコレクションに再アクセスすると** `ConfigurationError` がスローされます。厳密一致はベアな再アクセスにも適用されます: `db.collection(name)` (オプション無し) はデフォルト値に解決されるため、保存済みオプションがデフォルトと等しい場合にのみ成功します。非デフォルトのオプションでコレクションを構成した場合、以降の `collection()` 呼び出しでも同じオプションを渡すか、最初の呼び出しで得た `Collection` 参照をキャッシュしてください。詳細は [ADR-014](docs/adr/014-strict-collection-option-reaccess.md) を参照してください。

**TypeScript ジェネリクス** で型ヒントを提供できます（ランタイム検証なし）:

```ts
interface User {
  _id: string;
  name: string;
  age: number;
}

const users = db.collection<User>('users');
```

#### コレクション単位のオプション

`duplicateKeys`、`ttl`、`immutableCreatedAt` に加え、`db.collection(name, { ... })` にオプションを渡すことで、データベース全体の設定をコレクション単位でオーバーライドしたり、コレクション固有の設定を指定できます:

```ts
import type {
  AutoCommitConfig,
  CapacityConfig,
  DatastoreKeyDefinition,
  IndexConfig,
} from '@frostpillar/frostpillar-db';

// 容量制限 — 10 MB 上限、FIFO 退避
const logs = db.collection('logs', {
  capacity: { maxSize: '10MB', policy: 'turnover' },
});

// Auto-commit — このコレクションを 5 秒ごとにフラッシュ
const events = db.collection('events', {
  autoCommit: { frequency: '5s', maxPendingBytes: 1024 * 1024 },
});

// インデックス — 自動スケーリングを無効化し固定ノードサイズを使用
const archive = db.collection('archive', {
  index: { autoScale: false, maxLeafEntries: 256, maxBranchChildren: 64 },
});

// カスタムキー型 — 自然順序の数値キー
const numericKey: DatastoreKeyDefinition<number> = {
  normalize: (v) => Number(v),
  compare: (a, b) => a - b,
  serialize: (k) => String(k),
  deserialize: (s) => Number(s),
};
const items = db.collection('items', { key: numericKey });
```

キー定義が制御するのはストレージ上の配置と順序だけです。`_id` はドキュメントに格納された文字列のままであり、クエリは文字列としての完全一致で判定します。`normalize` は、格納する `_id` 文字列に対して単射になるように定義してください。`normalize: Number` の場合、`"01"` と `"1"` は同一のストレージキーに写るため、両者は共存できません。

コレクション単位のオプションはデータベース全体の設定よりも優先されます。同じコレクションを異なる値で再アクセスすると `ConfigurationError` がスローされます。詳細は [Spec 01](docs/specs/01-database-and-collection.md) §2.8–§2.11 を参照してください。

#### コレクションの内部情報

各 `Collection` インスタンスは、解決済みの設定を読み取り専用フィールドとして公開します。ロギング、メトリクス、条件分岐などで利用できます:

```ts
const users = db.collection('users', { ttl: 3600 });

users.name; // 'users'
users.duplicateKeys; // 'reject'（デフォルト）
users.ttl; // 3600（TTL が未設定の場合は undefined）
```

これらのフィールドは、データベース全体のデフォルトとコレクション単位のオーバーライドをマージした後の解決済みオプションを反映します。

### CRUD 操作

#### 挿入

```ts
// 単一ドキュメント — 生成された _id を返す
const id = await users.insert({ name: 'Alice', age: 30 });

// カスタム _id を指定
await users.insert({ _id: 'user-001', name: 'Bob', age: 25 });

// 複数ドキュメント
const ids = await users.insertMany([
  { name: 'Carol', age: 35 },
  { name: 'Dave', age: 28 },
]);
```

> **注意:** カスタム `_id` は制御文字を含まない 1,024 文字以下の空でない文字列でなければなりません。違反した場合、`insert` は `ValidationError` をスローします。同じ制約はフィルタで使用する `_id` 値にも適用されます。

> **注意:** `insertMany` はトランザクションをサポートしていません。バッチ処理中にエラーが発生した場合（例: `'reject'` コレクションでの `_id` 重複）、エラー発生前に挿入済みのドキュメントはロールバックされません。呼び出し元にはスローされたエラーが返され、部分的な結果は返されません。

#### 検索

```ts
// 全ドキュメント
const all = await users.find().toArray();

// フィルタ付き
const seniors = await users.find({ age: { $gte: 30 } }).toArray();

// 単一ドキュメント
const alice = await users.findOne({ name: 'Alice' });
```

#### 更新

```ts
// マッチしたドキュメントを更新 — UpdateResult を返す
const { modifiedCount } = await users.update(
  { dept: 'engineering' },
  { $set: { active: true }, $inc: { loginCount: 1 } },
);

// Upsert — フィルタにマッチするドキュメントがなければ挿入
const { modifiedCount: m, upsertedId } = await users.update(
  { name: 'Eve' },
  { $set: { age: 22, dept: 'marketing' } },
  { upsert: true },
);
// 'Eve' が存在する場合: modifiedCount >= 1, upsertedId === null
// 'Eve' が存在しない場合: modifiedCount === 0, upsertedId === '<new _id>'
```

`UpdateResult` の型:

```ts
interface UpdateResult {
  modifiedCount: number; // 実際に変更されたドキュメント数
  upsertedId: string | null; // upsert されたドキュメントの _id、または null
}
```

> **注意:** `update` はトランザクションをサポートしていません。更新演算子がエラーをスローした場合（例: 非数値フィールドへの `$inc`）、同一呼び出し内で既に変更されたドキュメントはロールバックされません。

#### 削除

```ts
// マッチしたドキュメントを削除 — 削除数を返す
const count = await users.remove({ age: { $lt: 18 } });
```

> **注意:** `filter` 引数は必須です。省略するか `null` を渡すと `ValidationError` がスローされます。全ドキュメントを削除するには、空オブジェクトを渡します: `users.remove({})`。

#### カウント

```ts
const total = await users.count();
const active = await users.count({ status: 'active' });
```

> **注意:** `duplicateKeys: 'allow'` のコレクションでは、`count()` は重複キーを含む**総レコード数**を返します。ユニークな `_id` の数ではありません。

#### 書き込み時のドキュメント所有権

`insert()` / `insertMany()` に渡したドキュメント、および `$set` / `$push` / `$addToSet` で書き込む値は、ストレージへ**ディープコピー**されます。書き込み完了後に元のオブジェクトを変更しても、保存済みレコードは変化しません:

```ts
const input = { name: 'Alice', tags: ['a'] };
const id = await users.insert(input);

input.tags.push('b'); // 保存済みドキュメントには影響しない
const stored = await users.findOne({ _id: id }); // tags: ['a']
```

逆方向は保証されません。`find()` / `findOne()` および `watch()` イベントが**返す**ドキュメントはコピーではなく保存済みレコードへの参照です。読み取り専用のスナップショットとして扱い、変更する場合はコピーしてください。

### ID クエリ

ドキュメントの存在確認や ID 一覧取得だけが目的の場合、`find()` / `findOne()` よりも軽量な `exists()` / `ids()` を使用できます:

```ts
// 高速な存在確認 — ペイロードはロードしない
if (await users.exists('user-001')) {
  // ...
}

// コレクション内のすべての _id を取得
const allIds = await users.ids();
```

- `exists(id)` はファストパスとして `Datastore.has(key)` を使用し、TTL コレクションでは有効期限切れのドキュメントに対して `false` を返します。
- `ids()` はファストパスとして `Datastore.keys()` を使用します。TTL コレクションでは有効期限切れのドキュメントを除外し、`find()` や `count()` と整合する結果を返します。TTL、カスタム `key` 定義、`duplicateKeys: 'allow'` のいずれかを持つコレクションではファストパスを使いません。`keys()` はストレージキーを 1 回ずつしか返さないのに対し、`ids()` はドキュメント 1 件につき 1 エントリを返すため、複数のドキュメントが同じ `_id` を共有していても `ids().length === count()` が成り立ちます。

### クエリフィルタ

フィルタは `$` プレフィックスの演算子を使用します:

#### 比較

<!-- prettier-ignore -->
```ts
{ age: 30 } // 暗黙の $eq
{ age: { $eq: 30 } } // 明示的な $eq
{ age: { $ne: 30 } } // 等しくない
{ age: { $gt: 25 } } // より大きい
{ age: { $gte: 25 } } // 以上
{ age: { $lt: 50 } } // より小さい
{ age: { $lte: 50 } } // 以下
```

> **型が異なる比較はマッチしません。** 型の変換は行われません。フィールドの型とオペランドの型が異なる場合（例: 数値の `age` フィールドに対して `{ age: { $gt: '30' } }` を使用）、述語は `false` と評価され、ドキュメントは結果から除外されます。これは MongoDB のセマンティクスに準拠した仕様です。

#### 包含

<!-- prettier-ignore -->
```ts
{ status: { $in: ['active', 'pending'] } }
{ role: { $nin: ['guest'] } }
```

> **深い等値比較の注意:** `$in`、`$nin`、`$eq`、`$ne`、`$all`、`$pull`、`$addToSet` は内部の深い等値比較実装を使用します。サポートされる型はプリミティブ、`Date`、プレーン配列、プレーンオブジェクトです。`Map`、`Set`、`RegExp`、型付き配列（`Uint8Array` など）はフィルタや演算子のオペランドとして使用できません。

#### 論理

<!-- prettier-ignore -->
```ts
{ $and: [{ age: { $gte: 18 } }, { age: { $lt: 65 } }] }
{ $or: [{ status: 'active' }, { role: 'admin' }] }
{ age: { $not: { $lt: 18 } } }
```

トップレベルの複数キーは暗黙の `$and`:

<!-- prettier-ignore -->
```ts
{ age: { $gt: 20 }, status: 'active' }
```

#### 文字列

<!-- prettier-ignore -->
```ts
{ name: { $regex: /^Ali/i } }
```

> `$regex` は `RegExp` オブジェクトまたは文字列パターンを受け付けます。`RegExp` オペランドの場合、ステートレスな評価を保証するため `g`（グローバル）および `y`（スティッキー）フラグは自動的に除去されます。それ以外のフラグ（例: `i`、`m`、`s`）は保持されます。

#### 存在チェック

<!-- prettier-ignore -->
```ts
{ email: { $exists: true } }
{ deletedAt: { $exists: false } }
```

#### 配列

<!-- prettier-ignore -->
```ts
{ tags: { $elemMatch: { $gt: 5 } } } // 少なくとも1つの要素がマッチ
{ tags: { $all: ['a', 'b'] } } // 配列が指定の全値を含む
{ tags: { $size: 3 } } // 配列の要素数が正確に3
```

#### ネストされたフィールド（ドット記法）

<!-- prettier-ignore -->
```ts
{ 'address.city': 'Tokyo' }
{ 'metadata.tags.primary': { $eq: 'featured' } }
```

### パフォーマンスノート

- **`_id` 完全一致のファストパス** — `findOne({ _id })` および内部の `_id` 検索は `Datastore.getFirst(key)` を直接呼び出し、フルスキャンパイプラインをスキップします。
- **`_id` 範囲スキャン** — フィルタが `_id` フィールドに対して `$gt`/`$gte` と `$lt`/`$lte` を両方（同じ型で）指定している場合、クエリエンジンは `Datastore.getRange(start, end)` に委譲し、B+Tree リーフレベルの範囲スキャンを実行します。`_id` 以外の条件は絞り込まれた範囲に対してインメモリで評価されます。型が異なる境界値（例：`string` の下限 + `number` の上限）は `ValidationError` をスローします。
- **`_id` の `$in` ファストパス** — `find({ _id: { $in: [...] } })`、`update`、および `remove` で `_id` に `$in` フィルタを使用すると、`Datastore.getMany(keys)` によるバッチ検索が行われ、フルスキャンが回避されます。`remove` の削除パスでも `Datastore.deleteMany(keys)` により同様の最適化が適用されます。
- **`exists()` / `ids()` のファストパス** — TTL が設定されていないコレクションではペイロードのロードをスキップします（[ID クエリ](#id-クエリ)を参照）。

### ResultChain

`find()` は合成可能なクエリのための `ResultChain` を返します:

```ts
const results = await users
  .find({ status: 'active' })
  .sort({ age: -1, name: 1 }) // age 降順、name 昇順でソート
  .skip(20) // 最初の 20 件をスキップ
  .limit(10) // 10 件を取得
  .project({ name: 1, age: 1 }) // name と age のみ含める（_id は常に含まれる）
  .toArray();
```

`.sort()` は `SortSpec` オブジェクトまたは `[field, direction]` タプルの配列（`SortSpecEntries`）を受け取ります。フィールド名が `'1'` や `'2'` のような非負整数文字列の場合は配列形式を使用してください。JavaScript はオブジェクトリテラルの整数ライクなキーを数値昇順に並び替えるため、オブジェクト形式ではキーの順序が保証されません:

```ts
// オブジェクト形式 — JavaScript が整数ライクなキーを並び替え、'1' が主キーになる
.sort({ '2': 1, '1': 1 })

// 配列形式 — 順序が保持され、'2' が主ソートキーになる
.sort([['2', 1], ['1', 1]])
```

**チェーンは再利用可能:**

```ts
const activeUsers = users.find({ status: 'active' }).sort({ name: 1 });

const page1 = await activeUsers.skip(0).limit(10).toArray();
const page2 = await activeUsers.skip(10).limit(10).toArray();
const total = await activeUsers.count();
```

### 集約

集約メソッドは `ResultChain` のターミナルメソッドです:

```ts
const sum = await users.find({ dept: 'eng' }).sum('salary');
const avg = await users.find({ dept: 'eng' }).avg('salary');
const min = await users.find({ dept: 'eng' }).min('salary');
const max = await users.find({ dept: 'eng' }).max('salary');
```

`sum`、`avg`、`min`、`max` はフィルタ後の全データに対して実行され、順序に依存しません（skip/limit/projection は適用されません）。`count()` は例外で、skip と limit を適用し、`.toArray()` が返すのと同じ件数を返します。`count()` については [ResultChain](#resultchain) を参照してください。

**集計の入力順序（ADR-020）:** 集計の入力順序は、ストレージ順、またはチェーン上で集計端末メソッドより前に `.sort()` が呼ばれていればその `.sort()` 順になります。`sum`/`avg`/`min`/`max`/`percentile`/`median`/`stdDevPop`/`stdDevSamp`/`variancePop`/`varianceSamp`/`countDistinct` は数学的に順序に依存しないため、`.sort()` の有無にかかわらず同じ結果を返します。`distinct()` と `groupBy()` は順序に影響を受けます: `distinct()` の初出順序と `groupBy()` のグループ順序（および各グループ内のドキュメント順序）は、`.sort()` が指定されていればその順序に従います。`skip`/`limit`/`projection` は引き続き集計の入力には適用されません。

> **移行時の注意:** 集計はチェーン上で先行する `.sort()` を尊重するようになりました。同じチェーンで `.sort()` を呼びながら `distinct`/`groupBy` の結果がストレージ順であることに依存していた場合は、`.sort()` を削除するとストレージ順が維持されます。

非数値は無視されます。`avg`/`min`/`max` は数値がない場合 `null` を返します。`sum` は `0` を返します。

#### パーセンタイルと中央値

```ts
const p95 = await requests
  .find({ route: '/api' })
  .percentile('latencyMs', 0.95);
const medianLatency = await requests
  .find({ route: '/api' })
  .median('latencyMs');
```

`p` は `[0, 1]` の範囲の割合です（`0.95` が 95 パーセンタイル）。0–100 のパーセントスケールではありません。パーセンタイルは最も近いランク間の線形補間（`PERCENTILE_CONT` — SQL、numpy、pandas と同じ定義）で計算されます: `percentile(f, 0)` は `min(f)` と等しく、`percentile(f, 1)` は `max(f)` と等しく、要素数が偶数の場合の中央値は中央 2 値の平均です。

`percentile(field, p)` はスカラー値 `p` を 1 つ受け取り、常に 1 つの `number | null` を返します。複数のパーセンタイルが必要な場合は、個別に呼び出してください。`median(field)` は `percentile(field, 0.5)` と完全に同じです。いずれも非数値は無視され、数値が存在しない場合は `null` を返します。

#### 標準偏差と分散

```ts
const jitterPop = await requests.find({ route: '/api' }).stdDevPop('latencyMs');
const jitterSamp = await requests
  .find({ route: '/api' })
  .stdDevSamp('latencyMs');
const varPop = await requests.find({ route: '/api' }).variancePop('latencyMs');
const varSamp = await requests
  .find({ route: '/api' })
  .varianceSamp('latencyMs');
```

`stdDevPop`/`variancePop` は `n` で除算します（対象データが母集団そのものである場合に使用）。`stdDevSamp`/`varianceSamp` は `n - 1` で除算します（ベッセルの補正 — 標本から母集団の分散を推定する不偏推定量）。いずれもウェルフォードのアルゴリズムで1回のスキャンで計算され、素朴な `Σx² − (Σx)²/n` の公式と異なり、大きな値で分散が小さいデータでも数値的に安定しています。

4つとも非数値は無視され、数値が存在しない場合は `null` を返します。**`n = 1` の場合の注意点:** 数値が1件のみの場合、`stdDevPop`/`variancePop` は `0`（単一の点自身からの分散はゼロ）を返しますが、`stdDevSamp`/`varianceSamp` は `null`（`n - 1 = 0` の除算は未定義）を返します。

#### Distinct

```ts
const departments = await users.find().distinct('dept');
// ['design', 'engineering', 'marketing']
```

返される値は、集計の入力順序（ADR-020）における初出順に従います: ストレージ順、またはチェーン上で `distinct()` より前に `.sort()` が指定されていればその順序になります。

オブジェクト/配列の値は防御的にディープコピーされます（[ADR-026](docs/adr/026-aggregation-result-isolation.md)）。したがって返された値を変更しても保存済みデータには影響しません。`groupBy()` の `_key` も同様です。

#### Count Distinct

```ts
const uniqueCities = await users
  .find({ status: 'active' })
  .countDistinct('address.city');
// 2
```

`.countDistinct(field)`（[ADR-022](docs/adr/022-count-distinct.md)）は、`field` の一意な値の数を返します — `distinct(field)` が返す配列の要素数と完全に一致し、その配列自体は生成しません: `countDistinct(f) === (await distinct(f)).length` が常に成り立ちます。意味論は `.distinct()` と同一です（欠落/`undefined` は無視、`null` は値としてカウント、オブジェクト/配列は深い等価性で重複排除、プリミティブは厳密等価性で重複排除、`MAX_DISTINCT_COUNT` で上限）。ただし空の場合、`.distinct()` の `[]` とは異なり、`.countDistinct()` は**`0`**を返します（`count()`/`sum()` と同様、件数だからです）。順序に依存しません — 一意な値の個数は入力順序に依存しないため、先行する `.sort()` の影響を受けません。

### グルーピング

`groupBy` はフィルタ後のドキュメントをフィールドでグループ化し、グループごとにアキュムレータを計算します。単一のフィールドパスを渡すと1次元でグループ化し、フィールドパスの配列を渡すと複数次元の複合キーでグループ化します。グループの順序（各キーの初出順）と各グループ内のドキュメント順序は、集計の入力順序（ADR-020）に従います: ストレージ順、またはチェーン上で `groupBy()` より前に `.sort()` が指定されていればその順序になります。

```ts
const result = await users.find().groupBy('dept', {
  total: { $count: true },
  avgAge: { $avg: 'age' },
  maxSalary: { $max: 'salary' },
});
// [
//   { _key: 'engineering', total: 5, avgAge: 32, maxSalary: 120000 },
//   { _key: 'design',      total: 3, avgAge: 28, maxSalary: 95000 },
// ]
```

**複数次元のグルーピング** — フィールドパスの配列を渡すと、複合キーでグループ化できます。`_key` はリクエストされたパスごとに1つのプロパティを持つオブジェクトとなり、そのプロパティキーはリテラルのパス文字列です:

```ts
const result = await users.find().groupBy(['dept', 'address.city'], {
  count: { $count: true },
});
// [
//   { _key: { dept: 'engineering', 'address.city': 'Tokyo' }, count: 7 },
//   { _key: { dept: 'engineering', 'address.city': 'Osaka' }, count: 5 },
//   { _key: { dept: 'design',      'address.city': 'Tokyo' }, count: 3 },
// ]
```

リクエストされたフィールドのいずれかが欠けているドキュメントは、その次元について `null` を返します。単一要素の配列（例: `['dept']`）でもオブジェクトの `_key` を生成します。単一フィールド形式で使われるスカラー形式には変換されません。

利用可能なアキュムレータ: `$count`、`$sum`、`$avg`、`$min`、`$max`、`$median`、`$percentile`、`$stdDevPop`、`$stdDevSamp`、`$variancePop`、`$varianceSamp`、`$first`、`$last`、`$countDistinct`、`$push`、`$addToSet`。

`$median: 'fieldPath'` と `$percentile: { field: 'fieldPath', p: 0.95 }` は `.median()` / `.percentile()` と同じ挙動です（同じ補間、数値がない場合は同じく `null`）。`p` は `groupBy` 内では**スカラーのみ**です — 複数のパーセンタイルが必要な場合は、複数の出力フィールドとして指定します:

```ts
const result = await requests.find({}).groupBy('route', {
  p50: { $percentile: { field: 'latencyMs', p: 0.5 } },
  p95: { $percentile: { field: 'latencyMs', p: 0.95 } },
  p99: { $percentile: { field: 'latencyMs', p: 0.99 } },
});
```

`$stdDevPop: 'fieldPath'` / `$stdDevSamp: 'fieldPath'` / `$variancePop: 'fieldPath'` / `$varianceSamp: 'fieldPath'` はグループごとに `.stdDevPop()` / `.stdDevSamp()` / `.variancePop()` / `.varianceSamp()` と同じ挙動です（`n = 1` の場合の注意点も同様: 母集団は `0`、標本は `null`）:

```ts
const result = await requests.find({}).groupBy('route', {
  jitterPop: { $stdDevPop: 'latencyMs' },
  jitterSamp: { $stdDevSamp: 'latencyMs' },
});
```

`$first: 'fieldPath'` / `$last: 'fieldPath'`（[ADR-021](docs/adr/021-first-last-accumulators.md)）は、集計の入力順序（ADR-020）——チェーン上で `.sort()` が指定されていればその順序、なければストレージ順——において、グループの先頭（または末尾）のドキュメントにおける `fieldPath` の値を返します。これは**「位置を選んでから読む」**方式です: 先頭/末尾のドキュメントを先に選択し、そのドキュメントからフィールドを読み取ります——「フィールドを持つ最初/最後のドキュメント」ではありません。選択されたドキュメントがそのフィールドを持たない場合、結果は `null` になります。他のアキュムレータと異なり、`$first`/`$last` は**任意の型**（文字列、数値、真偽値、`null`、オブジェクト、配列）の値を返します。オブジェクト/配列の値は返却前に防御的にクローンされます。典型的な用途は「グループごとの最新値」です:

```ts
const result = await events
  .find({})
  .sort({ updatedAt: -1 })
  .groupBy('userId', {
    latestStatus: { $first: 'status' },
  });
// [{ _key: 'u1', latestStatus: 'shipped' }, ...]
```

`$countDistinct: 'fieldPath'`（[ADR-022](docs/adr/022-count-distinct.md)）は `.countDistinct()` のグループごとの対応版です: グループ内における `fieldPath` の一意な値の数を、同一の等価性判定と `MAX_DISTINCT_COUNT` の上限規則に従ってカウントします — 上限は**グループごと**に適用されます。値が存在しないグループでは `null` ではなく `0` を返します:

```ts
const result = await users.find().groupBy('dept', {
  uniqueCities: { $countDistinct: 'address.city' },
});
// [{ _key: 'engineering', uniqueCities: 2 }, { _key: 'design', uniqueCities: 1 }]
```

`$push: 'fieldPath'` / `$addToSet: 'fieldPath'`（[ADR-023](docs/adr/023-push-addtoset-accumulators.md)）は最後の一対のアキュムレータ——配列を返す**コレクタ**です。両者とも `$first`/`$last`（ADR-020）と同じ集計の入力順序でグループのドキュメントを走査し、オブジェクト/配列の値を防御的にクローンして返すため、返却された値を変更してもストレージ内のデータには影響しません:

- `$push: 'fieldPath'` はグループ内の**すべての**ドキュメントについて `fieldPath` の値を順序どおりに収集します（重複も保持）。欠落/`undefined` の値はスキップされ、`null` は含まれます。
- `$addToSet: 'fieldPath'` は `fieldPath` の**一意な**値を初出順で収集します。等価性判定は `.distinct()`/`$countDistinct` と完全に同一です(オブジェクト/配列は深い等価性、プリミティブは厳密等価性、`null` は有効なメンバー)。

どちらも、値が存在しないグループに対しては `[]` を返します。

```ts
const result = await posts.find().groupBy('author', {
  allTags: { $push: 'tag' }, // すべてのタグを順序どおり(重複含む)
  cities: { $addToSet: 'city' }, // 一意な都市の集合
});
// [{ _key: 'alice', allTags: ['ts', 'db', 'ts'], cities: ['Tokyo', 'Osaka'] }]
```

> **メモリに関する注意:** `$push` と `$addToSet` はメモリを消費するコレクタです — カーディナリティの高いグループは大きな出力配列を生成します。`$push` は `MAX_GROUP_DOCUMENTS`(グループあたり 100,000 ドキュメント)のみで制限されます。`$addToSet` はさらに `MAX_DISTINCT_COUNT`(**グループごと**に 100,000 個の一意な値)で上限が設定されており、これは `$countDistinct` と同じ上限・同じ `ValidationError` です。カーディナリティが高い場合は、スカラーアキュムレータを使うか、グループを絞り込むことを推奨します。
>
> **名前の再利用について:** `$push`/`$addToSet` は更新演算子としても存在します(後述の[更新演算子](#更新演算子)を参照)。両者は無関係です: `groupBy` 内ではオペランドはフィールドパスの**文字列**ですが、更新スペック内ではオペランドは更新**命令**です(例: `{ $push: { tags: 'new' } }`)。同一オブジェクト上で両者が共存することはありません。

> **オブジェクトキーの順序:** グループ化対象フィールドの値がオブジェクトまたは配列の場合、`JSON.stringify` でシリアライズされます。同じプロパティを持つオブジェクトでも挿入順序が異なる場合（例: `{a:1, b:2}` と `{b:2, a:1}`）は**別のグループ**として扱われます。一貫したグルーピングが必要な場合は、挿入前にプロパティの順序を正規化してください。この挙動は複数次元形式の各次元にも個別に適用されます。

### 更新演算子

| 演算子      | 説明                                                       | 例                                  |
| ----------- | ---------------------------------------------------------- | ----------------------------------- |
| `$set`      | フィールド値の設定                                         | `{ $set: { name: 'Bob' } }`         |
| `$unset`    | フィールドの削除                                           | `{ $unset: { temp: true } }`        |
| `$inc`      | 数値フィールドのインクリメント                             | `{ $inc: { views: 1 } }`            |
| `$rename`   | フィールド名の変更（移動先が既存の場合は ValidationError） | `{ $rename: { old: 'new' } }`       |
| `$push`     | 配列に値を追加                                             | `{ $push: { tags: 'new' } }`        |
| `$pull`     | 配列からマッチする値をすべて削除                           | `{ $pull: { tags: 'old' } }`        |
| `$addToSet` | 配列に値が存在しない場合のみ追加                           | `{ $addToSet: { tags: 'unique' } }` |

更新演算子でもドット記法が使えます:

```ts
{ $set: { 'address.city': 'Osaka' } }
{ $inc: { 'stats.visits': 1 } }
```

配列演算子の例:

```ts
// 配列に追加（フィールドが存在しない場合は配列を作成）
await users.update({ name: 'Alice' }, { $push: { hobbies: 'cycling' } });

// 値のすべての出現を削除（オブジェクトはディープイコリティで比較）
await users.update({ name: 'Alice' }, { $pull: { hobbies: 'cycling' } });

// まだ存在しない場合のみ追加
await users.update({ name: 'Alice' }, { $addToSet: { hobbies: 'reading' } });
```

### 変更イベント

`watch()` を使用して、コレクションの insert、update、remove イベントを購読できます:

```ts
const users = db.collection('users');

const unsubscribe = users.watch((event) => {
  console.log(event.type); // 'insert' | 'update' | 'remove'
  console.log(event.collection); // 'users'
  console.log(event.documentId); // ドキュメントの _id
  console.log(event.document); // 変更後のドキュメント（'remove' の場合は null）
});

await users.insert({ name: 'Alice', age: 30 });
// watch コールバックが type: 'insert' で発火

// 購読解除
unsubscribe();
```

イベントは各書き込み操作の後に同期的に発行されます。イベント内の `document` はディープクローンのため、変更しても格納データには影響しません。

> **注意:** `watch()` リスナーがエラーをスローした場合、エラーはキャッチされ `console.warn` でログ出力されます。呼び出し元への伝播や `db.on('error')` への転送は行われません。これにより、不具合のあるリスナーがイベントをトリガーした書き込み操作を中断しないことが保証されます。

### TTL（Time-To-Live）

コレクションに TTL（秒単位）を設定できます。有効期限切れのドキュメントはクエリ結果から自動的に除外されます:

```ts
// ドキュメントは挿入から 1 時間（3600 秒）後に期限切れ
const sessions = db.collection('sessions', { ttl: 3600 });

await sessions.insert({ userId: 'u1', token: 'abc123' });

// 1 時間後、ドキュメントは find/findOne/count で返されなくなる
```

`_createdAt` は純粋に TTL の内部管理用フィールドです。そのため、**`ttl` オプションを持つコレクションは `immutableCreatedAt` の値にかかわらず常に `_createdAt` を保護します**: 挿入時、`_createdAt` は呼び出し元が値を指定していても常にサーバーのタイムスタンプ（`Date.now()`、エポックミリ秒）で上書きされます。`ttl` を設定していないコレクションでは、デフォルトでこのフィールドの注入・保護は行われません。

> **注意:** `update()` は `_createdAt` をリセットしません。さらに、TTL が設定されたコレクションでは `_createdAt` を一切変更できません。`_createdAt` を対象とする演算子（`$set`、`$unset`、`$inc`、`$push`、`$pull`、`$addToSet`、`$rename`）はすべて `ValidationError` をスローします。TTL の有効期限は作成時刻のみに基づき、その場で延長することはできません。有効期限をリセットするには、ドキュメントを削除して再挿入してください。

#### `immutableCreatedAt` オプション

TTL コレクションは上記の通り自動的に `_createdAt` を保護するため、`immutableCreatedAt` を設定する必要はありません。`ttl` を**使用しない**コレクションで、この保護のうち更新時の部分を得たい場合に `immutableCreatedAt: true` を設定します:

```ts
const auditLog = db.collection('audit-log', {
  immutableCreatedAt: true,
});
```

`immutableCreatedAt: true` の場合:

- `_createdAt` を対象とする更新（`$set`、`$unset`、`$inc`、`$push`、`$pull`、`$addToSet`、`$rename`）は、条件なしに `ValidationError` をスローします。
- 挿入時にサーバーのタイムスタンプを強制する動作は、このオプション単独では発生しません。この上書きは `_createdAt` の TTL 管理用途に紐づいており、`ttl` が設定されている場合にのみ発生します。`ttl` を設定していないコレクションでは、`immutableCreatedAt: true` は「一度だけ書き込み可能」という保証になります。挿入直後の `_createdAt`(ユーザー指定の値、または未指定のまま)は、以降の更新で変更できなくなります。

デフォルト（`false`）が意味を持つのは `ttl` を**設定していない**コレクションのみです。その場合 `_createdAt` は通常のフィールドとして扱われ、挿入時・更新時のいずれでもクライアントから自由に変更できます。

有効期限切れのドキュメントをストレージから完全に削除するには `purgeExpired()` を呼びます:

```ts
const removedCount = await sessions.purgeExpired();
```

### 非同期カーソル

`cursor()` は結果セットに対するイテレーションインターフェースを提供します。内部ではフィルタ済みの全件をバッファリングしてから yield するため、メモリプロファイルは `toArray()` と同等であり、`maxMatchedDocuments` の上限も同様に適用されます。メモリを抑えるには、`cursor()` に頼るのではなく `.limit(n)` を追加してください（ページングには `.skip()` も併用できます）。

```ts
for await (const user of users
  .find({ status: 'active' })
  .sort({ name: 1 })
  .cursor()) {
  console.log(user.name);
}
```

`cursor()` は `AsyncGenerator` を返し、`toArray()` と同様に `sort`、`skip`、`limit`、`project` の設定を反映します。

### 永続ストレージ

frostpillar-db はすべての永続化を frostpillar-storage-engine に委譲します。`Database` コンストラクタにドライバーを渡してください。

各コレクションは専用のデータストアで管理されるため、永続化するコレクションごとに独立した物理名前空間（ファイルパス、キープレフィックス、IndexedDB データベースなど）が必要です。コレクション名を受け取ってドライバーを返す**ドライバーファクトリ**を渡すことで、コレクションごとに分離された名前空間を割り当てられます。

**Node.js / TypeScript:**

```ts
import { Database } from '@frostpillar/frostpillar-db';
import { fileDriver } from '@frostpillar/frostpillar-db/drivers/file';

const db = new Database({
  driver: (name) =>
    fileDriver({
      target: { kind: 'directory', directory: './data', fileName: name },
    }),
  autoCommit: { frequency: '5s', maxPendingBytes: 1024 * 1024 },
});
```

**ブラウザ:**

```js
const { Database, indexedDBDriver } = window.FrostpillarDB;

const db = new Database({
  driver: (name) =>
    indexedDBDriver({
      databaseName: `my-app-${name}`,
      objectStoreName: 'records',
      version: 1,
    }),
  autoCommit: { frequency: '5s' },
});
```

単一のドライバーインスタンス（例: `driver: fileDriver({ filePath: './data/myapp.fpdb' })`）は、コレクションが **1 つだけ**のデータベースで引き続き使用できます。1 つのドライバーインスタンスは 1 つの物理名前空間に対応するため、この形式で 2 つ目のコレクションを作成すると `ConfigurationError` がスローされます。その場合はファクトリ形式に切り替えてください。

利用可能なドライバーと設定オプションの詳細は [frostpillar-storage-engine のドキュメント](https://github.com/hjmsano/frostpillar-storage-engine) を参照してください。

### ペイロード制限

デフォルトでは、各ドキュメントのサイズは 1 MB に制限されています。`payloadLimits` オプションでドキュメントごとのバリデーション制限をカスタマイズできます:

```ts
import { Database } from '@frostpillar/frostpillar-db';
import type { PayloadLimitsConfig } from '@frostpillar/frostpillar-db';

const db = new Database({
  payloadLimits: {
    maxTotalBytes: 16 * 1024 * 1024, // ドキュメントあたり 16 MB
    maxStringBytes: 4 * 1024 * 1024, // 文字列値あたり 4 MB
  },
});
```

すべてのフィールドはオプションです。省略されたフィールドはデフォルト値を保持します:

| フィールド         | デフォルト        | 説明                              |
| ------------------ | ----------------- | --------------------------------- |
| `maxDepth`         | 64                | 最大ネスト深度                    |
| `maxKeyBytes`      | 1,024             | 単一キーの最大 UTF-8 バイト長     |
| `maxStringBytes`   | 65,535            | 単一文字列値の最大 UTF-8 バイト長 |
| `maxKeysPerObject` | 256               | オブジェクトあたりの最大キー数    |
| `maxTotalKeys`     | 4,096             | ドキュメント全体の最大キー数      |
| `maxTotalBytes`    | 1,048,576（1 MB） | 推定 JSON バイトサイズの最大値    |

ペイロード制限はデータベース内のすべてのコレクションに適用され、`insert`、`insertMany`、および `update` で検証されます。`update` では、演算子適用後の結果ドキュメントが検証されます。無効な制限値はコンストラクション時に `ConfigurationError` をスロー、制限を超えるドキュメントは書き込み時に `ValidationError` をスローします。

> **`maxTotalBytes` は近似値:** バイト数は `JSON.stringify` の出力サイズの近似値です。UTF-8 文字幅と JSON 区切り文字は考慮されますが、制御文字のエスケープシーケンスは考慮されないため、実際の出力は推定値より大きくなる場合があります。`maxTotalBytes` をダウンストリームのハードリミット（例: HTTP ボディサイズ制限）に近い値に設定する場合は、安全マージンを確保してください。

> **空白のみのキー:** 空白文字のみで構成されたドキュメントキー（例: `" "`、`"\t"`）は `ValidationError` で拒否されます。キーはトリム後に空でない必要があります。

> **注意:** `update` では、すべての演算子適用後の**結果ドキュメント**に対してペイロード制限が検証されます。結果がいずれかの制限を超える場合、更新は `ValidationError` で拒否され、元のドキュメントは変更されません。

> **注意:** `insert` / `insertMany` では、**実際に保存される形**のドキュメントに対して制限が検証されます。frostpillar-db が生成するフィールド（`_id` を省略した場合の `_id`、TTL コレクションの `_createdAt`）も対象です。したがってキーが 256 個のドキュメントは、自前の `_id` を指定しない限り `maxKeysPerObject: 256` に収まりません。これにより、挿入されたドキュメントは同じ制限の下で更新可能な状態を保てます（`update` は生成フィールドを含む保存済みドキュメントを検証するため）。

> **非対応の型:** `bigint`、クラスインスタンス、関数、`undefined`、`Symbol`、循環参照は JSON 互換ではないため、挿入時に `ValidationError` で拒否されます。

#### `skipPayloadValidation`

信頼できる入力でバリデーションのオーバーヘッドが不要な場合は、`DatabaseConfig` に `skipPayloadValidation: true` を指定します。すべての書き込みパス（ユーザーが呼び出す `insert`、`insertMany`、`update` を含む）でペイロード検証が無効化され、`payloadLimits` は無視されます。

```ts
const db = new Database({
  skipPayloadValidation: true,
});
```

このオプションは、挿入されるデータを完全に制御できる場合にのみ使用してください。バリデーションをスキップすると、過大なドキュメントがそのままストレージに到達します。

スキップモードでも、軽量なセキュリティバリデータはすべての書き込みで実行されます。予約キー、循環参照、`maxDepth` を超える深いネスト、プレーンでないオブジェクト値（クラスインスタンス、`Date`、`Map`、`Set`、`Object.create(proto)`）は `ValidationError` で拒否されます。スキップモードが無効化するのはサイズ計算（バイト数、キー数、文字列・キー長の上限）です。

#### `maxMatchedDocuments`

`find().toArray()`、`update()`、`remove()` はマッチしたドキュメントをメモリにバッファリングします。大規模なコレクションでのメモリ消費の肥大化を防ぐため、frostpillar-db は 1 回のスキャンあたりのマッチドキュメント数に上限を設けています。

```ts
const db = new Database({ maxMatchedDocuments: 10_000 });
```

- 正の安全な整数である必要があります。`0`、負の数、または非整数を指定すると `ConfigurationError` がスローされます。
- デフォルト: `100,000`。
- スキャン中にマッチ数が上限を超えると、`limit()` の使用を促すメッセージとともに `ValidationError` がスローされます。
- `count()` はドキュメントをバッファリングしないため、この上限の影響を受けません。

> **ヒント:** 最初の _n_ 件だけが必要な場合は、クエリに `.limit(n)` を追加してください。`sort` が指定されていなければスキャンが短絡され、上限に達することを回避できます。

### 運用上の制限

ペイロード制限に加えて、frostpillar-db はフィルタ・更新演算子・集約出力に固定の運用上の制限を設けています。これらは構成不可で、病的な入力や暴走するリソース消費を防ぐためのものです。

| 制限                            | 値      | 範囲                                                                                      |
| ------------------------------- | ------- | ----------------------------------------------------------------------------------------- |
| フィールドパス最大深度          | 32      | 1 つのフィールドパスに含まれるドット区切りのセグメント数（例 `a.b.c` は 3）               |
| フィールドパス最大文字数        | 512     | ドット記法のフィールドパス文字列長                                                        |
| フィルタ最大ネスト深度          | 32      | `$and` / `$or` と、ネストされた `$not` 式のネスト階層                                     |
| 論理演算子オペランド最大数      | 1,000   | 1 つの `$and` / `$or` オペランド配列の要素数                                              |
| オペランド配列最大サイズ        | 10,000  | `$in` / `$nin` / `$all` のオペランド配列要素数                                            |
| `$regex` パターン最大長         | 1,024   | `$regex` 文字列パターンの文字数                                                           |
| `$regex` 量指定子最大数         | 20      | `$regex` パターン内の量指定子（`*`、`+`、`?`、`{n,m}`）の数                               |
| `$regex` 省略可能量指定子最大数 | 8       | `$regex` パターン内の省略可能な量指定子（`?`、`*`、`{0,m}`）の数                          |
| `$regex` 選択グループ最大数     | 4       | `$regex` パターン内の選択グループ（`(a\|b)`）の数                                         |
| `$regex` テスト対象最大長       | 8,192   | `$regex` で評価されるフィールド値の文字数                                                 |
| ドキュメント配列最大長          | 100,000 | `$push` / `$addToSet` 適用後の 1 ドキュメント内配列の要素数                               |
| `groupBy` アキュムレータ最大数  | 32      | 1 回の `groupBy()` に指定できるアキュムレータ数                                           |
| `groupBy` グループ最大数        | 100,000 | 1 回の `groupBy()` が生成する一意グループキー数                                           |
| `groupBy` グループ内最大数      | 100,000 | 1 つの `groupBy()` グループに集約されるドキュメント数                                     |
| `distinct` 値最大数             | 100,000 | 1 回の `distinct()` が返す一意値の数                                                      |
| `countDistinct` 値最大数        | 100,000 | 1 回の `countDistinct()`、または 1 つの `$countDistinct` グループがカウントする一意値の数 |
| `$addToSet` 値最大数            | 100,000 | 1 つの `$addToSet` グループが収集する一意値の数(`$countDistinct` と同じ上限)              |

`$regex` パターンはさらに、破滅的バックトラッキングにつながる形状が事前スクリーニングされ、コンパイル前に `ValidationError` で拒否されます。上記制限を超えた場合は実行時に `ValidationError` がスローされます。このスクリーニングは 3 つの仕組みで構成されます:

- 構造的なネスト量指定子の汎用チェック: _繰り返される_ グループ(`+`、`*`、または最大回数が 2 以上・無制限の `{n,m}` で修飾されたもの)のうち、その内容自体にも別の量指定子を含むもの(ネストの深さを問わず、両側の量指定子記法の組み合わせも問わない)を拒否します(例: `(a+)+`、`([a-z]+)+`、`(a{1,2})+`、および `(a{1,10}){1,10}` のような組み合わせ。列挙型のパターンリストであればこれらを個別に特殊対応する必要があります)。外側の量指定子が `?` または最大 1 回以下の範囲指定(例: `(\d+)?`、`(a+){0,1}`)であるグループは高々 1 回しかマッチせず指数的バックトラッキングを起こしえないため、こうしたパターンは許可されます。
- 構造的な量指定子付き選択グループのチェック: _繰り返し_ 量指定子(`+`、`*`、無制限の `{n,}`、または最大回数が 2 以上の `{n}`/`{n,m}`)が、**任意のネスト深度に** エスケープされていない `|` を含むグループに適用されているパターンを拒否します(例: `(a|a)+`、`(a|ab)*`、`(aa|a){2,}`、`(?:aa|a){2,50}`、および `((a|aa))+` や `(?:(?:a|ab))+` のような入れ子形。冗長なグループが囲んでも外側の繰り返しから選択は隠せません)。このスクリーニングは保守的で曖昧性解析を行わないため、内部のどこかに `|` を持つ繰り返しグループ(例: `(x(a|b)y)+`)も拒否します。繰り返しでない量指定子(`?`、`{0,1}`、`{1}`)や量指定子なしの選択グループは許可されます。
- 上記に該当しないその他の破滅的な形状に対する個別実装の検出器: 重なるワイルドカード、隣接する量指定子、量指定子を伴う後方参照。

省略可能量指定子数の上限は、独立してスキップ可能なアトムの連鎖(例: `^.?.?….?aaa…a$`)への対策です。この形ではどの量指定子も高々 1 回しかマッチしないため、繰り返し・ネスト・選択のいずれのチェックにも掛かりませんが、各アトムがスキップするか否かの独立した分岐となり、マッチ失敗時には最大 2^k 通りの経路が探索されます。上限を 8 とすることで、この形の探索経路を約 256 通りに抑えます。この上限は隣接する連続数ではなくパターン全体の総数で数えます — 省略可能なアトムの間に挟まれた必須アトム(`.?\w.?\w…`)は常にマッチするため、分岐を刈り取らないからです。

選択グループ数の上限は、量指定子を一切使わずに曖昧な選択グループを手動で繰り返す攻撃(例: `(a|aa)` を量指定子なしで何度も連結する)への対策です。この形は量指定子トークンを持たないため、上記の量指定子ベースのチェックをすり抜けます。他のパターンヒューリスティックと同様、これらはいずれも既知の破滅的バックトラッキング形状に対する多層防御のスクリーニングであり、あらゆる `$regex` パターンが線形時間で実行されることを形式的に証明するものではありません — リスクを大幅に狭めますが、このカテゴリのリスクを完全には排除しません。

#### 予約キー

プロトタイプ汚染攻撃を防ぐため、`__proto__`、`constructor`、`prototype`、`__defineGetter__`、`__defineSetter__`、`__lookupGetter__`、`__lookupSetter__` の名前は、ユーザー入力がオブジェクトに到達するすべての箇所で `ValidationError` により拒否されます:

- 挿入されるドキュメントペイロードのキー（ネストされたオブジェクトや `$set` / `$rename` のターゲットを含む）。
- フィルタオブジェクトのトップレベルキー。
- 任意のドット記法パス（フィルタキー、ソート指定、プロジェクション指定、更新演算子）のセグメント。

これらの名前をドキュメントのフィールドとして使用しないでください。JSON 互換の任意の代替（例: `type`、`kind`、`ctor`）を使用できます。

### インデックス設定

frostpillar-db はデフォルトで B+ ツリーインデックスの**自動スケーリング**が有効です。データの増加に応じてノード容量が自動的に拡張されます。ほとんどのユースケースではこの設定が推奨され、特別な設定は不要です。

固定ノードサイズを使用する場合は、`index` オプションを指定します:

```ts
import { Database } from '@frostpillar/frostpillar-db';
import type { IndexConfig } from '@frostpillar/frostpillar-db';

// 自動スケーリング（デフォルト — 設定不要）
const db = new Database();

// 固定ノードサイズ
const dbFixed = new Database({
  index: { autoScale: false, maxLeafEntries: 128, maxBranchChildren: 32 },
});
```

| フィールド              | デフォルト   | 説明                                                                                 |
| ----------------------- | ------------ | ------------------------------------------------------------------------------------ |
| `autoScale`             | `true`       | データの増加に応じてノード容量を自動的に拡張                                         |
| `maxLeafEntries`        | —            | リーフノードあたりの最大エントリ数（3〜16,384）。`autoScale: false` の場合のみ有効   |
| `maxBranchChildren`     | —            | ブランチノードあたりの最大子ノード数（3〜16,384）。`autoScale: false` の場合のみ有効 |
| `deleteRebalancePolicy` | `'standard'` | 削除後のリバランス戦略（`'standard'` または `'lazy'`）                               |

`autoScale` が `true` の状態で `maxLeafEntries` や `maxBranchChildren` を設定すると `ConfigurationError` がスローされます。データベースレベルのインデックス設定はすべてのコレクションのデフォルトとして適用されますが、コレクションごとに上書きできます。

### エラーハンドリング

すべてのエラーは `FrostpillarError` を継承します。

**Node.js / TypeScript:**

```ts
import { FrostpillarError } from '@frostpillar/frostpillar-db';

try {
  await users.insert({ _id: 'duplicate', name: 'Test' });
} catch (error) {
  if (error instanceof FrostpillarError) {
    console.error(error.name, error.message);
  }
}
```

**ブラウザ:**

```js
const { FrostpillarError } = window.FrostpillarDB;

try {
  await users.insert({ _id: 'duplicate', name: 'Test' });
} catch (error) {
  if (error instanceof FrostpillarError) {
    console.error(error.name, error.message);
  }
}
```

| エラー                | 説明                                                                    |
| --------------------- | ----------------------------------------------------------------------- |
| `ValidationError`     | 不正な入力（フィルタ、更新、コレクション名等）                          |
| `DuplicateIdError`    | 既存の `_id` を持つドキュメントの挿入                                   |
| `ClosedDatabaseError` | 閉じられたデータベースへの操作                                          |
| `ConfigurationError`  | 無効なデータベース/インデックス設定、またはコレクションオプションの競合 |
| `QuotaExceededError`  | ストレージ容量超過                                                      |
| `DatabaseLockedError` | データベースファイルが別プロセスにロックされている                      |

---

## API リファレンス

### Database

| メソッド                     | 戻り値              | 説明                                 |
| ---------------------------- | ------------------- | ------------------------------------ |
| `new Database(config?)`      | `Database`          | データベースインスタンスの作成       |
| `collection(name, options?)` | `Collection`        | コレクションの取得・作成             |
| `dropCollection(name)`       | `Promise<void>`     | コレクション内の全ドキュメントを削除 |
| `listCollections()`          | `Promise<string[]>` | 登録済みコレクション名の一覧         |
| `commit()`                   | `Promise<void>`     | 永続ストレージへのフラッシュ         |
| `close()`                    | `Promise<void>`     | リソースの解放                       |
| `on('error', listener)`      | `() => void`        | 非同期エラーの監視                   |

### Collection

| メソッド                        | 戻り値                      | 説明                                                   |
| ------------------------------- | --------------------------- | ------------------------------------------------------ |
| `insert(doc)`                   | `Promise<string>`           | 挿入。`_id` を返す                                     |
| `insertMany(docs)`              | `Promise<string[]>`         | 複数挿入。`_id[]` を返す                               |
| `find(filter?)`                 | `ResultChain`               | フィルタ付きクエリ                                     |
| `findOne(filter?)`              | `Promise<Document \| null>` | 最初のマッチ                                           |
| `update(filter, ops, options?)` | `Promise<UpdateResult>`     | マッチを更新。`{ upsert: true }` をサポート            |
| `remove(filter)`                | `Promise<number>`           | マッチを削除。件数を返す                               |
| `count(filter?)`                | `Promise<number>`           | マッチ件数                                             |
| `watch(listener)`               | `() => void`                | 変更イベントの購読。購読解除関数を返す                 |
| `exists(id)`                    | `Promise<boolean>`          | 指定された `_id` のドキュメントが存在するか確認        |
| `ids()`                         | `Promise<string[]>`         | ペイロードを読み込まずに全ドキュメントIDを返す         |
| `purgeExpired()`                | `Promise<number>`           | 有効期限切れドキュメントの削除（TTL コレクションのみ） |

### ResultChain

| メソッド                        | 戻り値                        | 説明                                                                                               |
| ------------------------------- | ----------------------------- | -------------------------------------------------------------------------------------------------- |
| `.sort(spec)`                   | `ResultChain`                 | ソート順の設定（`SortSpec` オブジェクトまたは `SortSpecEntries` 配列）                             |
| `.limit(n)`                     | `ResultChain`                 | 結果数の制限                                                                                       |
| `.skip(n)`                      | `ResultChain`                 | 結果のスキップ                                                                                     |
| `.project(spec)`                | `ResultChain`                 | フィールド選択                                                                                     |
| `.toArray()`                    | `Promise<Document[]>`         | クエリ実行、ドキュメント返却                                                                       |
| `.cursor()`                     | `AsyncGenerator<Document>`    | 結果セットの非同期イテレータ                                                                       |
| `.count()`                      | `Promise<number>`             | マッチするドキュメント数                                                                           |
| `.sum(field)`                   | `Promise<number>`             | 数値フィールドの合計                                                                               |
| `.avg(field)`                   | `Promise<number \| null>`     | 数値フィールドの平均                                                                               |
| `.min(field)`                   | `Promise<number \| null>`     | 数値の最小値                                                                                       |
| `.max(field)`                   | `Promise<number \| null>`     | 数値の最大値                                                                                       |
| `.percentile(field, p)`         | `Promise<number \| null>`     | `p` パーセンタイル（`p` は `[0, 1]` の割合）                                                       |
| `.median(field)`                | `Promise<number \| null>`     | 中央値（`percentile(field, 0.5)` と等価）                                                          |
| `.stdDevPop(field)`             | `Promise<number \| null>`     | 母標準偏差（`n=0`→`null`、`n=1`→`0`）                                                              |
| `.stdDevSamp(field)`            | `Promise<number \| null>`     | 標本標準偏差（`n<2`→`null`）                                                                       |
| `.variancePop(field)`           | `Promise<number \| null>`     | 母分散（`n=0`→`null`、`n=1`→`0`）                                                                  |
| `.varianceSamp(field)`          | `Promise<number \| null>`     | 標本分散（`n<2`→`null`）                                                                           |
| `.distinct(field)`              | `Promise<unknown[]>`          | フィールドのユニーク値                                                                             |
| `.countDistinct(field)`         | `Promise<number>`             | フィールドのユニーク値の数（`=== distinct(field).length`。空の場合は `0`）                         |
| `.groupBy(field, accumulators)` | `Promise<GroupResultEntry[]>` | フィールド（`string \| string[]`）でグループ化しアキュムレータを計算。配列形式は複合 `_key` を生成 |

---

## コントリビュート

### 必要環境

- Node.js `>=24.0.0`
- pnpm `>=10.0.0`

### 開発コマンド

| コマンド            | 説明                                        |
| ------------------- | ------------------------------------------- |
| `pnpm check`        | 型チェック、リント、テスト、textlint の実行 |
| `pnpm test`         | テストの実行                                |
| `pnpm build`        | パッケージのビルド                          |
| `pnpm build:bundle` | ブラウザ IIFE バンドルのビルド              |

### 開発ワークフロー

このプロジェクトは厳格な SDD/TDD ワークフローに従います:

1. **仕様** — 実装前に `docs/specs/` の仕様を更新・作成
2. **テスト** — コードの前にテストを記述
3. **コード** — テストを通す最小限のロジックを実装
4. **検証** — `pnpm check` ですべてがパスすることを確認

### ドキュメント

- [アーキテクチャ概要](docs/architecture/overview.md)
- [ビジョンと原則](docs/architecture/vision-and-principles.md)
- [テスト戦略](docs/architecture/testing-strategy.md)
- [仕様一覧](docs/specs/README.md)
- [ADR](docs/adr)

---

## ライセンス

[MIT](LICENSE)
