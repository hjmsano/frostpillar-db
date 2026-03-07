import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import test from 'node:test';
import { loadCoreModule } from '../core/load-core-module.mjs';

const createSandboxDirectory = async (name) => {
  const baseDirectory = path.resolve(process.cwd(), 'tests/.tmp');
  await mkdir(baseDirectory, { recursive: true });
  const uniqueSuffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const sandboxDirectory = path.join(baseDirectory, `${name}-${uniqueSuffix}`);
  await mkdir(sandboxDirectory, { recursive: true });
  return sandboxDirectory;
};

const runCommand = (command, args, cwd) => {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      npm_config_cache: path.resolve(cwd, '.npm-cache'),
    },
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    const stdout = result.stdout ?? '';
    const stderr = result.stderr ?? '';
    throw new Error(
      `Command failed: ${command} ${args.join(' ')}\n${stdout}\n${stderr}`,
    );
  }

  return result.stdout ?? '';
};

const readJson = async (filePath) => {
  const source = await readFile(filePath, 'utf8');
  return JSON.parse(source);
};

const copyDirectoryRecursive = async (sourceDirectory, targetDirectory) => {
  await mkdir(targetDirectory, { recursive: true });
  const entries = await readdir(sourceDirectory, { withFileTypes: true });

  await Promise.all(
    entries.map(async (entry) => {
      const sourcePath = path.join(sourceDirectory, entry.name);
      const targetPath = path.join(targetDirectory, entry.name);

      if (entry.isDirectory()) {
        await copyDirectoryRecursive(sourcePath, targetPath);
        return;
      }

      if (entry.isFile()) {
        await copyFile(sourcePath, targetPath);
      }
    }),
  );
};

const createPackageFixture = async (targetDirectory) => {
  await Promise.all(
    ['package.json', 'README.md', 'LICENSE'].map(async (fileName) => {
      await copyFile(
        path.resolve(process.cwd(), fileName),
        path.resolve(targetDirectory, fileName),
      );
    }),
  );

  await copyDirectoryRecursive(
    path.resolve(process.cwd(), 'dist'),
    path.resolve(targetDirectory, 'dist'),
  );
};

test('package.json defines explicit npm export contract', async () => {
  const packageJsonPath = path.resolve(process.cwd(), 'package.json');
  const packageJson = await readJson(packageJsonPath);

  assert.equal(packageJson.name, 'frostpillar');
  assert.equal(packageJson.type, 'module');
  assert.equal(packageJson.exports['.'].default, './dist/core/index.js');
  assert.equal(packageJson.exports['.'].types, './dist/core/index.d.ts');
});

test('npm pack artifact installs cleanly and supports direct import smoke', async () => {
  await loadCoreModule();

  const sandbox = await createSandboxDirectory('npm-install-smoke');
  const packageFixture = path.resolve(sandbox, 'package');
  const consumerFixture = path.resolve(sandbox, 'consumer');

  try {
    await mkdir(packageFixture, { recursive: true });
    await createPackageFixture(packageFixture);

    const packOutput = runCommand('npm', ['pack', '--json'], packageFixture);
    const packedArtifacts = JSON.parse(packOutput);
    const packedArtifact = packedArtifacts[0];
    const tarballPath = path.resolve(packageFixture, packedArtifact.filename);
    const artifactFilePaths = packedArtifact.files.map((file) => file.path);

    assert.equal(artifactFilePaths.includes('dist/core/index.js'), true);
    assert.equal(artifactFilePaths.includes('dist/core/index.d.ts'), true);
    assert.equal(
      artifactFilePaths.includes('dist/queryEngine/runQueryWithEngine.js'),
      true,
    );
    assert.equal(
      artifactFilePaths.includes('dist/queryEngine/runQueryWithEngine.d.ts'),
      true,
    );

    await mkdir(consumerFixture, { recursive: true });
    await writeFile(
      path.resolve(consumerFixture, 'package.json'),
      JSON.stringify(
        {
          name: 'distribution-smoke-consumer',
          private: true,
          type: 'module',
        },
        null,
        2,
      ),
      'utf8',
    );

    runCommand(
      'npm',
      ['install', '--no-audit', '--no-fund', tarballPath],
      consumerFixture,
    );

    await writeFile(
      path.resolve(consumerFixture, 'smoke.mjs'),
      [
        "import assert from 'node:assert/strict';",
        "import { Datastore, runQueryWithEngine } from 'frostpillar';",
        "assert.equal(typeof Datastore, 'function');",
        "assert.equal(typeof runQueryWithEngine, 'function');",
        "const datastore = new Datastore({ location: 'memory' });",
        'await datastore.insert({ timestamp: 1, payload: { value: 10 } });',
        'const records = await datastore.select({ start: 1, end: 1 });',
        'assert.equal(records.length, 1);',
        'await datastore.close();',
        '',
      ].join('\n'),
      'utf8',
    );

    runCommand(process.execPath, ['smoke.mjs'], consumerFixture);
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});
