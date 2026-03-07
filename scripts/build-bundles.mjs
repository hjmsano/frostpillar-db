import { access, copyFile, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

const CORE_PROFILE_NAME = 'core';

const REQUIRED_INPUT_FILES = [
  'dist/core/index.js',
  'dist/core/index.d.ts',
  'dist/queryEngine/runQueryWithEngine.js',
  'dist/queryEngine/runQueryWithEngine.d.ts',
];

const PROFILE_MATRIX = [
  {
    name: CORE_PROFILE_NAME,
    availability: 'published',
    backends: ['memory'],
    note: 'Published baseline bundle with browser-safe core/query modules.',
  },
  {
    name: 'core-indexeddb',
    availability: 'planned',
    backends: [],
    note: 'Reserved for IndexedDB adapter once runtime-slice support is accepted.',
  },
  {
    name: 'core-opfs',
    availability: 'planned',
    backends: [],
    note: 'Reserved for OPFS adapter once runtime-slice support is accepted.',
  },
  {
    name: 'core-localstorage',
    availability: 'planned',
    backends: [],
    note: 'Reserved for localStorage adapter once runtime-slice support is accepted.',
  },
  {
    name: 'full-browser',
    availability: 'planned',
    backends: [],
    note: 'Reserved for all browser adapters after runtime-slice support expansion.',
  },
];

const ensureFileExists = async (absolutePath, relativePathForMessage) => {
  try {
    await access(absolutePath);
  } catch {
    throw new Error(
      `Bundle build requires "${relativePathForMessage}" but it was not found. Please run \`pnpm build\` first.`,
    );
  }
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

const writeCoreProfileEntryFiles = async (profileRoot) => {
  const runtimeEntryPath = path.join(profileRoot, 'frostpillar-core.js');
  const typeEntryPath = path.join(profileRoot, 'frostpillar-core.d.ts');

  const runtimeSource = [
    "export * from './core/index.js';",
    "export * from './queryEngine/runQueryWithEngine.js';",
    '',
  ].join('\n');

  const typesSource = [
    "export * from './core/index.js';",
    "export * from './queryEngine/runQueryWithEngine.js';",
    '',
  ].join('\n');

  await writeFile(runtimeEntryPath, runtimeSource, 'utf8');
  await writeFile(typeEntryPath, typesSource, 'utf8');

  return {
    runtimeEntryPath,
    typeEntryPath,
  };
};

export const buildBundleArtifacts = async (options = {}) => {
  const cwd =
    typeof options.cwd === 'string' ? path.resolve(options.cwd) : process.cwd();
  const distDirectory = path.resolve(cwd, 'dist');
  const bundleRootDirectory = path.resolve(cwd, 'dist/bundles');
  const coreProfileDirectory = path.resolve(bundleRootDirectory, CORE_PROFILE_NAME);

  await Promise.all(
    REQUIRED_INPUT_FILES.map(async (relativePath) => {
      await ensureFileExists(path.resolve(cwd, relativePath), relativePath);
    }),
  );

  await rm(bundleRootDirectory, { recursive: true, force: true });
  await mkdir(coreProfileDirectory, { recursive: true });

  await copyDirectoryRecursive(
    path.resolve(distDirectory, 'core'),
    path.resolve(coreProfileDirectory, 'core'),
  );
  await copyDirectoryRecursive(
    path.resolve(distDirectory, 'queryEngine'),
    path.resolve(coreProfileDirectory, 'queryEngine'),
  );

  const { runtimeEntryPath, typeEntryPath } = await writeCoreProfileEntryFiles(
    coreProfileDirectory,
  );

  const manifest = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    profiles: [
      {
        name: CORE_PROFILE_NAME,
        entry: path
          .relative(cwd, runtimeEntryPath)
          .split(path.sep)
          .join('/'),
        types: path.relative(cwd, typeEntryPath).split(path.sep).join('/'),
        includes: ['core', 'queryEngine'],
        supportedBackends: ['memory'],
      },
    ],
    profileMatrix: PROFILE_MATRIX,
  };

  const manifestPath = path.resolve(bundleRootDirectory, 'manifest.json');
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

  return {
    manifestPath,
    profileDirectories: [coreProfileDirectory],
  };
};

const main = async () => {
  const result = await buildBundleArtifacts();

  const output = [
    'Bundle artifacts generated successfully.',
    `manifest: ${result.manifestPath}`,
  ].join('\n');

  process.stdout.write(`${output}\n`);
};

const isMainModule =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainModule) {
  await main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exit(1);
  });
}
