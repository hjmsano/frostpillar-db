import { printResults } from './helpers.js';
import type { BenchmarkResult } from './helpers.js';
import { run as runInsert } from './scenarios/insert.bench.js';
import { run as runQuery } from './scenarios/query.bench.js';
import { run as runAggregation } from './scenarios/aggregation.bench.js';
import { run as runUpsert } from './scenarios/upsert.bench.js';
import { run as runFilterInCache } from './scenarios/filter-in-cache.bench.js';
const suites = [
  { name: 'Insert', run: runInsert },
  { name: 'Query', run: runQuery },
  { name: 'Upsert', run: runUpsert },
  { name: 'Aggregation', run: runAggregation },
  { name: 'Filter $in Cache', run: runFilterInCache },
];

const main = async (): Promise<void> => {
  console.log('=== Frostpillar-DB Benchmarks ===');
  console.log(`Node.js ${process.version}`);
  console.log(`Date: ${new Date().toISOString()}`);

  const allResults: BenchmarkResult[] = [];

  for (const suite of suites) {
    console.log(`\n--- ${suite.name} ---`);
    const results = await suite.run();
    allResults.push(...results);
    printResults(results);
  }

  console.log('\n=== Summary (all scenarios) ===');
  printResults(allResults);
};

main().catch((error: unknown) => {
  console.error('Benchmark failed:', error);
  process.exit(1);
});
