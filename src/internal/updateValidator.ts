import { ValidationError } from '../errors.js';
import type { UpdateOperations } from '../types.js';
import { validateFieldPath } from './documentPath.js';
import { DEFAULT_MAX_DEPTH } from './limits.js';
import { hasOwn, isObjectRecord, isReservedKey } from './objectUtils.js';

const UPDATE_OPERATORS = new Set([
  '$set',
  '$unset',
  '$inc',
  '$rename',
  '$push',
  '$pull',
  '$addToSet',
]);

export interface NormalizedOperations {
  set: Record<string, unknown>;
  unset: Record<string, unknown>;
  inc: Record<string, unknown>;
  rename: Record<string, unknown>;
  push: Record<string, unknown>;
  pull: Record<string, unknown>;
  addToSet: Record<string, unknown>;
}

export const assertOperatorObject = (
  operator: string,
  value: unknown,
): Record<string, unknown> => {
  if (!isObjectRecord(value)) {
    throw new ValidationError(`${operator} expects an object value.`);
  }

  return value;
};

/**
 * Matches `_createdAt` itself, or any dotted sub-path of it (`_createdAt.x`,
 * `_createdAt.x.y`, ...). Exact string equality alone is not sufficient: when
 * `_createdAt` is absent from a document (e.g. a legacy document inserted
 * before `ttl` was configured on the collection), `setValueByPath` treats a
 * dotted path like `_createdAt.tamper` as license to *create* `_createdAt` as
 * a nested object, silently turning it into a non-number and making the
 * document permanently un-expirable (`isDocumentExpiredAt` requires
 * `typeof _createdAt === 'number'`). See ADR-016 addendum.
 */
const isCreatedAtPath = (fieldPath: unknown): boolean =>
  fieldPath === '_createdAt' ||
  (typeof fieldPath === 'string' && fieldPath.startsWith('_createdAt.'));

const assertUpdatablePath = (
  operator: '$set' | '$unset' | '$inc' | '$push' | '$pull' | '$addToSet',
  fieldPath: string,
  protectCreatedAt: boolean,
): void => {
  if (fieldPath === '_id') {
    throw new ValidationError(`${operator} cannot modify _id.`);
  }
  if (protectCreatedAt && isCreatedAtPath(fieldPath)) {
    throw new ValidationError(
      `${operator} cannot modify _createdAt on an immutableCreatedAt collection.`,
    );
  }
};

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

const validateUpdateValueObject = (
  value: Record<string, unknown>,
  activePath: WeakSet<object>,
  depth: number,
  maxDepth: number,
): void => {
  if (activePath.has(value)) {
    throw new ValidationError(
      'Circular references are not supported in update values.',
    );
  }
  activePath.add(value);
  for (const [key, nested] of Object.entries(value)) {
    if (isReservedKey(key)) {
      throw new ValidationError(
        `Update value key "${key}" is reserved and not allowed.`,
      );
    }
    validateUpdateValue(nested, activePath, depth + 1, maxDepth);
  }
  activePath.delete(value);
};

/**
 * Validates a single value written by `$set` / `$push` / `$addToSet`.
 * Mirrors `validateSecurityValue` in `payloadValidator.ts`: recursion into
 * arrays/objects is bounded by `maxDepth`, checked BEFORE descending further,
 * to prevent a pathologically deep update value from overflowing the call
 * stack with a raw `RangeError` instead of a clean `ValidationError`.
 *
 * `depth` starts at `2` for the value passed directly to `$set`/`$push`/
 * `$addToSet` (the entry-point call in `extractAndValidateFieldOps` /
 * `extractAndValidateArrayOps`), incrementing by 1 for each array element or
 * object property descended into. Starting at `2` (rather than `1`) mirrors
 * how the value will be counted once merged into the full document: the
 * document itself occupies depth `1` (see `validateInsertPayload` /
 * `validatePayloadSecurity` in `payloadValidator.ts`), so a value assigned
 * directly to a top-level field is one level deeper. This keeps the two
 * independent depth checks — this one (pre-merge, on the value alone) and
 * the post-merge whole-document check in `Collection.validatePayload` —
 * aligned on the same effective boundary for the common case of a
 * non-dotted field path, so both report `ValidationError` at the same
 * nesting depth rather than one silently being stricter than the other.
 */
export const validateUpdateValue = (
  value: unknown,
  activePath: WeakSet<object>,
  depth: number,
  maxDepth: number,
): void => {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new ValidationError(
        'Update values must not contain non-finite numbers.',
      );
    }
    return;
  }
  if (typeof value === 'bigint') {
    throw new ValidationError('Update values must not contain bigint.');
  }
  if (depth > maxDepth) {
    throw new ValidationError(`Update value nesting depth must be <= ${maxDepth}.`);
  }
  if (Array.isArray(value)) {
    if (activePath.has(value)) {
      throw new ValidationError(
        'Circular references are not supported in update values.',
      );
    }
    activePath.add(value);
    for (const element of value) {
      validateUpdateValue(element, activePath, depth + 1, maxDepth);
    }
    activePath.delete(value);
    return;
  }
  if (typeof value === 'object') {
    if (!isPlainObject(value)) {
      throw new ValidationError('Update values must be plain objects.');
    }
    validateUpdateValueObject(value, activePath, depth, maxDepth);
    return;
  }
  throw new ValidationError(
    'Update values must be string | number | boolean | null, an array, or a plain object.',
  );
};

const assertValidOperatorKeys = (operations: UpdateOperations): void => {
  for (const operator of Object.keys(operations)) {
    if (!operator.startsWith('$')) {
      throw new ValidationError('Update operation keys must start with "$".');
    }
    if (!UPDATE_OPERATORS.has(operator)) {
      throw new ValidationError(`Unknown update operator "${operator}".`);
    }
  }
};

const validateRenameEntry = (
  source: string,
  target: unknown,
  protectCreatedAt: boolean,
): void => {
  if (source === '_id' || target === '_id') {
    throw new ValidationError(
      '$rename cannot use _id as source or destination.',
    );
  }
  if (
    protectCreatedAt &&
    (isCreatedAtPath(source) || isCreatedAtPath(target))
  ) {
    throw new ValidationError(
      '$rename cannot modify _createdAt on an immutableCreatedAt collection.',
    );
  }
  if (typeof target !== 'string' || target.length === 0) {
    throw new ValidationError(
      '$rename destination must be a non-empty string.',
    );
  }
  const srcSegments = source.split('.');
  const dstSegments = target.split('.');
  const minLen = Math.min(srcSegments.length, dstSegments.length);
  let prefixMatch = true;
  for (let i = 0; i < minLen; i += 1) {
    if (srcSegments[i] !== dstSegments[i]) {
      prefixMatch = false;
      break;
    }
  }
  if (prefixMatch && srcSegments.length !== dstSegments.length) {
    throw new ValidationError(
      '$rename source and destination may not overlap.',
    );
  }
  validateFieldPath(source);
  validateFieldPath(target);
};

const extractAndValidateFieldOps = (
  operations: UpdateOperations,
  protectCreatedAt: boolean,
  maxDepth: number,
): Pick<NormalizedOperations, 'set' | 'unset' | 'inc' | 'rename'> => {
  const set =
    operations.$set === undefined
      ? {}
      : assertOperatorObject('$set', operations.$set);
  const unset =
    operations.$unset === undefined
      ? {}
      : assertOperatorObject('$unset', operations.$unset);
  const inc =
    operations.$inc === undefined
      ? {}
      : assertOperatorObject('$inc', operations.$inc);
  const rename =
    operations.$rename === undefined
      ? {}
      : assertOperatorObject('$rename', operations.$rename);

  const updateValueActivePath = new WeakSet<object>();
  for (const [field, value] of Object.entries(set)) {
    assertUpdatablePath('$set', field, protectCreatedAt);
    if (hasOwn(unset, field)) {
      throw new ValidationError(
        `Cannot combine $set and $unset for "${field}".`,
      );
    }
    validateUpdateValue(value, updateValueActivePath, 2, maxDepth);
  }
  for (const field of Object.keys(unset)) {
    assertUpdatablePath('$unset', field, protectCreatedAt);
  }
  for (const [source, target] of Object.entries(rename)) {
    validateRenameEntry(source, target, protectCreatedAt);
  }
  for (const [field, value] of Object.entries(inc)) {
    assertUpdatablePath('$inc', field, protectCreatedAt);
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new ValidationError('$inc values must be finite numbers.');
    }
  }

  return { set, unset, inc, rename };
};

const extractAndValidateArrayOps = (
  operations: UpdateOperations,
  protectCreatedAt: boolean,
  maxDepth: number,
): Pick<NormalizedOperations, 'push' | 'pull' | 'addToSet'> => {
  const push =
    operations.$push === undefined
      ? {}
      : assertOperatorObject('$push', operations.$push);
  const pull =
    operations.$pull === undefined
      ? {}
      : assertOperatorObject('$pull', operations.$pull);
  const addToSet =
    operations.$addToSet === undefined
      ? {}
      : assertOperatorObject('$addToSet', operations.$addToSet);

  const updateValueActivePath = new WeakSet<object>();
  for (const [field, value] of Object.entries(push)) {
    assertUpdatablePath('$push', field, protectCreatedAt);
    validateUpdateValue(value, updateValueActivePath, 2, maxDepth);
  }
  for (const field of Object.keys(pull)) {
    assertUpdatablePath('$pull', field, protectCreatedAt);
  }
  for (const [field, value] of Object.entries(addToSet)) {
    assertUpdatablePath('$addToSet', field, protectCreatedAt);
    validateUpdateValue(value, updateValueActivePath, 2, maxDepth);
  }

  return { push, pull, addToSet };
};

export const normalizeUpdateOperations = (
  operations: UpdateOperations,
  protectCreatedAt = false,
  maxDepth: number = DEFAULT_MAX_DEPTH,
): NormalizedOperations => {
  assertValidOperatorKeys(operations);
  const fieldOps = extractAndValidateFieldOps(
    operations,
    protectCreatedAt,
    maxDepth,
  );
  const arrayOps = extractAndValidateArrayOps(
    operations,
    protectCreatedAt,
    maxDepth,
  );
  return { ...fieldOps, ...arrayOps };
};
