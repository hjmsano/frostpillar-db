import { ValidationError } from '../errors.js';

const VALID_COLLECTION_NAME = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/;

export const validateCollectionName = (name: string): void => {
  if (typeof name !== 'string') {
    throw new ValidationError('Collection name must be a non-empty string.');
  }

  if (name.length === 0) {
    throw new ValidationError('Collection name must be a non-empty string.');
  }

  if (name.includes('\x00')) {
    throw new ValidationError(
      'Collection name must not contain null byte (\\x00).',
    );
  }

  if (name.startsWith('_')) {
    throw new ValidationError(
      'Collection name starting with "_" is reserved for internal use.',
    );
  }

  if (name.includes('..')) {
    throw new ValidationError(
      'Collection name must not contain ".." sequence.',
    );
  }

  if (!VALID_COLLECTION_NAME.test(name)) {
    throw new ValidationError(
      'Collection name must contain only letters, digits, hyphens, dots, and underscores.',
    );
  }
};
