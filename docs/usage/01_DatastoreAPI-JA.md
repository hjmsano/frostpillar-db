# 使い方: Datastore API (v0.2 draft)

Status: Draft  
Last Updated: 2026-03-07

このドキュメントは `docs/specs/04_DatastoreAPI.md` で定義した公開 API の利用方法を説明します。

実装ステータス注記（2026-03-07）:

- `location: "memory"` は基準バックエンドとしてサポートされています。
- `location: "file"` は durability-slice の段階実装として利用可能です。
- `location: "browser"` は将来スコープで、現時点では `UnsupportedBackendError` になります。

## 1. 基本セットアップ (Memory Backend)

```typescript
import { Datastore } from "frostpillar";

const db = new Datastore({ location: "memory" });
```

`location: "memory"` では `autoCommit` は利用できません。

## 2. レコード挿入

```typescript
await db.insert({
  timestamp: "2025-01-01T00:00:00.000Z",
  payload: {
    event: "login",
    success: true,
  },
});
```

バリデーション注意点:

- `timestamp` は `number | string | Date` を受け付けます。
- `string` はタイムゾーン付き ISO 8601 日時である必要があります（例: `Z`, `+09:00`）。
- canonical timestamp は Unix epoch ミリ秒の JavaScript safe integer（`Number.isSafeInteger`）です。
- `payload` はネストしたオブジェクトをサポートします。
- payload の最大ネスト深さは 64 です（payload ルートを深さ 0 として数えます）。
- payload キーの UTF-8 バイト長上限は 1024 です。
- payload 文字列値の UTF-8 バイト長上限は 65535 です。
- 末端の値は `string | number | boolean | null` である必要があります（配列は未対応）。
- payload の `number` 値は有限値（`Number.isFinite`）である必要があります（`NaN`, `Infinity`, `-Infinity` は拒否されます）。
- payload の `bigint` 値は v0.2 ではサポートされません。
- `insertionOrder` は Datastore 内部管理メタデータであり、アプリケーション入力で指定してはいけません。
- payload で 64-bit 整数の厳密な精度が必要な場合は、10進文字列として保存し、アプリケーション側でパースしてください。

追加の有効例:

```typescript
await db.insert({
  timestamp: new Date("2025-01-01T00:00:00.000Z"),
  payload: {
    event: "logout",
    user: {
      profile: {
        country: "JP",
      },
    },
  },
});
```

## 3. 時間範囲クエリ

```typescript
const records = await db.select({
  start: "2025-01-01T00:00:00.000Z",
  end: "2025-01-01T00:01:39.999Z",
});
```

挙動:

- 範囲は両端を含みます (`start <= timestamp <= end`)
- `start`/`end` も `insert` と同じ timestamp ルール（`number | string | Date`）です
- 結果は `timestamp` 昇順で返ります
- 同一 `timestamp` は挿入順で返ります
- 挿入順は内部で永続化される `insertionOrder` キー（`Uint64`）で管理されるため、
  再起動・ページ分割・compaction・rewrite 後も順序は安定します
- M3+ の範囲読み取り経路は B+ tree の lower-bound seek + linked-leaf scan を使用します
  （期待計算量 `O(log N + K)`、`K` は返却行数）
- 既存レコードの更新時は、同一 `timestamp` 内での元の順序位置を維持します
- 将来の upsert でも、既存レコードに対する更新経路では元の順序位置を維持します
- 返却される `timestamp` は Unix epoch ミリ秒 (`number`) です

Timestamp 精度に関する注意:

- バイナリ保存は signed `Int64` を使いますが、API で扱う `timestamp` は JavaScript `number` の safe integer のままです。
- 書き込み時は `number -> bigint -> Int64`、読み込み時は `Int64 -> bigint -> number` の境界検証を行います。
- 保存済み `Int64` が JavaScript safe integer 範囲外の場合、デコードは明示的に失敗します（切り捨て・丸めはしません）。

## 4. Commit と Close

```typescript
await db.commit(); // memory backend では no-op
await db.close();
```

`close()` 後はすべての操作が `ClosedDatastoreError` で失敗します。

永続系バックエンド（`location !== "memory"`）での自動コミット:

```typescript
const db = new Datastore({
  location: "file",
  filePath: "./tmp/events.fpdb",
  autoCommit: {
    frequency: "5s", // "immediate", 5000, "1m", "2h" なども指定可能
    maxPendingBytes: 2 * 1024 * 1024, // サイズ閾値トリガー (2 MiB)
  },
});
```

- `frequency` 省略時のデフォルトは `"immediate"` です
- 即時コミット: `"immediate"`（書き込み成功ごとにコミット）
- 5秒ごと: `5000` または `"5s"`
- 1分ごと: `"1m"`
- サイズ閾値コミット: 未コミットの保留バイト数が `maxPendingBytes` に達した時点でコミット
- 間隔トリガーとサイズ閾値を同時指定した場合は、先に満たした条件でコミット
- scheduler は重複トリガーを coalescing します。1つのコミットが進行中に追加トリガーが来た場合、
  保留変更が残っていれば終了後に 1 回だけ追従コミットを実行します
- バックグラウンド auto-commit の失敗は「失敗試行ごとに 1 件」の error event を発火し、
  未反映変更は次回トリガーで再試行できる状態を維持します

バックグラウンド自動コミット（`"immediate"` 以外）で発生した失敗は、Datastore の error channel で受け取ります:

```typescript
import type { DatastoreErrorEvent } from "frostpillar";

const onDatastoreError = (event: DatastoreErrorEvent): void => {
  // event.source === "autoCommit"
  // event.error は StorageEngineError
  // event.occurredAt は epoch milliseconds
  console.error("Datastore background error:", event);
};

const unsubscribe = db.on("error", onDatastoreError);

// 不要になったら解除:
unsubscribe(); // db.off("error", onDatastoreError) と同等
```

補足:

- このチャネルは Promise 返却元が存在しない非同期/バックグラウンド失敗のためのものです
- `insert` / `commit` など明示呼び出しの失敗は、これまで通り各 Promise が reject します
- `close()` はバックグラウンド自動コミットを停止し、以後は auto-commit 由来の error event を発火しません
- サポートされるイベント名は `"error"` のみで、非対応イベント名は `ValidationError` になります

## 4.1 容量制限と保持ポリシー

`capacity.maxSize` とポリシーで保存量を上限管理できます。

```typescript
const db = new Datastore({
  location: "memory",
  capacity: {
    maxSize: "256MB",
    policy: "turnover", // "strict" | "turnover"
  },
});
```

挙動:

- `strict`: 上限超過時は `QuotaExceededError` で失敗（状態変更なし）
- `turnover`: 最も古いレコードから決定的順序で削除し、新規レコードを挿入
- `turnover` の退避削除は内部 delete 経路で実装され、v0.2 では公開 delete API は提供されません
- 単一レコードが `maxSize` を超える場合は `QuotaExceededError` で失敗
- v0.2 では単一レコードのページ跨ぎ分割は行いません。1レコードのページ適合上限は
  `maxSingleRecordBytes = pageSize - 32 - 4` です
- エンコード済みレコードが `maxSingleRecordBytes` を超える場合は `QuotaExceededError` で失敗
- payload 文字列バイト長上限とページ適合判定は独立した境界条件です
- `policy` 省略時のデフォルトは `"strict"`

## 5. File Backend: パス / ディレクトリ / ファイル名 / プレフィックス

`location: "file"` はファイル配置を 2 通りで指定できます。

パス指定（後方互換の簡易指定）:

```typescript
const db = new Datastore({
  location: "file",
  filePath: "./data/events.fpdb",
});
```

同等の明示指定:

```typescript
const db = new Datastore({
  location: "file",
  target: {
    kind: "path",
    filePath: "./data/events.fpdb",
  },
});
```

ディレクトリ指定 + 命名オプション:

```typescript
const db = new Datastore({
  location: "file",
  target: {
    kind: "directory",
    directory: "./data/frostpillar",
    filePrefix: "prod_",
    fileName: "events",
  },
});
```

この例で解決されるファイル:

- メタデータファイル: `./data/frostpillar/prod_events.fpdb.meta.json`
- 世代データファイル: `./data/frostpillar/prod_events.fpdb.g.<commitId>`
- ロックファイル（単一 writer 保護）: `./data/frostpillar/prod_events.fpdb.lock`
- 有効世代は sidecar の `activeDataFile` で選択されます
- 各コミット世代では、再起動時のルート参照用に page `0` を固定メタページとして予約します
- sidecar の `rootPageId` / `nextPageId` / `freePageHeadId` はミラー値であり、page-0 メタページ内容と一致する必要があります
- sidecar の `nextInsertionOrder` には次回採番値を符号なし 10 進文字列で保存し、
  再オープン時に全件走査なし O(1) で insertion-order 採番状態を復元します

単一 writer の挙動（マルチプロセス安全性）:

- file backend は open 時に排他ロック（`<resolvedDataFilePath>.lock`）を取得します
- 他プロセスがロックを保持している場合、open は `DatabaseLockedError`
  （`StorageEngineError` の subtype）で失敗します
- 既定の open フローでは、既存ロックを自動で奪取しません
- file backend の解決後パスは `process.cwd()` 配下に制限されます
- `target.filePrefix` と `target.fileName` にパス区切り文字や `..` は指定できません

### 5.1 File Backend トラブルシューティング（Phase 2 baseline）

- open 時に `DatabaseLockedError` が出る場合:
  - 別プロセスが `<resolvedDataFilePath>.lock` を保持しています
  - ロック保持中のプロセスを停止してから再度 open してください
- open 時に `PageCorruptionError` が出る場合:
  - sidecar の `activeDataFile` が存在し、読み出し可能か確認してください
  - sidecar のミラー値（`rootPageId` / `nextPageId` / `freePageHeadId`）が
    active generation snapshot と一致しているか確認してください
- interrupted commit の一時ファイルについて:
  - `*.tmp` はコミット済み状態ではなく、次回 open 時に無視または掃除されます
  - 有効なコミット状態は sidecar の `activeDataFile` のみで選択されます

## 6. Browser Storage: バックエンド選択とフォールバック

`location: "browser"` は、まず async-native なバックエンドを優先し、互換性のためのフォールバックを持ちます。

クロスブラウザ向け推奨設定:

```typescript
const db = new Datastore({
  location: "browser",
  browserStorage: "auto", // デフォルト
});
```

`"auto"` の解決順:

1. `opfs`
2. `indexedDB`
3. `localStorage`

明示指定の例:

```typescript
const dbIndexed = new Datastore({
  location: "browser",
  browserStorage: "indexedDB",
  indexedDB: {
    databaseName: "frostpillar",
    objectStoreName: "pages",
    version: 1,
  },
});
```

```typescript
const dbLocal = new Datastore({
  location: "browser",
  browserStorage: "localStorage",
  localStorage: {
    keyPrefix: "fp",
    databaseKey: "analytics",
    maxChunkChars: 32768,
    maxChunks: 64,
  },
});
```

補足:

- `opfs` と `indexedDB` は async-native で、async-only アーキテクチャと整合します。
- `localStorage` API は同期APIのため、互換フォールバックとして利用してください。
- 明示指定したバックエンドが利用不可の場合、Datastore は `UnsupportedBackendError` で失敗します。

`browserStorage: "localStorage"` を使う場合:

- キー形式:
  - マニフェスト: `fp:analytics:manifest`
  - チャンク: `fp:analytics:g:<generation>:chunk:<index>`
- 1つのスナップショットは必要に応じて複数キーへ自動分割されます
- 必要チャンク数が `maxChunks` を超える場合は `QuotaExceededError` で失敗します
- ブラウザのクォータ超過も `QuotaExceededError` で通知されます
- 新しい世代の書き込み失敗時でも、直前にコミット済みの世代は読み出し可能である必要があります
- この安全性は世代単位の copy-on-write（新世代チャンクを書き切ってから manifest 切替）で実現します
- commit 中の一時使用量は `旧世代 + 新世代`（実質2倍近傍）まで増える可能性があります
- 実運用の目安として、localStorage の実効利用可能量はブラウザクォータのおおむね50%前後です

## 7. 主なエラー

- `ValidationError`
- `TimestampParseError`
- `InvalidQueryRangeError`
- `ConfigurationError`
- `UnsupportedBackendError`（現在の runtime slice 外のバックエンド）
- `ClosedDatastoreError`
- `StorageEngineError`
- `BinaryFormatError`（バイナリのデコード/エンコード形式違反）
- `PageCorruptionError`（ページ構造の不変条件違反）
- `IndexCorruptionError`（B+ Tree 不変条件違反）
- `QuotaExceededError`
- `DatastoreErrorEvent`（`on("error", ...)` のイベント payload）

## 8. v0.1以降のネイティブレコード操作（予定）

```typescript
const one = await db.getById("1735689600000:42");
await db.updateById("1735689600000:42", { success: false });
await db.deleteById("1735689600000:42");
```

目的:

- 特定レコードの更新・削除には内部IDが必要
- 時系列走査向けの `select` は引き続き利用可能
- 同一 `timestamp` の tie-break は、更新時に元の挿入順を保持することで決定的に維持します
- 予定されている canonical `_id` 形式はタプル由来の `"<timestamp>:<insertionOrder>"` です
  （例: `"1735689600000:42"`）

## 9. オプショナルQuery Engine（SQL/Lucene, 予定）

クエリ言語は初期化設定で固定せず、利用側コードで必要なモジュールをimportして使います。
通常は Query Engine を登録して、Datastore 統合の `query(...)` を使います。

```typescript
import { Datastore } from "frostpillar";
import { sqlEngine } from "frostpillar/query-sql";
import { luceneEngine } from "frostpillar/query-lucene";

const db = new Datastore({ location: "memory" });

db.registerQueryEngine(sqlEngine);
db.registerQueryEngine(luceneEngine);

const sqlResult = await db.query("sql", "SELECT COUNT(*) AS c FROM records WHERE status = 404");

const luceneResult = await db.query(
  "lucene",
  "status:[400 TO 499] AND service:api",
  {
    groupBy: ["service"],
    aggregates: [{ fn: "count", as: "c" }],
    orderBy: [{ field: "c", direction: "desc" }],
    limit: 10,
  },
);
```

ネイティブリクエストを明示的に確認したい場合は、従来どおり手動フローも使えます:

```typescript
const sqlReq = sqlEngine.toNativeQuery(
  "SELECT COUNT(*) AS c FROM records WHERE status = 404",
);
const sqlResultViaNative = await db.queryNative(sqlReq);
```

Canonical field path のエスケープ規則:

- キーセグメント `service.name` -> `service\\.name`
- キーセグメント `region\\zone` -> `region\\\\zone`

補足:

- SQL/LuceneモジュールはCore本体とは分離された任意機能です。
- Frostpillar CoreはTypeScriptネイティブなリクエストを実行します。
- `registerQueryEngine(...)` 前に `db.query(language, ...)` を呼ぶと `QueryEngineNotRegisteredError` で失敗します。
- `db.close()` 後の `db.query(...)` は `ClosedDatastoreError` で失敗します。
- `db.close()` 後の `registerQueryEngine(...)` / `unregisterQueryEngine(...)` は
  `ClosedDatastoreError` で失敗します。
- Query Engine の登録変更は「次に開始される `db.query(...)`」から適用され、
  既に開始済みの `db.query(...)` は呼び出し時に解決した engine を使い続けます。
- Lucene の quoted value 文字列は、引用符内でバックスラッシュエスケープ（`\"`, `\\`）を使用します。
- SQL の `REGEXP` と Lucene の `field:/pattern/` は、ECMAScript `RegExp` と `RegExp.test(...)` の照合挙動に従います。
- `regexp` は look-around・backreference・入れ子量指定グループ（例: `(a+)+`）を拒否します。
- `like`/`regexp` のパターン長は 256 UTF-16 code units に制限され、不正/危険パターンは `QueryValidationError` になります。
- `like` の照合は、追加作業メモリをパターン長に比例する範囲へ制限します。
- 検証済み `regexp` パターンは 1 回の native query 実行につき 1 回だけコンパイルし、候補レコード評価で再利用します。
- 述語評価では暗黙の型変換（文字列→数値など）を行いません。
- `field:*` は native `exists`、`NOT field:*` は native `not_exists` に対応します。
- `field:*` は明示的な `null` 値にも一致します（exists はフィールドパスの存在判定です）。
- Lucene の `field:null` は native `is_null` に対応します（非quotedキーワード）。
- `IS NULL` は明示的な `null` のみを対象とし、欠損フィールド判定は `EXISTS(...)` / `NOT EXISTS(...)` を使用します。
- Lucene の範囲境界は型付きで扱います: 非quoted数値は number、quoted は string、非quoted非数値は string。
- Lucene の `timestamp` はタイムゾーン付き ISO-8601 日時文字列を受け付けます。
- 日付のみ `YYYY-MM-DD` は UTC の 00:00:00.000 として解釈します。
- 有効な Lucene `timestamp` リテラルは評価前に epoch milliseconds へ正規化されます。
- 不正な timestamp リテラルは `QueryValidationError` になります。
