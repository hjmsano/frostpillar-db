import { ValidationError } from '../errors.js';
import type { UpdateOperations } from '../types.js';
import { validateFieldPath } from './documentPath.js';
import { snapshotComparisonValue } from './filterSnapshot.js';
import { DEFAULT_MAX_DEPTH } from './limits.js';
import {
  defineOwnProperty,
  hasOwn,
  isObjectRecord,
  isPlainObject,
  isReservedKey,
} from './objectUtils.js';

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
  inputKeyCount: number;
  set: Record<string, unknown>;
  unset: Record<string, unknown>;
  inc: Record<string, unknown>;
  rename: Record<string, unknown>;
  push: Record<string, unknown>;
  pull: Record<string, unknown>;
  addToSet: Record<string, unknown>;
}

interface UpdateOperationsSnapshot {
  readonly operations: UpdateOperations;
  readonly inputKeyCount: number;
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

const snapshotUpdateOperations = (
  operations: UpdateOperations,
): UpdateOperationsSnapshot => {
  const copy: Record<string, unknown> = {};
  let inputKeyCount = 0;
  for (const [operator, value] of Object.entries(operations)) {
    defineOwnProperty(copy, operator, value);
    inputKeyCount += 1;
  }
  return {
    operations: copy as UpdateOperations,
    inputKeyCount,
  };
};

const snapshotOperatorMap = (
  operator: string,
  value: unknown,
): Record<string, unknown> => {
  if (value === undefined) return {};
  const source = assertOperatorObject(operator, value);
  const copy: Record<string, unknown> = {};
  for (const [field, operand] of Object.entries(source)) {
    defineOwnProperty(copy, field, operand);
  }
  return copy;
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

const materializeUpdateValueObject = (
  value: Record<string, unknown>,
  activePath: WeakSet<object>,
  depth: number,
  maxDepth: number,
): Record<string, unknown> => {
  if (activePath.has(value)) {
    throw new ValidationError(
      'Circular references are not supported in update values.',
    );
  }
  activePath.add(value);
  const copy: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value)) {
    if (isReservedKey(key)) {
      throw new ValidationError(
        `Update value key "${key}" is reserved and not allowed.`,
      );
    }
    copy[key] = materializeUpdateValue(nested, activePath, depth + 1, maxDepth);
  }
  activePath.delete(value);
  return copy;
};

/**
 * Validates a single value written by `$set` / `$push` / `$addToSet` **and
 * returns the copy that will be written**. Validating the caller's value and
 * deep-copying it afterwards (in `applySet` / `applyPush`) read it twice, so an
 * accessor property could pass this check with a plain number and hand the
 * write path a function or a `bigint` (ADR-030). The value returned here is the
 * one that was checked, so the two cannot diverge.
 *
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
 * the post-merge whole-document check in `Collection.validateOwnedDocument` —
 * aligned on the same effective boundary for the common case of a
 * non-dotted field path, so both report `ValidationError` at the same
 * nesting depth rather than one silently being stricter than the other.
 */
export const materializeUpdateValue = (
  value: unknown,
  activePath: WeakSet<object>,
  depth: number,
  maxDepth: number,
): unknown => {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean'
  ) {
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new ValidationError(
        'Update values must not contain non-finite numbers.',
      );
    }
    return value;
  }
  if (typeof value === 'bigint') {
    throw new ValidationError('Update values must not contain bigint.');
  }
  if (depth > maxDepth) {
    throw new ValidationError(
      `Update value nesting depth must be <= ${maxDepth}.`,
    );
  }
  if (Array.isArray(value)) {
    if (activePath.has(value)) {
      throw new ValidationError(
        'Circular references are not supported in update values.',
      );
    }
    activePath.add(value);
    const copy: unknown[] = [];
    for (const element of value) {
      copy.push(
        materializeUpdateValue(element, activePath, depth + 1, maxDepth),
      );
    }
    activePath.delete(value);
    return copy;
  }
  if (typeof value === 'object') {
    if (!isPlainObject(value)) {
      throw new ValidationError('Update values must be plain objects.');
    }
    return materializeUpdateValueObject(value, activePath, depth, maxDepth);
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

/**
 * Every normalized map is a fresh object holding the *single* read of each
 * caller-supplied entry: the operator maps are re-read by the `apply*` helpers
 * (per matched document, across `await`s), and re-reading the caller's object
 * there let an accessor supply a value the validator never saw — a `$rename`
 * destination could turn into `_createdAt` after `validateRenameEntry` had
 * cleared a different one (ADR-030).
 */
const extractAndValidateFieldOps = (
  operations: UpdateOperations,
  protectCreatedAt: boolean,
  maxDepth: number,
): Pick<NormalizedOperations, 'set' | 'unset' | 'inc' | 'rename'> => {
  const rawSet = snapshotOperatorMap('$set', operations.$set);
  const rawUnset = snapshotOperatorMap('$unset', operations.$unset);
  const rawInc = snapshotOperatorMap('$inc', operations.$inc);
  const rawRename = snapshotOperatorMap('$rename', operations.$rename);

  const set: Record<string, unknown> = {};
  const unset: Record<string, unknown> = {};
  const inc: Record<string, unknown> = {};
  const rename: Record<string, unknown> = {};

  const updateValueActivePath = new WeakSet<object>();
  for (const [field, value] of Object.entries(rawSet)) {
    assertUpdatablePath('$set', field, protectCreatedAt);
    if (hasOwn(rawUnset, field)) {
      throw new ValidationError(
        `Cannot combine $set and $unset for "${field}".`,
      );
    }
    defineOwnProperty(
      set,
      field,
      materializeUpdateValue(value, updateValueActivePath, 2, maxDepth),
    );
  }
  for (const [field, value] of Object.entries(rawUnset)) {
    assertUpdatablePath('$unset', field, protectCreatedAt);
    defineOwnProperty(unset, field, value);
  }
  for (const [source, target] of Object.entries(rawRename)) {
    validateRenameEntry(source, target, protectCreatedAt);
    defineOwnProperty(rename, source, target);
  }
  for (const [field, value] of Object.entries(rawInc)) {
    assertUpdatablePath('$inc', field, protectCreatedAt);
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new ValidationError('$inc values must be finite numbers.');
    }
    defineOwnProperty(inc, field, value);
  }

  return { set, unset, inc, rename };
};

const extractAndValidateArrayOps = (
  operations: UpdateOperations,
  protectCreatedAt: boolean,
  maxDepth: number,
): Pick<NormalizedOperations, 'push' | 'pull' | 'addToSet'> => {
  const rawPush = snapshotOperatorMap('$push', operations.$push);
  const rawPull = snapshotOperatorMap('$pull', operations.$pull);
  const rawAddToSet = snapshotOperatorMap('$addToSet', operations.$addToSet);

  const push: Record<string, unknown> = {};
  const pull: Record<string, unknown> = {};
  const addToSet: Record<string, unknown> = {};

  const updateValueActivePath = new WeakSet<object>();
  for (const [field, value] of Object.entries(rawPush)) {
    assertUpdatablePath('$push', field, protectCreatedAt);
    defineOwnProperty(
      push,
      field,
      materializeUpdateValue(value, updateValueActivePath, 2, maxDepth),
    );
  }
  // A `$pull` operand is only compared against stored elements. Detach it using
  // the same structural semantics as filter comparison values so accessors and
  // later caller mutations cannot change what subsequent documents observe.
  for (const [field, value] of Object.entries(rawPull)) {
    assertUpdatablePath('$pull', field, protectCreatedAt);
    defineOwnProperty(pull, field, snapshotComparisonValue(value, maxDepth, 2));
  }
  for (const [field, value] of Object.entries(rawAddToSet)) {
    assertUpdatablePath('$addToSet', field, protectCreatedAt);
    defineOwnProperty(
      addToSet,
      field,
      materializeUpdateValue(value, updateValueActivePath, 2, maxDepth),
    );
  }

  return { push, pull, addToSet };
};

export const normalizeUpdateOperations = (
  operations: UpdateOperations,
  protectCreatedAt = false,
  maxDepth: number = DEFAULT_MAX_DEPTH,
): NormalizedOperations => {
  const snapshot = snapshotUpdateOperations(operations);
  const owned = snapshot.operations;
  assertValidOperatorKeys(owned);
  const fieldOps = extractAndValidateFieldOps(
    owned,
    protectCreatedAt,
    maxDepth,
  );
  const arrayOps = extractAndValidateArrayOps(
    owned,
    protectCreatedAt,
    maxDepth,
  );
  return {
    inputKeyCount: snapshot.inputKeyCount,
    ...fieldOps,
    ...arrayOps,
  };
};
