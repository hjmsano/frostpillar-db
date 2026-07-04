import { Database } from '../../../src/core.js';
import { measure, generateDocument, VOLUMES } from '../helpers.js';
import type { BenchmarkResult, BenchmarkScenario } from '../helpers.js';

const insertSingle: BenchmarkScenario = {
  name: 'insert (single)',
  run: async (volume: number): Promise<void> => {
    const db = new Database();
    const col = db.collection('bench');
    for (let i = 0; i < volume; i++) {
      await col.insert(generateDocument(i));
    }
    await db.close();
  },
};

const insertMany: BenchmarkScenario = {
  name: 'insertMany (batch)',
  run: async (volume: number): Promise<void> => {
    const db = new Database();
    const col = db.collection('bench');
    const docs = Array.from({ length: volume }, (_, i) => generateDocument(i));
    await col.insertMany(docs);
    await db.close();
  },
};

export const run = async (): Promise<BenchmarkResult[]> => {
  const results: BenchmarkResult[] = [];

  for (const scenario of [insertSingle, insertMany]) {
    for (const volume of VOLUMES) {
      results.push(
        await measure(scenario.name, volume, () => scenario.run(volume)),
      );
    }
  }

  return results;
};
