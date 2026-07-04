import { spawnSync } from 'node:child_process';

const tscResult = spawnSync(
  'pnpm',
  ['exec', 'tsc', '--project', 'tsconfig.bench.json'],
  {
    stdio: 'inherit',
  },
);
if (tscResult.status !== 0) {
  process.exit(tscResult.status ?? 1);
}

const benchResult = spawnSync(
  'node',
  ['.tmp-bench-dist/scripts/benchmarks/index.js'],
  {
    stdio: 'inherit',
  },
);
process.exit(benchResult.status ?? 1);
