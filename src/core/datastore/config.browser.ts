import { UnsupportedBackendError } from '../errors/index.js';
import type { FileDatastoreConfig } from '../types.js';
export { parseCapacityConfig, parseFileAutoCommitConfig } from './config.shared.js';

export const ensureCanonicalPathWithinWorkingDirectory = (
  _targetPath: string,
  _optionName: string,
): void => {
  throw new UnsupportedBackendError(
    'Path canonicalization is unavailable in browser bundle profile "core".',
  );
};

export const resolveFileDataPath = (_config: FileDatastoreConfig): string => {
  throw new UnsupportedBackendError(
    'File backend path resolution is unavailable in browser bundle profile "core".',
  );
};
