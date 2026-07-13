// Spec 02 §12 / ADR-030: insert payloads, update operations/options, and filters
// are read into snapshots at their public boundaries, and those snapshots are
// what validation, evaluation, and storage use.
//
// The hostile inputs below are fixtures for the time-of-check/time-of-use gap
// this closes: an accessor property (or a Proxy) answers each read differently,
// so validating the caller's object and then re-reading it to clone, evaluate or
// delete let the second read supply a value the first never saw. A plain array
// mutated across an `await` is the same defect without the getter.
import assert from 'node:assert/strict';
import test from 'node:test';

import { ValidationError } from '../../src/errors.js';
import { snapshotFilter } from '../../src/internal/filterSnapshot.js';
import { Database } from '../../src/index.js';

interface Doc {
  _id?: string;
  name?: unknown;
  score?: unknown;
  tags?: unknown;
}

// --- Insert payloads -------------------------------------------------------

void test('insert: a payload getter cannot validate one value and store another', async () => {
  const database = new Database();
  const collection = database.collection<Doc>('docs');

  let reads = 0;
  const payload = {
    _id: 'd1',
    get score(): unknown {
      reads += 1;
      // First read (the validator's) is clean; every later read smuggles in a
      // bigint, which no validator would ever accept.
      return reads === 1 ? 1 : 10n;
    },
  };

  const id = await collection.insert(payload);
  const stored = await collection.findOne({ _id: id });

  assert.equal(stored?.score, 1);
  assert.equal(typeof stored?.score, 'number');
  await database.close();
});

void test('insert: a Proxy payload is read once, and that read is what is stored', async () => {
  const database = new Database();
  const collection = database.collection<Doc>('docs');

  let reads = 0;
  const payload = new Proxy(
    { _id: 'd1', name: 'clean' },
    {
      get(target: Record<string, unknown>, key: string): unknown {
        if (key === 'name') {
          reads += 1;
          return reads === 1 ? 'clean' : 'tampered';
        }
        return target[key];
      },
    },
  ) as Doc;

  await collection.insert(payload);

  assert.equal((await collection.findOne({ _id: 'd1' }))?.name, 'clean');
  await database.close();
});

void test('insert: a bigint from a getter is rejected, not stored', async () => {
  const database = new Database();
  const collection = database.collection<Doc>('docs');

  const payload = {
    _id: 'd1',
    get score(): unknown {
      return 10n;
    },
  };

  await assert.rejects(() => collection.insert(payload), ValidationError);
  assert.equal(await collection.count(), 0);
  await database.close();
});

void test('insert: a function value is rejected under skipPayloadValidation', async () => {
  // The reduced validator used to skip every non-object leaf, and cloneDocument
  // returned a function unchanged — so the stored document kept sharing the
  // caller's function object and mutating it changed later reads and distinct().
  const database = new Database({ skipPayloadValidation: true });
  const collection = database.collection<Doc>('docs');

  await assert.rejects(
    () => collection.insert({ _id: 'd1', score: () => 1 }),
    ValidationError,
  );
  assert.equal(await collection.count(), 0);
  await database.close();
});

void test('insertMany: a getter document is materialized before any record is prepared', async () => {
  const database = new Database();
  const collection = database.collection<Doc>('docs');

  let reads = 0;
  const hostile = {
    _id: 'd2',
    get name(): unknown {
      reads += 1;
      return reads === 1 ? 'clean' : { toString: () => 'x' };
    },
  };

  await collection.insertMany([{ _id: 'd1', name: 'a' }, hostile]);

  assert.equal((await collection.findOne({ _id: 'd2' }))?.name, 'clean');
  await database.close();
});

// --- Update operands -------------------------------------------------------

void test('update: a $set getter cannot validate one value and write another', async () => {
  const database = new Database();
  const collection = database.collection<Doc>('docs');
  await collection.insert({ _id: 'd1', score: 0 });

  let reads = 0;
  const operations = {
    $set: {
      get score(): unknown {
        reads += 1;
        return reads === 1 ? 7 : 10n;
      },
    },
  };

  await collection.update({ _id: 'd1' }, operations);

  assert.equal((await collection.findOne({ _id: 'd1' }))?.score, 7);
  await database.close();
});

void test('update: a $rename destination getter cannot bypass the _createdAt guard', async () => {
  const database = new Database();
  const collection = database.collection<Doc>('docs', {
    immutableCreatedAt: true,
  });
  await collection.insert({ _id: 'd1', name: 'a' });

  let reads = 0;
  const operations = {
    $rename: {
      get name(): unknown {
        reads += 1;
        // The validator sees a legal destination; the applier used to re-read
        // the map and would have renamed the field onto the guarded one.
        return reads === 1 ? 'label' : '_createdAt';
      },
    },
  };

  await collection.update({ _id: 'd1' }, operations);

  const stored = await collection.findOne({ _id: 'd1' });
  assert.equal(stored?.name, undefined);
  assert.equal((stored as Record<string, unknown>).label, 'a');
  assert.equal((stored as Record<string, unknown>)._createdAt, undefined);
  await database.close();
});

void test('update: one getter snapshot is applied to every matched document', async () => {
  const database = new Database();
  try {
    const collection = database.collection<Doc>('docs');
    await collection.insert({ _id: 'd1', score: 0 });
    await collection.insert({ _id: 'd2', score: 0 });

    let reads = 0;
    const operations = {
      $set: {
        get score(): number {
          reads += 1;
          return reads === 1 ? 7 : 9;
        },
      },
    };

    const result = await collection.update({}, operations);
    const stored = await collection.find().sort({ _id: 1 }).toArray();

    assert.deepEqual(
      {
        reads,
        modifiedCount: result.modifiedCount,
        scores: stored.map((document) => document.score),
      },
      { reads: 1, modifiedCount: 2, scores: [7, 7] },
    );
  } finally {
    await database.close();
  }
});

void test('update: mutating operations during the pending scan cannot change the result', async () => {
  const database = new Database();
  try {
    const collection = database.collection<Doc>('docs');
    await collection.insert({ _id: 'd1', score: 0 });
    await collection.insert({ _id: 'd2', score: 0 });

    const operations = { $set: { score: 1 } };
    const pending = collection.update({}, operations);
    operations.$set.score = 9;
    const result = await pending;
    const stored = await collection.find().sort({ _id: 1 }).toArray();

    assert.deepEqual(
      {
        modifiedCount: result.modifiedCount,
        scores: stored.map((document) => document.score),
      },
      { modifiedCount: 2, scores: [1, 1] },
    );
  } finally {
    await database.close();
  }
});

void test('update: mutating options during the pending scan cannot enable upsert', async () => {
  const database = new Database();
  try {
    const collection = database.collection<Doc>('docs');
    const options = { upsert: false };

    const pending = collection.update(
      { _id: 'missing' },
      { $set: { score: 1 } },
      options,
    );
    options.upsert = true;
    const result = await pending;

    assert.deepEqual(
      { result, count: await collection.count() },
      {
        result: { modifiedCount: 0, upsertedId: null },
        count: 0,
      },
    );
  } finally {
    await database.close();
  }
});

void test('update: successful upsert reuses operations and options captured before the first await', async () => {
  const database = new Database();
  try {
    const collection = database.collection<Doc>('docs');
    let callReturned = false;
    let operationReads = 0;
    let optionReads = 0;
    const operations = {
      $set: {
        get score(): number {
          operationReads += 1;
          return callReturned ? 9 : 1;
        },
      },
    };
    const options = {
      get upsert(): boolean {
        optionReads += 1;
        return !callReturned;
      },
    };

    const pending = collection.update({ _id: 'upserted' }, operations, options);
    assert.deepEqual(
      { operationReads, optionReads },
      { operationReads: 1, optionReads: 1 },
    );
    callReturned = true;
    const result = await pending;
    const stored = await collection.findOne({ _id: 'upserted' });

    assert.deepEqual(
      { result, operationReads, optionReads, score: stored?.score },
      {
        result: { modifiedCount: 0, upsertedId: 'upserted' },
        operationReads: 1,
        optionReads: 1,
        score: 1,
      },
    );
  } finally {
    await database.close();
  }
});

void test('update: a $pull comparison getter is snapshotted before evaluation', async () => {
  class PullOperand {
    public kind = '';

    public constructor(readKind: () => string) {
      Object.defineProperty(this, 'kind', {
        configurable: true,
        enumerable: true,
        get: readKind,
      });
    }
  }

  const database = new Database();
  try {
    const collection = database.collection<Doc>('docs');
    await collection.insert({
      _id: 'd1',
      tags: [{ kind: 'drop' }, { kind: 'keep' }],
    });

    let reads = 0;
    const operand = new PullOperand((): string => {
      reads += 1;
      return reads === 1 ? 'drop' : 'keep';
    });

    const result = await collection.update(
      { _id: 'd1' },
      { $pull: { tags: operand } },
    );
    const stored = await collection.findOne({ _id: 'd1' });

    assert.deepEqual(
      { reads, modifiedCount: result.modifiedCount, tags: stored?.tags },
      { reads: 1, modifiedCount: 1, tags: [{ kind: 'keep' }] },
    );
  } finally {
    await database.close();
  }
});

// --- Filters ---------------------------------------------------------------

void test('remove: an $and getter cannot widen the filter after it was validated', async () => {
  const database = new Database();
  const collection = database.collection<Doc>('docs');
  await collection.insert({ _id: 'keep', name: 'keep' });
  await collection.insert({ _id: 'drop', name: 'drop' });

  let reads = 0;
  const filter = {
    get $and(): unknown {
      reads += 1;
      // The validator reads the narrow filter; the evaluator used to re-read the
      // getter per candidate document and got a match-anything one instead.
      return reads === 1 ? [{ _id: 'drop' }] : [{}];
    },
  };

  assert.equal(await collection.remove(filter), 1);
  assert.deepEqual(await collection.ids(), ['keep']);
  await database.close();
});

void test('find: a filter getter cannot answer the evaluator differently per document', async () => {
  const database = new Database();
  const collection = database.collection<Doc>('docs');
  await collection.insert({ _id: 'd1', name: 'a' });
  await collection.insert({ _id: 'd2', name: 'b' });

  let reads = 0;
  const filter = {
    get name(): unknown {
      reads += 1;
      return reads === 1 ? 'a' : 'b';
    },
  };

  const found = await collection.find(filter).toArray();

  assert.deepEqual(
    found.map((doc) => doc._id),
    ['d1'],
  );
  await database.close();
});

void test('find: a root Proxy cannot change its plain-object classification after entry', async () => {
  const database = new Database();
  try {
    const collection = database.collection<Doc>('docs');
    await collection.insert({ _id: 'd1', name: 'drop' });
    await collection.insert({ _id: 'd2', name: 'keep' });

    let prototypeReads = 0;
    let nameReads = 0;
    const nonPlainPrototype = { marker: true };
    const filter = new Proxy(
      { name: 'unused' },
      {
        getPrototypeOf(_target: { name: string }): object | null {
          prototypeReads += 1;
          return prototypeReads === 1 ? Object.prototype : nonPlainPrototype;
        },
        get(target: { name: string }, property: string | symbol): unknown {
          if (property === 'name') {
            nameReads += 1;
            return nameReads === 1 ? 'drop' : 'keep';
          }
          return Reflect.get(target, property);
        },
      },
    );

    const found = await collection.find(filter).toArray();

    assert.deepEqual(
      {
        prototypeReads,
        nameReads,
        ids: found.map((document) => document._id),
      },
      { prototypeReads: 1, nameReads: 1, ids: ['d1'] },
    );
  } finally {
    await database.close();
  }
});

void test('find: a nested class-instance equality operand is captured recursively', async () => {
  class ComparisonOperand {
    public readonly details: Record<string, unknown>;

    public constructor(readKind: () => string) {
      this.details = {};
      Object.defineProperty(this.details, 'kind', {
        configurable: true,
        enumerable: true,
        get: readKind,
      });
    }
  }

  const database = new Database();
  try {
    const collection = database.collection<Doc>('docs');
    await collection.insert({
      _id: 'd1',
      name: { details: { kind: 'drop' } },
    });
    await collection.insert({
      _id: 'd2',
      name: { details: { kind: 'keep' } },
    });

    let reads = 0;
    const operand = new ComparisonOperand((): string => {
      reads += 1;
      return reads === 1 ? 'drop' : 'keep';
    });
    const found = await collection.find({ name: { $eq: operand } }).toArray();

    assert.deepEqual(
      { reads, ids: found.map((document) => document._id) },
      { reads: 1, ids: ['d1'] },
    );
  } finally {
    await database.close();
  }
});

void test('find: a RegExp equality operand retains a detached enumerable shape', async () => {
  const database = new Database();
  try {
    const collection = database.collection<Doc>('docs');
    await collection.insert({ _id: 'd1', name: { kind: 'drop' } });
    await collection.insert({ _id: 'd2', name: { kind: 'keep' } });

    let reads = 0;
    const operand = /not-used-for-equality/;
    Object.defineProperty(operand, 'kind', {
      configurable: true,
      enumerable: true,
      get(): string {
        reads += 1;
        return reads === 1 ? 'drop' : 'keep';
      },
    });

    const found = await collection.find({ name: { $eq: operand } }).toArray();

    assert.deepEqual(
      { reads, ids: found.map((document) => document._id) },
      { reads: 1, ids: ['d1'] },
    );
  } finally {
    await database.close();
  }
});

void test('find: RegExp source and flags are each captured once at entry', async () => {
  const database = new Database();
  try {
    const collection = database.collection<Doc>('docs');
    await collection.insert({ _id: 'd1', name: 'alpha' });
    await collection.insert({ _id: 'd2', name: 'beta' });

    const pattern = /^al/;
    let source = '^al';
    let flags = '';
    let sourceReads = 0;
    let flagsReads = 0;
    Object.defineProperty(pattern, 'source', {
      configurable: true,
      get(): string {
        sourceReads += 1;
        return source;
      },
    });
    Object.defineProperty(pattern, 'flags', {
      configurable: true,
      get(): string {
        flagsReads += 1;
        return flags;
      },
    });
    const chain = collection.find({ name: { $regex: pattern } });
    source = '^be';
    flags = 'i';
    const found = await chain.toArray();

    assert.deepEqual(
      {
        sourceReads,
        flagsReads,
        ids: found.map((document) => document._id),
      },
      { sourceReads: 1, flagsReads: 1, ids: ['d1'] },
    );
  } finally {
    await database.close();
  }
});

void test('remove: mutating an _id $in operand during the await cannot widen the deletion', async () => {
  const database = new Database();
  const collection = database.collection<Doc>('docs');
  await collection.insert({ _id: 'a' });
  await collection.insert({ _id: 'b' });

  const removedIds: string[] = [];
  collection.watch((event) => {
    if (event.type === 'remove') removedIds.push(event.documentId);
  });

  const operand = ['a'];
  const pending = collection.remove({ _id: { $in: operand } });
  // The fast path reads the operand on both sides of an `await`; the extra id
  // used to be deleted anyway — past the validated length cap, and with no
  // watch() event, because it was absent from the candidate read.
  operand.push('b');
  const removed = await pending;

  assert.equal(removed, 1);
  assert.deepEqual(await collection.ids(), ['b']);
  assert.deepEqual(removedIds, ['a']);
  await database.close();
});

void test('filter snapshot rejects a cyclic filter with ValidationError', async () => {
  const database = new Database();
  const collection = database.collection<Doc>('docs');

  const filter: Record<string, unknown> = {};
  filter.$and = [filter];

  await assert.rejects(() => collection.remove(filter), ValidationError);
  await database.close();
});

void test('filter snapshot detaches a Date comparison operand by timestamp', () => {
  const operand = new Date(1_000);
  const snapshot = snapshotFilter({ name: { $eq: operand } });
  operand.setTime(2_000);
  const condition = snapshot.name as Record<string, unknown>;
  const captured = condition.$eq;

  assert.deepEqual(
    {
      sameReference: captured === operand,
      timestamp: captured instanceof Date ? captured.getTime() : null,
    },
    { sameReference: false, timestamp: 1_000 },
  );
});

void test('filter snapshot preserves RegExp operands', async () => {
  const database = new Database();
  const collection = database.collection<Doc>('docs');
  await collection.insert({ _id: 'd1', name: 'alpha' });
  await collection.insert({ _id: 'd2', name: 'beta' });

  const found = await collection.find({ name: { $regex: /^al/ } }).toArray();

  assert.deepEqual(
    found.map((doc) => doc._id),
    ['d1'],
  );
  await database.close();
});
