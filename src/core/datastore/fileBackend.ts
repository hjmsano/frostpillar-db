import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  unlinkSync,
} from 'node:fs';
import { basename, dirname, join } from 'node:path';
import {
  DatabaseLockedError,
  StorageEngineError,
} from '../errors/index.js';
import type { FileDatastoreConfig } from '../types.js';
import { resolveFileDataPath } from './config.js';
import type { FileBackendState } from './types.js';

type NodeErrorWithCode = Error & { code?: string };

const toNodeErrorCode = (error: unknown): string | undefined => {
  if (error instanceof Error) {
    const nodeError = error as NodeErrorWithCode;
    return nodeError.code;
  }

  return undefined;
};

const throwStorageError = (message: string, error: unknown): never => {
  if (error instanceof StorageEngineError) {
    throw error;
  }

  if (error instanceof Error) {
    throw new StorageEngineError(`${message}: ${error.message}`);
  }

  throw new StorageEngineError(message);
};

const acquireFileLock = (lockPath: string): void => {
  try {
    const descriptor = openSync(lockPath, 'wx');
    closeSync(descriptor);
  } catch (error) {
    const code = toNodeErrorCode(error);
    if (code === 'EEXIST') {
      throw new DatabaseLockedError(
        `Datastore is locked by another process: ${lockPath}`,
      );
    }

    throwStorageError(`Failed to acquire file lock at ${lockPath}`, error);
  }
};

const cleanupFileTempArtifacts = (backend: FileBackendState): void => {
  try {
    const sidecarTempPath = `${backend.sidecarPath}.tmp`;
    if (existsSync(sidecarTempPath)) {
      unlinkSync(sidecarTempPath);
    }

    const entries = readdirSync(backend.directoryPath);
    const generationPrefix = `${backend.baseFileName}.g.`;
    for (const entry of entries) {
      if (entry.startsWith(generationPrefix) && entry.endsWith('.tmp')) {
        unlinkSync(join(backend.directoryPath, entry));
      }
    }
  } catch (error) {
    throwStorageError('Failed to cleanup temporary durability artifacts', error);
  }
};

export const createFileBackend = (config: FileDatastoreConfig): FileBackendState => {
  const dataFilePath = resolveFileDataPath(config);
  const directoryPath = dirname(dataFilePath);
  const baseFileName = basename(dataFilePath);
  const sidecarPath = `${dataFilePath}.meta.json`;
  const lockPath = `${dataFilePath}.lock`;

  mkdirSync(directoryPath, { recursive: true });
  acquireFileLock(lockPath);

  const backend: FileBackendState = {
    dataFilePath,
    directoryPath,
    baseFileName,
    sidecarPath,
    lockPath,
    activeDataFile: `${baseFileName}.g.0`,
    commitId: 0,
    rootPageId: 1,
    nextPageId: 2,
    freePageHeadId: null,
    lockAcquired: true,
  };

  cleanupFileTempArtifacts(backend);
  return backend;
};

export const releaseFileLock = (backend: FileBackendState): void => {
  try {
    if (existsSync(backend.lockPath)) {
      unlinkSync(backend.lockPath);
    }
    backend.lockAcquired = false;
  } catch (error) {
    throwStorageError('Failed to release file lock during close()', error);
  }
};
