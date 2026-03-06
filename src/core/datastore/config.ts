import { join, resolve } from 'node:path';
import { ConfigurationError } from '../errors/index.js';
import type {
  AutoCommitConfig,
  CapacityConfig,
  FileDatastoreConfig,
} from '../types.js';
import type { CapacityState, FileAutoCommitState } from './types.js';

const normalizeByteSizeInput = (value: CapacityConfig['maxSize']): number => {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new ConfigurationError(
        'capacity.maxSize must be a positive safe integer.',
      );
    }

    return value;
  }

  const matched = /^(\d+)(B|KB|MB|GB)$/.exec(value);
  if (matched === null) {
    throw new ConfigurationError(
      'capacity.maxSize string must be <positive><B|KB|MB|GB>.',
    );
  }

  const amount = Number(matched[1]);
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new ConfigurationError('capacity.maxSize must be positive.');
  }

  const unit = matched[2];
  const multiplierByUnit: Record<string, number> = {
    B: 1,
    KB: 1024,
    MB: 1024 * 1024,
    GB: 1024 * 1024 * 1024,
  };
  const multiplier = multiplierByUnit[unit];
  const total = amount * multiplier;

  if (!Number.isSafeInteger(total) || total <= 0) {
    throw new ConfigurationError('capacity.maxSize exceeds safe integer range.');
  }

  return total;
};

export const parseCapacityConfig = (
  capacity?: CapacityConfig,
): CapacityState | null => {
  if (capacity === undefined) {
    return null;
  }

  const maxSizeBytes = normalizeByteSizeInput(capacity.maxSize);
  const policy = capacity.policy ?? 'strict';
  if (policy !== 'strict' && policy !== 'turnover') {
    throw new ConfigurationError('capacity.policy must be "strict" or "turnover".');
  }

  return { maxSizeBytes, policy };
};

export const parseFileAutoCommitConfig = (
  autoCommit?: AutoCommitConfig,
): FileAutoCommitState => {
  if (autoCommit?.maxPendingBytes !== undefined) {
    if (
      !Number.isSafeInteger(autoCommit.maxPendingBytes) ||
      autoCommit.maxPendingBytes <= 0
    ) {
      throw new ConfigurationError(
        'autoCommit.maxPendingBytes must be a positive safe integer.',
      );
    }
  }

  const frequency = autoCommit?.frequency;
  if (frequency === undefined || frequency === 'immediate') {
    return {
      frequency: 'immediate',
      intervalMs: null,
      maxPendingBytes: autoCommit?.maxPendingBytes ?? null,
    };
  }

  if (typeof frequency === 'number') {
    if (!Number.isSafeInteger(frequency) || frequency <= 0) {
      throw new ConfigurationError(
        'autoCommit.frequency number must be a positive safe integer.',
      );
    }

    return {
      frequency: 'scheduled',
      intervalMs: frequency,
      maxPendingBytes: autoCommit?.maxPendingBytes ?? null,
    };
  }

  const matched = /^(\d+)(ms|s|m|h)$/.exec(frequency);
  if (matched === null) {
    throw new ConfigurationError(
      'autoCommit.frequency string must be one of: <positive>ms, <positive>s, <positive>m, <positive>h.',
    );
  }
  const amount = Number(matched[1]);
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new ConfigurationError(
      'autoCommit.frequency string amount must be a positive safe integer.',
    );
  }

  const unit = matched[2];
  const multiplierByUnit: Record<string, number> = {
    ms: 1,
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
  };
  const multiplier = multiplierByUnit[unit];
  const intervalMs = amount * multiplier;
  if (!Number.isSafeInteger(intervalMs) || intervalMs <= 0) {
    throw new ConfigurationError(
      'autoCommit.frequency exceeds safe integer range.',
    );
  }

  return {
    frequency: 'scheduled',
    intervalMs,
    maxPendingBytes: autoCommit?.maxPendingBytes ?? null,
  };
};

export const resolveFileDataPath = (config: FileDatastoreConfig): string => {
  if (config.filePath !== undefined && config.target !== undefined) {
    throw new ConfigurationError(
      'filePath and target cannot be specified together.',
    );
  }

  if (config.filePath !== undefined) {
    return resolve(config.filePath);
  }

  if (config.target === undefined) {
    return resolve('./frostpillar.fpdb');
  }

  if (config.target.kind === 'path') {
    return resolve(config.target.filePath);
  }

  const directoryPath = resolve(config.target.directory);
  const filePrefix = config.target.filePrefix ?? '';
  const fileName = config.target.fileName ?? 'frostpillar';
  return join(directoryPath, `${filePrefix}${fileName}.fpdb`);
};
