import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const coreDistModulePath = pathToFileURL(
  path.resolve(process.cwd(), 'dist/core/index.js'),
).href;

let buildPromise = null;

const ensureBuild = async () => {
  if (buildPromise !== null) {
    return await buildPromise;
  }

  buildPromise = Promise.resolve().then(() => {
    const tscCliPath = path.resolve(
      process.cwd(),
      'node_modules/typescript/bin/tsc',
    );
    const result = spawnSync(process.execPath, [tscCliPath, '--build'], {
      cwd: process.cwd(),
      encoding: 'utf8',
    });

    if (result.error) {
      throw result.error;
    }

    if (result.status !== 0) {
      const stdout = result.stdout ?? '';
      const stderr = result.stderr ?? '';
      throw new Error(
        `TypeScript build failed before core tests.\n${stdout}\n${stderr}`,
      );
    }
  });

  return await buildPromise;
};

export const loadCoreModule = async () => {
  await ensureBuild();
  return await import(coreDistModulePath);
};
