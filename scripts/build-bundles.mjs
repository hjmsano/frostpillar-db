import { access, mkdir, rm, writeFile } from 'node:fs/promises';
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

const loadEsbuildBuild = async () => {
  try {
    const esbuild = await import('esbuild');
    return esbuild.build;
  } catch {
    throw new Error(
      'Bundle build requires "esbuild". Please run `pnpm add -D esbuild`.',
    );
  }
};

const writeCoreProfileTypeEntryFile = async (profileRoot) => {
  const typeEntryPath = path.join(profileRoot, 'frostpillar-core.d.ts');

  const typesSource = [
    "export * from '../../core/index.js';",
    '',
  ].join('\n');

  await writeFile(typeEntryPath, typesSource, 'utf8');

  return {
    typeEntryPath,
  };
};

const buildCoreRuntimeBundle = async (profileRoot) => {
  const runtimeEntryPath = path.join(profileRoot, 'frostpillar-core.min.js');
  const temporaryDirectory = path.join(profileRoot, '.bundle-temp');
  const temporaryEntryPath = path.join(temporaryDirectory, 'entry.js');
  const fileBackendControllerStubPath = path.join(
    temporaryDirectory,
    'fileBackendController.browser.js',
  );
  const datastoreConfigStubPath = path.join(
    temporaryDirectory,
    'config.browser.js',
  );
  const entrySource = ["export * from '../../../core/index.js';", ''].join('\n');
  const fileBackendControllerStubSource = [
    "import { UnsupportedBackendError } from '../../../core/errors/index.js';",
    '',
    'export class FileBackendController {',
    '  static create() {',
    '    throw new UnsupportedBackendError(',
    `      'Backend "file" is not available in browser bundle profile "${CORE_PROFILE_NAME}".',`,
    '    );',
    '  }',
    '',
    '  async handleRecordAppended() {}',
    '',
    '  async commitNow() {}',
    '',
    '  async close() {}',
    '}',
    '',
  ].join('\n');
  const datastoreConfigStubSource = [
    "import { ConfigurationError, UnsupportedBackendError } from '../../../core/errors/index.js';",
    '',
    'const normalizeByteSizeInput = (value) => {',
    "  if (typeof value === 'number') {",
    '    if (!Number.isSafeInteger(value) || value <= 0) {',
    "      throw new ConfigurationError('capacity.maxSize must be a positive safe integer.');",
    '    }',
    '    return value;',
    '  }',
    '',
    "  const matched = /^(\\d+)(B|KB|MB|GB)$/.exec(value);",
    '  if (matched === null) {',
    "    throw new ConfigurationError('capacity.maxSize string must be <positive><B|KB|MB|GB>.');",
    '  }',
    '',
    '  const amount = Number(matched[1]);',
    '  if (!Number.isSafeInteger(amount) || amount <= 0) {',
    "    throw new ConfigurationError('capacity.maxSize must be positive.');",
    '  }',
    '',
    '  const multiplierByUnit = {',
    '    B: 1,',
    '    KB: 1024,',
    '    MB: 1024 * 1024,',
    '    GB: 1024 * 1024 * 1024,',
    '  };',
    '  const multiplier = multiplierByUnit[matched[2]];',
    '  const total = amount * multiplier;',
    '  if (!Number.isSafeInteger(total) || total <= 0) {',
    "    throw new ConfigurationError('capacity.maxSize exceeds safe integer range.');",
    '  }',
    '',
    '  return total;',
    '};',
    '',
    'export const parseCapacityConfig = (capacity) => {',
    '  if (capacity === undefined) {',
    '    return null;',
    '  }',
    '',
    '  const maxSizeBytes = normalizeByteSizeInput(capacity.maxSize);',
    "  const policy = capacity.policy ?? 'strict';",
    "  if (policy !== 'strict' && policy !== 'turnover') {",
    "    throw new ConfigurationError('capacity.policy must be \"strict\" or \"turnover\".');",
    '  }',
    '',
    '  return { maxSizeBytes, policy };',
    '};',
    '',
    'export const parseFileAutoCommitConfig = (autoCommit) => {',
    "  if (autoCommit?.maxPendingBytes !== undefined) {",
    '    if (!Number.isSafeInteger(autoCommit.maxPendingBytes) || autoCommit.maxPendingBytes <= 0) {',
    "      throw new ConfigurationError('autoCommit.maxPendingBytes must be a positive safe integer.');",
    '    }',
    '  }',
    '',
    "  const frequency = autoCommit?.frequency;",
    "  if (frequency === undefined || frequency === 'immediate') {",
    '    return {',
    "      frequency: 'immediate',",
    '      intervalMs: null,',
    '      maxPendingBytes: autoCommit?.maxPendingBytes ?? null,',
    '    };',
    '  }',
    '',
    "  if (typeof frequency === 'number') {",
    '    if (!Number.isSafeInteger(frequency) || frequency <= 0) {',
    "      throw new ConfigurationError('autoCommit.frequency number must be a positive safe integer.');",
    '    }',
    '',
    '    return {',
    "      frequency: 'scheduled',",
    '      intervalMs: frequency,',
    '      maxPendingBytes: autoCommit?.maxPendingBytes ?? null,',
    '    };',
    '  }',
    '',
    "  const matched = /^(\\d+)(ms|s|m|h)$/.exec(frequency);",
    '  if (matched === null) {',
    "    throw new ConfigurationError('autoCommit.frequency string must be one of: <positive>ms, <positive>s, <positive>m, <positive>h.');",
    '  }',
    '',
    '  const amount = Number(matched[1]);',
    '  if (!Number.isSafeInteger(amount) || amount <= 0) {',
    "    throw new ConfigurationError('autoCommit.frequency string amount must be a positive safe integer.');",
    '  }',
    '',
    '  const multiplierByUnit = {',
    '    ms: 1,',
    '    s: 1000,',
    '    m: 60 * 1000,',
    '    h: 60 * 60 * 1000,',
    '  };',
    '  const intervalMs = amount * multiplierByUnit[matched[2]];',
    '',
    '  if (!Number.isSafeInteger(intervalMs) || intervalMs <= 0) {',
    "    throw new ConfigurationError('autoCommit.frequency exceeds safe integer range.');",
    '  }',
    '',
    '  return {',
    "    frequency: 'scheduled',",
    '    intervalMs,',
    '    maxPendingBytes: autoCommit?.maxPendingBytes ?? null,',
    '  };',
    '};',
    '',
    'export const ensureCanonicalPathWithinWorkingDirectory = () => {',
    '  throw new UnsupportedBackendError(',
    "    'Path canonicalization is unavailable in browser bundle profile \"core\".',",
    '  );',
    '};',
    '',
    'export const resolveFileDataPath = () => {',
    '  throw new UnsupportedBackendError(',
    "    'File backend path resolution is unavailable in browser bundle profile \"core\".',",
    '  );',
    '};',
    '',
  ].join('\n');
  const build = await loadEsbuildBuild();

  await mkdir(temporaryDirectory, { recursive: true });
  await writeFile(temporaryEntryPath, entrySource, 'utf8');
  await writeFile(fileBackendControllerStubPath, fileBackendControllerStubSource, 'utf8');
  await writeFile(datastoreConfigStubPath, datastoreConfigStubSource, 'utf8');

  try {
    await build({
      bundle: true,
      entryPoints: [temporaryEntryPath],
      format: 'iife',
      globalName: 'Frostpillar',
      legalComments: 'none',
      minify: true,
      outfile: runtimeEntryPath,
      platform: 'browser',
      plugins: [
        {
          name: 'frostpillar-browser-bundle-stubs',
          setup(buildContext) {
            buildContext.onResolve(
              { filter: /fileBackendController\.js$/ },
              (args) => {
                if (args.path.endsWith('fileBackendController.js')) {
                  return { path: fileBackendControllerStubPath };
                }
                return null;
              },
            );

            buildContext.onResolve({ filter: /config\.js$/ }, (args) => {
              if (
                args.path === './config.js' &&
                args.importer.includes('/dist/core/datastore/')
              ) {
                return { path: datastoreConfigStubPath };
              }
              return null;
            });
          },
        },
      ],
      target: ['es2020'],
    });
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }

  return {
    runtimeEntryPath,
  };
};

export const buildBundleArtifacts = async (options = {}) => {
  const cwd =
    typeof options.cwd === 'string' ? path.resolve(options.cwd) : process.cwd();
  const bundleRootDirectory = path.resolve(cwd, 'dist/bundles');
  const coreProfileDirectory = path.resolve(bundleRootDirectory, CORE_PROFILE_NAME);

  await Promise.all(
    REQUIRED_INPUT_FILES.map(async (relativePath) => {
      await ensureFileExists(path.resolve(cwd, relativePath), relativePath);
    }),
  );

  await rm(bundleRootDirectory, { recursive: true, force: true });
  await mkdir(coreProfileDirectory, { recursive: true });

  const { runtimeEntryPath } = await buildCoreRuntimeBundle(coreProfileDirectory);
  const { typeEntryPath } = await writeCoreProfileTypeEntryFile(coreProfileDirectory);

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
