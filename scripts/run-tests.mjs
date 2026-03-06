import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

const DEFAULT_TEST_GLOB = 'tests/**/*.test.mjs';

export const normalizeNodeTestArgs = (args) => {
  if (args.length === 0) {
    return [DEFAULT_TEST_GLOB];
  }

  if (args[0] === '--run') {
    return args.length > 1 ? args.slice(1) : [DEFAULT_TEST_GLOB];
  }

  return args;
};

const run = () => {
  const normalizedArgs = normalizeNodeTestArgs(process.argv.slice(2));
  const result = spawnSync(
    process.execPath,
    ['--test', ...normalizedArgs],
    { stdio: 'inherit' },
  );

  if (result.error) {
    throw result.error;
  }

  if (typeof result.status === 'number') {
    process.exit(result.status);
  }

  process.exit(1);
};

const isMainModule =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainModule) {
  run();
}
