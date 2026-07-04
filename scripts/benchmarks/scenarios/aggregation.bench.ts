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

export const run = async (): Promise<BenchmarkResult[]> => {
  const results: BenchmarkResult[] = [];

  for (const volume of VOLUMES) {
    // sum
    results.push(
      await measure('sum', volume, async () => {
        const db = new Database();
        const col = await seedCollection(db, volume);
        await col.find().sum('score');
        await db.close();
      }),
    );

    // avg
    results.push(
      await measure('avg', volume, async () => {
        const db = new Database();
        const col = await seedCollection(db, volume);
        await col.find().avg('score');
        await db.close();
      }),
    );

    // min / max
    results.push(
      await measure('min + max', volume, async () => {
        const db = new Database();
        const col = await seedCollection(db, volume);
        await col.find().min('score');
        await col.find().max('score');
        await db.close();
      }),
    );

    // distinct
    results.push(
      await measure('distinct', volume, async () => {
        const db = new Database();
        const col = await seedCollection(db, volume);
        await col.find().distinct('category');
        await db.close();
      }),
    );

    // groupBy
    results.push(
      await measure('groupBy', volume, async () => {
        const db = new Database();
        const col = await seedCollection(db, volume);
        await col.find().groupBy('category', {
          totalScore: { $sum: 'score' },
          count: { $count: true },
        });
        await db.close();
      }),
    );
  }

  return results;
};
