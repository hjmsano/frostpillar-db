import type { Filter } from '../types.js';
import { ValidationError } from '../errors.js';
import { setValueByPath } from './documentPath.js';
import { assertInclusionOperand } from './filterOperatorEvaluators.js';
import { isObjectRecord, isPlainObject, isReservedKey } from './objectUtils.js';

const MAX_ID_LENGTH = 1024;

const containsControlCharacters = (value: string): boolean => {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) {
      return true;
    }
  }
  return false;
};

export const validateIdString = (value: string): void => {
  if (value.length > MAX_ID_LENGTH) {
    throw new ValidationError(
      `_id exceeds maximum length of ${MAX_ID_LENGTH} characters.`,
    );
  }
  if (containsControlCharacters(value)) {
    throw new ValidationError('_id must not contain control characters.');
  }
};

/**
 * Validates that a filter argument is a plain object (or `undefined` when the
 * API explicitly allows it). Throws `ValidationError` for `null`, arrays,
 * primitives, and non-plain objects (class instances, `Object.create(proto)`).
 * This is applied at `Collection` entry points so downstream extractor helpers
 * may safely assume a `Record<string, unknown>` input.
 *
 * The plain-object requirement is a fail-open guard, not pedantry: filter
 * conditions are read from own enumerable keys only, so an inherited-only
 * object such as `Object.create({ _id: 'x' })` would look like an empty filter
 * and turn `remove()`/`update()` into a match-all.
 */
export const validateFilterArgument = (
  filter: unknown,
  methodName: string,
  allowUndefined: boolean,
): void => {
  if (filter === undefined) {
    if (allowUndefined) return;
    throw new ValidationError(
      `${methodName}: filter argument is required and must be a plain object.`,
    );
  }
  if (!isPlainObject(filter)) {
    throw new ValidationError(`${methodName}: filter must be a plain object.`);
  }
};

export interface IdRange {
  readonly start: string | number;
  readonly end: string | number;
}

/**
 * Returns the _id value when the filter is a simple _id equality condition.
 *
 * Recognises two forms:
 * - `{ _id: 'value' }`         (implicit $eq)
 * - `{ _id: { $eq: 'value' } }` (explicit $eq)
 *
 * Returns `null` when the filter contains other keys or is not a simple _id equality.
 */
export const extractIdEquality = (filter: Filter): string | null => {
  const keys = Object.keys(filter);
  if (keys.length !== 1 || keys[0] !== '_id') {
    return null;
  }

  const value = filter._id;
  if (typeof value === 'string' && value.length > 0) {
    validateIdString(value);
    return value;
  }

  if (isObjectRecord(value)) {
    const innerKeys = Object.keys(value);
    if (innerKeys.length === 1 && innerKeys[0] === '$eq') {
      const eqValue = value.$eq;
      if (typeof eqValue === 'string' && eqValue.length > 0) {
        validateIdString(eqValue);
        return eqValue;
      }
    }
  }

  return null;
};

/**
 * Returns the _id values when the filter is a simple `{ _id: { $in: [...] } }` condition.
 * All elements must be non-empty strings. Returns `null` otherwise.
 *
 * The operand is asserted with the same `assertInclusionOperand` the structural
 * validator uses, so the `MAX_OPERAND_ARRAY_SIZE` cap and the `_id` string rules
 * are enforced here rather than by a later `validateFilter` call. This is the
 * only gate the `_id` `$in` fast paths pass through, and they run *before* the
 * structural walk: an unchecked operand reached `getMany`/`deleteMany` first, so
 * an oversized `remove()` deleted its documents and returned without ever
 * throwing (spec 02 §5, §8.3).
 */
export const extractIdInclusion = (filter: Filter): string[] | null => {
  const keys = Object.keys(filter);
  if (keys.length !== 1 || keys[0] !== '_id') return null;

  const value = filter._id;
  if (!isObjectRecord(value)) return null;

  const innerKeys = Object.keys(value);
  if (innerKeys.length !== 1 || innerKeys[0] !== '$in') return null;

  const arr = assertInclusionOperand(value.$in, '$in');
  if (arr.length === 0) return null;

  for (const item of arr) {
    if (typeof item !== 'string' || item.length === 0) return null;
    validateIdString(item);
  }

  return arr as string[];
};

/**
 * Extracts equality conditions from a filter object.
 *
 * - Top-level keys with direct values (implicit $eq): included
 * - Top-level keys with `{ $eq: value }`: included
 * - Keys starting with `$` (logical operators like $and, $or): skipped
 * - Keys with non-$eq operator objects (e.g. $gt, $in): skipped
 */
export const extractEqualityFields = (
  filter: Filter,
  pathCache: Map<string, string[]>,
): Record<string, unknown> => {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(filter)) {
    if (key.startsWith('$')) {
      continue;
    }

    if (isReservedKey(key)) {
      continue;
    }

    if (!isObjectRecord(value)) {
      if (key.includes('.')) {
        setValueByPath(result, key, value, pathCache);
      } else {
        result[key] = value;
      }
      continue;
    }

    const keys = Object.keys(value);
    if (keys.length === 1 && keys[0] === '$eq') {
      if (key.includes('.')) {
        setValueByPath(result, key, value.$eq, pathCache);
      } else {
        result[key] = value.$eq;
      }
      continue;
    }
  }

  return result;
};

const isRangeBound = (value: unknown): value is string | number =>
  typeof value === 'string' || typeof value === 'number';

/**
 * Extracts an _id range from a filter when the `_id` field uses range operators
 * (`$gt`, `$gte`, `$lt`, `$lte`) with both a lower and upper bound.
 *
 * Returns `null` if the filter does not contain a valid _id range with both bounds.
 * Additional non-range filter keys are allowed; the range is still extracted.
 */
export const extractIdRange = (filter: Filter): IdRange | null => {
  const idValue = filter._id;
  if (!isObjectRecord(idValue)) return null;

  let start: string | number | undefined;
  let end: string | number | undefined;

  // Both $gte and $gt set the lower bound to the same value; the inclusive/exclusive
  // distinction is enforced later by matchesFilter re-applying the exact $gt/$lt bounds.
  if ('$gte' in idValue && isRangeBound(idValue.$gte)) {
    start = idValue.$gte;
  } else if ('$gt' in idValue && isRangeBound(idValue.$gt)) {
    start = idValue.$gt;
  }

  if ('$lte' in idValue && isRangeBound(idValue.$lte)) {
    end = idValue.$lte;
  } else if ('$lt' in idValue && isRangeBound(idValue.$lt)) {
    end = idValue.$lt;
  }

  if (start === undefined || end === undefined) return null;

  if (typeof start !== typeof end) {
    throw new ValidationError(
      `Range bounds for "_id" must be the same type, but got "${typeof start}" (start) and "${typeof end}" (end).`,
    );
  }

  if (typeof start === 'string') validateIdString(start);
  if (typeof end === 'string') validateIdString(end);

  return { start, end };
};
