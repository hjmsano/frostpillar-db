import { Database } from '../../../src/core.js';
import type { Collection } from '../../../src/core.js';
import { measure, generateDocument, VOLUMES } from '../helpers.js';
import type { BenchmarkResult } from '../helpers.js';

const seedCollection = async (
  db: Database,
  volume: number,
): Promise<Collection> => {
  const col = db.collection('bench');
  const docs = Array.from({ length: volume }, (_, i) => generateDocument(i));
  await col.insertMany(docs);
  return col;
};

const runReadBenchmarks = async (
  volume: number,
): Promise<BenchmarkResult[]> => {
  const results: BenchmarkResult[] = [];

  results.push(
    await measure('find (full scan)', volume, async () => {
      const db = new Database();
      const col = await seedCollection(db, volume);
      await col.find().toArray();
      await db.close();
    }),
  );

  results.push(
    await measure('find (filtered)', volume, async () => {
      const db = new Database();
      const col = await seedCollection(db, volume);
      await col.find({ category: 'A' }).toArray();
      await db.close();
    }),
  );

  results.push(
    await measure('find + sort', volume, async () => {
      const db = new Database();
      const col = await seedCollection(db, volume);
      await col.find().sort({ score: 1 }).toArray();
      await db.close();
    }),
  );

  results.push(
    await measure('find + sort + limit', volume, async () => {
      const db = new Database();
      const col = await seedCollection(db, volume);
      await col.find().sort({ score: -1 }).limit(10).toArray();
      await db.close();
    }),
  );

  return results;
};

const runWriteBenchmarks = async (
  volume: number,
): Promise<BenchmarkResult[]> => {
  const results: BenchmarkResult[] = [];

  results.push(
    await measure('update', volume, async () => {
      const db = new Database();
      const col = await seedCollection(db, volume);
      await col.update({ category: 'A' }, { $set: { active: false } });
      await db.close();
    }),
  );

  results.push(
    await measure('remove (filtered)', volume, async () => {
      const db = new Database();
      const col = await seedCollection(db, volume);
      await col.remove({ category: 'B' });
      await db.close();
    }),
  );

  results.push(
    await measure('count', volume, async () => {
      const db = new Database();
      const col = await seedCollection(db, volume);
      await col.count();
      await db.close();
    }),
  );

  results.push(
    await measure('count (filtered)', volume, async () => {
      const db = new Database();
      const col = await seedCollection(db, volume);
      await col.count({ active: true });
      await db.close();
    }),
  );

  return results;
};

const runForVolume = async (volume: number): Promise<BenchmarkResult[]> => {
  const readResults = await runReadBenchmarks(volume);
  const writeResults = await runWriteBenchmarks(volume);
  return [...readResults, ...writeResults];
};

export const run = async (): Promise<BenchmarkResult[]> => {
  const results: BenchmarkResult[] = [];

  for (const volume of VOLUMES) {
    results.push(...(await runForVolume(volume)));
  }

  return results;
};
