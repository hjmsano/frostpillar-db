import { Database } from '../../../src/core.js';
import { measure, generateDocument, VOLUMES } from '../helpers.js';
import type { BenchmarkResult } from '../helpers.js';

const runForVolume = async (volume: number): Promise<BenchmarkResult[]> => {
  const results: BenchmarkResult[] = [];

  results.push(
    await measure('upsert (update existing)', volume, async () => {
      const db = new Database();
      const col = db.collection('bench');
      const docs = Array.from({ length: volume }, (_, i) =>
        generateDocument(i),
      );
      const ids = await col.insertMany(docs);
      for (const id of ids) {
        await col.update(
          { _id: id },
          { $set: { active: false } },
          { upsert: true },
        );
      }
      await db.close();
    }),
  );

  results.push(
    await measure('upsert (insert new)', volume, async () => {
      const db = new Database();
      const col = db.collection('bench');
      for (let i = 0; i < volume; i++) {
        await col.update(
          { _id: `new_${String(i)}` },
          { $set: { age: 20 + (i % 50), category: 'X' } },
          { upsert: true },
        );
      }
      await db.close();
    }),
  );

  return results;
};

export const run = async (): Promise<BenchmarkResult[]> => {
  const results: BenchmarkResult[] = [];

  for (const volume of VOLUMES) {
    results.push(...(await runForVolume(volume)));
  }

  return results;
};
