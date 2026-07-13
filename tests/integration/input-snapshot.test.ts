// Spec 02 §12 / ADR-030: every caller-supplied input — insert payloads, update
// operands, filters — is read exactly once, into a snapshot the collection owns,
// and it is that snapshot which is validated, evaluated and stored.
//
// The hostile inputs below are fixtures for the time-of-check/time-of-use gap
// this closes: an accessor property (or a Proxy) answers each read differently,
// so validating the caller's object and then re-reading it to clone, evaluate or
// delete let the second read supply a value the first never saw. A plain array
// mutated across an `await` is the same defect without the getter.
import assert from 'node:assert/strict';
import test from 'node:test';

import { ValidationError } from '../../src/errors.js';
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
