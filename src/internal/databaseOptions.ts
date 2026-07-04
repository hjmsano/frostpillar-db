import { ConfigurationError, ValidationError } from '../errors.js';
import type {
  AutoCommitConfig,
  CapacityConfig,
  CollectionDuplicateKeyPolicy,
  CollectionOptions,
  DatastoreKeyDefinition,
  IndexConfig,
  PayloadLimitsConfig,
  ResolvedCollectionOptions,
} from '../types.js';

const PAYLOAD_LIMIT_FIELDS: readonly (keyof PayloadLimitsConfig)[] = [
  'maxDepth',
  'maxKeyBytes',
  'maxStringBytes',
  'maxKeysPerObject',
  'maxTotalKeys',
  'maxTotalBytes',
];

export const validatePayloadLimits = (
  payloadLimits: PayloadLimitsConfig,
): void => {
  for (const field of PAYLOAD_LIMIT_FIELDS) {
    const value = payloadLimits[field];
    if (value === undefined) {
      continue;
    }
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new ConfigurationError(
        `payloadLimits.${field} must be a positive safe integer.`,
      );
    }
  }
};

export const DEFAULT_MAX_ERROR_LISTENERS = 32;

const DEFAULT_COLLECTION_OPTIONS: ResolvedCollectionOptions = {
  duplicateKeys: 'reject',
  immutableCreatedAt: false,
};

const isCollectionDuplicateKeyPolicy = (
  value: unknown,
): value is CollectionDuplicateKeyPolicy => {
  return value === 'allow' || value === 'replace' || value === 'reject';
};

export const resolveCollectionOptions = (
  options?: CollectionOptions,
): ResolvedCollectionOptions => {
  const duplicateKeys =
    options?.duplicateKeys ?? DEFAULT_COLLECTION_OPTIONS.duplicateKeys;
  if (!isCollectionDuplicateKeyPolicy(duplicateKeys)) {
    throw new ValidationError(
      'Collection option "duplicateKeys" must be one of "allow", "replace", or "reject".',
    );
  }

  const ttl = options?.ttl;
  if (ttl !== undefined) {
    if (typeof ttl !== 'number' || !Number.isFinite(ttl) || ttl <= 0) {
      throw new ValidationError(
        'Collection option "ttl" must be a positive finite number (in seconds).',
      );
    }
  }

  const capacity = options?.capacity;
  const autoCommit = options?.autoCommit;
  const index = options?.index;
  const key = options?.key;

  if (
    options?.immutableCreatedAt !== undefined &&
    typeof options.immutableCreatedAt !== 'boolean'
  ) {
    throw new ValidationError(
      'Collection option "immutableCreatedAt" must be a boolean.',
    );
  }
  const immutableCreatedAt = options?.immutableCreatedAt ?? false;

  return {
    duplicateKeys,
    ttl,
    capacity,
    autoCommit,
    index,
    key,
    immutableCreatedAt,
  };
};

const isSameOptional = <T>(
  left: T | undefined,
  right: T | undefined,
  equals: (l: T, r: T) => boolean,
): boolean => {
  if (left === undefined && right === undefined) return true;
  if (left === undefined || right === undefined) return false;
  return equals(left, right);
};

const isSameCapacity = (
  left: CapacityConfig | undefined,
  right: CapacityConfig | undefined,
): boolean =>
  isSameOptional(
    left,
    right,
    (l, r) =>
      l.maxSize === r.maxSize &&
      (l.policy ?? 'strict') === (r.policy ?? 'strict'),
  );

const isSameAutoCommit = (
  left: AutoCommitConfig | undefined,
  right: AutoCommitConfig | undefined,
): boolean =>
  isSameOptional(
    left,
    right,
    (l, r) =>
      l.frequency === r.frequency && l.maxPendingBytes === r.maxPendingBytes,
  );

const isSameIndex = (
  left: IndexConfig | undefined,
  right: IndexConfig | undefined,
): boolean =>
  isSameOptional(
    left,
    right,
    (l, r) =>
      l.autoScale === r.autoScale &&
      l.maxLeafEntries === r.maxLeafEntries &&
      l.maxBranchChildren === r.maxBranchChildren &&
      l.deleteRebalancePolicy === r.deleteRebalancePolicy,
  );

const isSameKey = (
  left: DatastoreKeyDefinition<unknown, unknown> | undefined,
  right: DatastoreKeyDefinition<unknown, unknown> | undefined,
): boolean =>
  isSameOptional(
    left,
    right,
    (l, r) =>
      l.normalize === r.normalize &&
      l.compare === r.compare &&
      l.serialize === r.serialize &&
      l.deserialize === r.deserialize,
  );

export const isSameCollectionOptions = (
  left: ResolvedCollectionOptions,
  right: ResolvedCollectionOptions,
): boolean => {
  return (
    left.immutableCreatedAt === right.immutableCreatedAt &&
    left.duplicateKeys === right.duplicateKeys &&
    left.ttl === right.ttl &&
    isSameCapacity(left.capacity, right.capacity) &&
    isSameAutoCommit(left.autoCommit, right.autoCommit) &&
    isSameIndex(left.index, right.index) &&
    isSameKey(left.key, right.key)
  );
};
