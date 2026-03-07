import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { loadCoreModule } from './load-core-module.mjs';

const loadTimeIndexModule = async () => {
  await loadCoreModule();
  const modulePath = pathToFileURL(
    path.resolve(process.cwd(), 'dist/core/datastore/timeIndexBTree.js'),
  ).href;
  return await import(modulePath);
};

const createRecord = (timestamp, insertionOrder) => {
  return {
    timestamp,
    payload: {
      id: `rec-${insertionOrder}`,
    },
    insertionOrder: BigInt(insertionOrder),
    encodedBytes: 1,
  };
};

const compareRecordByKey = (left, right) => {
  if (left.timestamp !== right.timestamp) {
    return left.timestamp - right.timestamp;
  }

  if (left.insertionOrder === right.insertionOrder) {
    return 0;
  }

  return left.insertionOrder < right.insertionOrder ? -1 : 1;
};

const createLcg = (seed) => {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state;
  };
};

test('time index keeps sorted order and invariants after split-heavy inserts', async () => {
  const { TimeIndexBTree } = await loadTimeIndexModule();
  const tree = new TimeIndexBTree({
    maxLeafEntries: 4,
    maxBranchChildren: 4,
  });

  const nextRand = createLcg(0x1234abcd);
  const inserted = [];
  for (let index = 0; index < 180; index += 1) {
    const timestamp = 1735689600000 + Number(nextRand() % 50);
    const record = createRecord(timestamp, index);
    inserted.push(record);
    tree.insert(record);

    if ((index + 1) % 17 === 0) {
      tree.assertInvariants();
    }
  }

  tree.assertInvariants();

  const rows = tree.rangeQuery(1735689600000, 1735689600049);
  const expected = [...inserted].sort(compareRecordByKey);

  assert.deepEqual(
    rows.map((row) => row.insertionOrder.toString(10)),
    expected.map((row) => row.insertionOrder.toString(10)),
  );

  const stats = tree.getStats();
  assert.ok(stats.height >= 2, 'expected split to increase tree height');
  assert.ok(stats.leafCount >= 2, 'expected multiple leaves after many inserts');
});

test('time index preserves invariants through repeated oldest-pop merge paths', async () => {
  const { TimeIndexBTree } = await loadTimeIndexModule();
  const tree = new TimeIndexBTree({
    maxLeafEntries: 4,
    maxBranchChildren: 4,
  });

  for (let index = 0; index < 96; index += 1) {
    const timestamp = 1735689600000 + Number(index % 8);
    tree.insert(createRecord(timestamp, index));
  }
  tree.assertInvariants();

  const before = tree.getStats();
  const evictedInsertionOrders = [];
  const logicalOrder = Array.from({ length: 96 }, (_unused, index) => {
    return createRecord(1735689600000 + Number(index % 8), index);
  }).sort(compareRecordByKey);

  for (let index = 0; index < 70; index += 1) {
    const popped = tree.popOldest();
    assert.ok(popped !== null, 'popOldest must return a record while non-empty');
    evictedInsertionOrders.push(Number(popped.insertionOrder));

    if ((index + 1) % 5 === 0) {
      tree.assertInvariants();
    }
  }

  tree.assertInvariants();

  assert.deepEqual(
    evictedInsertionOrders,
    logicalOrder
      .slice(0, 70)
      .map((row) => Number(row.insertionOrder)),
  );

  const remaining = tree.rangeQuery(1735689600000, 1735689600007);
  assert.deepEqual(
    remaining.map((row) => Number(row.insertionOrder)),
    logicalOrder
      .slice(70)
      .map((row) => Number(row.insertionOrder)),
  );

  const after = tree.getStats();
  assert.ok(after.height <= before.height);
});
