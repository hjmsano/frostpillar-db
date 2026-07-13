/**
 * Benchmark: $in/$nin filter cache (WeakMap<unknown[], Set<unknown>>)
 *
 * Simulates the "per-request filter" pattern: a new $in filter array is built
 * on every iteration and discarded after use. This exercises the WeakMap path
 * in filterOperatorEvaluators.ts::getInclusionSet.
 *
 * Run with --expose-gc to enable forced GC snapshots:
 *   node --expose-gc .tmp-bench-dist/scripts/benchmarks/scenarios/filter-in-cache.js
 */

import { Database } from '../../../src/core.js';
import type { Collection } from '../../../src/core.js';
import { measure } from '../helpers.js';
import type { BenchmarkResult } from '../helpers.js';

/** Build N unique string IDs */
const makeIds = (n: number): string[] =>
  Array.from({ length: n }, (_, i) => `id-${i}`);

const COLLECTION_SIZE = 200;
const IDS_PER_FILTER = 100;

/** Seed a small in-memory collection. */
const seedCollection = async (db: Database): Promise<Collection> => {
  const col = db.collection('bench-in');
  const docs = Array.from({ length: COLLECTION_SIZE }, (_, i) => ({
    _id: `id-${i}`,
    value: i,
  }));
  await col.insertMany(docs);
  return col;
};

const heapMB = (): number => process.memoryUsage().heapUsed / 1_048_576;

interface MemSnapshot {
  readonly beforeMB: number;
  readonly afterGcMB: number;
  readonly afterIterMB: number;
  readonly deltaAfterGcMB: number;
}

/**
 * Exercise N distinct $in filters against a small collection.
 * Each filter array is created inside the loop and not held after the iteration.
 */
const runPhase = async (
  col: Collection,
  filterCount: number,
): Promise<MemSnapshot> => {
  const forceGc = (): void => {
    if (typeof (globalThis as Record<string, unknown>).gc === 'function') {
      (globalThis as { gc: () => void }).gc();
    }
  };

  forceGc();
  const beforeMB = heapMB();

  for (let i = 0; i < filterCount; i++) {
    // Build a fresh array each iteration — simulates per-request $in filter.
    const ids = makeIds(IDS_PER_FILTER);
    await col.find({ _id: { $in: ids } }).toArray();
    // The call-owned snapshot goes out of scope here; its WeakMap entry becomes
    // eligible for GC. `ids` itself is not the cache key (ADR-030).
  }

  const afterIterMB = heapMB();
  forceGc();
  const afterGcMB = heapMB();

  return {
    beforeMB,
    afterGcMB,
    afterIterMB,
    deltaAfterGcMB: afterGcMB - beforeMB,
  };
};

/** Ops/sec benchmark using measure() helper (matches project convention). */
const runOpsBenchmark = async (
  col: Collection,
  filterCount: number,
): Promise<BenchmarkResult> => {
  return measure(
    `$in filter (fresh array, N=${filterCount})`,
    filterCount,
    async () => {
      for (let i = 0; i < filterCount; i++) {
        const ids = makeIds(IDS_PER_FILTER);
        await col.find({ _id: { $in: ids } }).toArray();
      }
    },
  );
};

export const run = async (): Promise<BenchmarkResult[]> => {
  const results: BenchmarkResult[] = [];

  console.log('\n--- $in filter cache memory analysis ---');
  console.log('(run with --expose-gc for accurate post-GC heap figures)\n');

  for (const filterCount of [10_000, 100_000]) {
    const db = new Database();
    const col = await seedCollection(db);

    const snap = await runPhase(col, filterCount);

    console.log(`  N=${filterCount}:`);
    console.log(`    heap before:         ${snap.beforeMB.toFixed(2)} MB`);
    console.log(`    heap after iters:    ${snap.afterIterMB.toFixed(2)} MB`);
    console.log(`    heap after GC:       ${snap.afterGcMB.toFixed(2)} MB`);
    console.log(
      `    delta (after GC):    ${snap.deltaAfterGcMB >= 0 ? '+' : ''}${snap.deltaAfterGcMB.toFixed(2)} MB`,
    );

    const opsResult = await runOpsBenchmark(col, filterCount);
    results.push(opsResult);

    await db.close();
  }

  return results;
};
