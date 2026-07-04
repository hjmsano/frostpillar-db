import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const withCoverage = args.includes('--coverage');

const tscResult = spawnSync(
  'pnpm',
  ['exec', 'tsc', '--project', 'tsconfig.test.json'],
  {
    stdio: 'inherit',
  },
);
if (tscResult.status !== 0) {
  process.exit(tscResult.status ?? 1);
}

const testArgs = ['--test'];
if (withCoverage) {
  testArgs.push('--experimental-test-coverage');
}
testArgs.push('.tmp-test-dist/tests/**/*.test.js');

const testResult = spawnSync('node', testArgs, {
  stdio: 'inherit',
});
process.exit(testResult.status ?? 1);
