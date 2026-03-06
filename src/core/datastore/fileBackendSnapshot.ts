import {
  existsSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import {
  PageCorruptionError,
  StorageEngineError,
} from '../errors/index.js';
import type { PersistedTimeseriesRecord } from '../types.js';
import {
  decodeSerializableRecord,
  parseUnsignedBigInt,
  toSerializableRecord,
} from './encoding.js';
import type {
  FileBackendState,
  FileGenerationSnapshot,
  FileSidecarSnapshot,
} from './types.js';

const SIDE_CAR_MAGIC = 'FPGE_META';
const GENERATION_MAGIC = 'FPGE_DATA';
const FORMAT_VERSION = 1;

interface LoadedFileSnapshot {
  currentSizeBytes: number;
  nextInsertionOrder: bigint;
  records: PersistedTimeseriesRecord[];
}

const throwStorageError = (message: string, error: unknown): never => {
  if (error instanceof StorageEngineError) {
    throw error;
  }

  if (error instanceof Error) {
    throw new StorageEngineError(`${message}: ${error.message}`);
  }

  throw new StorageEngineError(message);
};

const ensurePositiveSafeInteger = (value: unknown, field: string): number => {
  if (!Number.isSafeInteger(value) || typeof value !== 'number' || value < 0) {
    throw new PageCorruptionError(`${field} must be a non-negative safe integer.`);
  }

  return value;
};

const validateActiveDataFileName = (
  value: unknown,
  baseFileName: string,
): string => {
  if (typeof value !== 'string' || value.length === 0) {
    throw new PageCorruptionError(
      'sidecar.activeDataFile must be a non-empty string.',
    );
  }

  if (value.includes('/') || value.includes('\\')) {
    throw new PageCorruptionError(
      'sidecar.activeDataFile must be a file name without path separators.',
    );
  }

  const expectedPrefix = `${baseFileName}.g.`;
  if (!value.startsWith(expectedPrefix)) {
    throw new PageCorruptionError(
      'sidecar.activeDataFile must follow committed generation file naming.',
    );
  }

  const commitSuffix = value.slice(expectedPrefix.length);
  if (!/^\d+$/.test(commitSuffix)) {
    throw new PageCorruptionError(
      'sidecar.activeDataFile commit suffix must be an unsigned decimal integer.',
    );
  }

  return value;
};

export const writeInitialFileSnapshot = (
  backend: FileBackendState,
  nextInsertionOrder: bigint,
): void => {
  const generation: FileGenerationSnapshot = {
    magic: GENERATION_MAGIC,
    version: FORMAT_VERSION,
    rootPageId: backend.rootPageId,
    nextPageId: backend.nextPageId,
    freePageHeadId: backend.freePageHeadId,
    records: [],
  };
  const activeDataPath = join(backend.directoryPath, backend.activeDataFile);
  const sidecar: FileSidecarSnapshot = {
    magic: SIDE_CAR_MAGIC,
    version: FORMAT_VERSION,
    activeDataFile: backend.activeDataFile,
    rootPageId: backend.rootPageId,
    nextPageId: backend.nextPageId,
    freePageHeadId: backend.freePageHeadId,
    nextInsertionOrder: nextInsertionOrder.toString(10),
    commitId: backend.commitId,
  };

  try {
    writeFileSync(activeDataPath, JSON.stringify(generation), 'utf8');
    writeFileSync(backend.sidecarPath, JSON.stringify(sidecar, null, 2), 'utf8');
  } catch (error) {
    throwStorageError('Failed to initialize file backend snapshot', error);
  }
};

export const loadFileSnapshot = (backend: FileBackendState): LoadedFileSnapshot => {
  try {
    const sidecarSource = readFileSync(backend.sidecarPath, 'utf8');
    const parsedSidecar = JSON.parse(sidecarSource) as FileSidecarSnapshot;

    if (
      parsedSidecar.magic !== SIDE_CAR_MAGIC ||
      parsedSidecar.version !== FORMAT_VERSION
    ) {
      throw new PageCorruptionError('Invalid sidecar magic/version.');
    }

    backend.activeDataFile = validateActiveDataFileName(
      parsedSidecar.activeDataFile,
      backend.baseFileName,
    );
    backend.commitId = ensurePositiveSafeInteger(
      parsedSidecar.commitId,
      'sidecar.commitId',
    );
    backend.rootPageId = ensurePositiveSafeInteger(
      parsedSidecar.rootPageId,
      'sidecar.rootPageId',
    );
    backend.nextPageId = ensurePositiveSafeInteger(
      parsedSidecar.nextPageId,
      'sidecar.nextPageId',
    );
    if (
      parsedSidecar.freePageHeadId !== null &&
      !Number.isSafeInteger(parsedSidecar.freePageHeadId)
    ) {
      throw new PageCorruptionError(
        'sidecar.freePageHeadId must be null or safe integer.',
      );
    }
    backend.freePageHeadId = parsedSidecar.freePageHeadId;

    const nextInsertionOrder = parseUnsignedBigInt(
      parsedSidecar.nextInsertionOrder,
      'sidecar.nextInsertionOrder',
    );

    const activeDataPath = join(backend.directoryPath, backend.activeDataFile);
    if (!existsSync(activeDataPath)) {
      throw new PageCorruptionError(
        'Active generation file referenced by sidecar is missing.',
      );
    }

    const generationSource = readFileSync(activeDataPath, 'utf8');
    const parsedGeneration = JSON.parse(generationSource) as FileGenerationSnapshot;
    if (
      parsedGeneration.magic !== GENERATION_MAGIC ||
      parsedGeneration.version !== FORMAT_VERSION
    ) {
      throw new PageCorruptionError('Invalid generation magic/version.');
    }

    if (
      parsedGeneration.rootPageId !== backend.rootPageId ||
      parsedGeneration.nextPageId !== backend.nextPageId ||
      parsedGeneration.freePageHeadId !== backend.freePageHeadId
    ) {
      throw new PageCorruptionError(
        'Sidecar mirrored page metadata does not match active generation.',
      );
    }

    const records: PersistedTimeseriesRecord[] = [];
    let currentSizeBytes = 0;
    for (const serializedRecord of parsedGeneration.records) {
      const record = decodeSerializableRecord(serializedRecord);
      records.push(record);
      currentSizeBytes += record.encodedBytes;
    }

    return {
      records,
      currentSizeBytes,
      nextInsertionOrder,
    };
  } catch (error) {
    throw throwStorageError('Failed to load file backend snapshot', error);
  }
};

export const commitFileBackendSnapshot = (
  backend: FileBackendState,
  records: PersistedTimeseriesRecord[],
  nextInsertionOrder: bigint,
): void => {
  const nextCommitId = backend.commitId + 1;
  const nextActiveDataFile = `${backend.baseFileName}.g.${nextCommitId}`;
  const generationTempPath = join(
    backend.directoryPath,
    `${nextActiveDataFile}.tmp`,
  );
  const generationPath = join(backend.directoryPath, nextActiveDataFile);
  const sidecarTempPath = `${backend.sidecarPath}.tmp`;

  const generationSnapshot: FileGenerationSnapshot = {
    magic: GENERATION_MAGIC,
    version: FORMAT_VERSION,
    rootPageId: backend.rootPageId,
    nextPageId: backend.nextPageId,
    freePageHeadId: backend.freePageHeadId,
    records: records.map(toSerializableRecord),
  };
  const sidecarSnapshot: FileSidecarSnapshot = {
    magic: SIDE_CAR_MAGIC,
    version: FORMAT_VERSION,
    activeDataFile: nextActiveDataFile,
    rootPageId: backend.rootPageId,
    nextPageId: backend.nextPageId,
    freePageHeadId: backend.freePageHeadId,
    nextInsertionOrder: nextInsertionOrder.toString(10),
    commitId: nextCommitId,
  };

  try {
    writeFileSync(generationTempPath, JSON.stringify(generationSnapshot), 'utf8');
    renameSync(generationTempPath, generationPath);

    writeFileSync(sidecarTempPath, JSON.stringify(sidecarSnapshot, null, 2), 'utf8');
    renameSync(sidecarTempPath, backend.sidecarPath);

    backend.activeDataFile = nextActiveDataFile;
    backend.commitId = nextCommitId;
  } catch (error) {
    throwStorageError('File commit failed', error);
  }
};
