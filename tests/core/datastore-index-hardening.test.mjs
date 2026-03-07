import assert from 'node:assert/strict';
import test from 'node:test';
import { loadCoreModule } from './load-core-module.mjs';

const loadCore = async () => await loadCoreModule();

const createLcg = (seed) => {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state;
  };
};

test('select does not rely on Array.filter/sort full-scan path in M3 runtime', async () => {
  const { Datastore } = await loadCore();
  const datastore = new Datastore({ location: 'memory' });

  await datastore.insert({
    timestamp: 1735689600002,
    payload: { id: 'c' },
  });
  await datastore.insert({
    timestamp: 1735689600000,
    payload: { id: 'a' },
  });
  await datastore.insert({
    timestamp: 1735689600001,
    payload: { id: 'b' },
  });

  const originalFilter = Array.prototype.filter;
  const originalSort = Array.prototype.sort;
  Array.prototype.filter = function blockedFilter() {
    throw new Error('Unexpected full-scan Array.filter path.');
  };
  Array.prototype.sort = function blockedSort() {
    throw new Error('Unexpected full-scan Array.sort path.');
  };

  try {
    const rows = await datastore.select({
      start: 1735689600000,
      end: 1735689600002,
    });

    assert.deepEqual(
      rows.map((row) => row.payload.id),
      ['a', 'b', 'c'],
    );
  } finally {
    Array.prototype.filter = originalFilter;
    Array.prototype.sort = originalSort;
    await datastore.close();
  }
});

test('property-style deterministic stream keeps range-query order invariants', async () => {
  const { Datastore } = await loadCore();
  const datastore = new Datastore({ location: 'memory' });
  const nextRand = createLcg(0xdeadbeef);

  const expectedRecords = [];
  for (let index = 0; index < 320; index += 1) {
    const timestamp = 1735689600000 + Number(nextRand() % 80);
    const id = `r-${index}`;
    expectedRecords.push({
      timestamp,
      id,
      order: index,
    });

    await datastore.insert({
      timestamp,
      payload: { id },
    });
  }

  for (let round = 0; round < 24; round += 1) {
    let start = 1735689600000 + Number(nextRand() % 80);
    let end = 1735689600000 + Number(nextRand() % 80);

    if (start > end) {
      const swapped = start;
      start = end;
      end = swapped;
    }

    const expectedIds = expectedRecords
      .filter((item) => item.timestamp >= start && item.timestamp <= end)
      .sort((left, right) => {
        if (left.timestamp !== right.timestamp) {
          return left.timestamp - right.timestamp;
        }
        return left.order - right.order;
      })
      .map((item) => item.id);

    const rows = await datastore.select({ start, end });
    assert.deepEqual(
      rows.map((row) => row.payload.id),
      expectedIds,
    );
  }

  await datastore.close();
});
