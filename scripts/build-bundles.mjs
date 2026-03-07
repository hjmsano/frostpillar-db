import { access, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

const CORE_PROFILE_NAME = 'core';

const REQUIRED_INPUT_FILES = [
  'dist/core/index.js',
  'dist/core/index.d.ts',
  'dist/core/datastore/config.browser.js',
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
  const datastoreConfigBrowserModulePath = path.resolve(
    profileRoot,
    '../../core/datastore/config.browser.js',
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
  const build = await loadEsbuildBuild();

  await mkdir(temporaryDirectory, { recursive: true });
  await writeFile(temporaryEntryPath, entrySource, 'utf8');
  await writeFile(fileBackendControllerStubPath, fileBackendControllerStubSource, 'utf8');

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
                return { path: datastoreConfigBrowserModulePath };
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
