export const isObjectRecord = (
  value: unknown,
): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
};

export const hasOwn = (
  target: Record<string, unknown>,
  key: string,
): boolean => {
  return Object.prototype.hasOwnProperty.call(target, key);
};

/**
 * Object keys that could enable prototype-pollution if accepted from user
 * input. Centralised here so filter/validator/evaluator code share one source
 * of truth.
 */
export const RESERVED_KEYS: ReadonlySet<string> = new Set([
  '__proto__',
  'constructor',
  'prototype',
  '__defineGetter__',
  '__defineSetter__',
  '__lookupGetter__',
  '__lookupSetter__',
]);

export const isReservedKey = (key: string): boolean => {
  return RESERVED_KEYS.has(key);
};

/**
 * Fast deep clone for JSON-safe documents.
 *
 * Frostpillar documents are validated as JSON-safe by payloadValidator
 * (rejects Date, Map, Set, bigint, non-plain objects), so the full
 * structuredClone algorithm is unnecessary overhead.
 */
export const cloneDocument = <T>(value: T): T => {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    const arr = value as unknown[];
    const out = new Array(arr.length);
    for (let i = 0; i < arr.length; i++) out[i] = cloneDocument(arr[i]);
    return out as unknown as T;
  }
  const out: Record<string, unknown> = {};
  for (const key in value as Record<string, unknown>) {
    if (Object.prototype.hasOwnProperty.call(value, key)) {
      if (key === '__proto__') continue;
      out[key] = cloneDocument((value as Record<string, unknown>)[key]);
    }
  }
  return out as T;
};

/**
 * Defensively clones a value before it is placed into an aggregation result
 * (ADR-021, ADR-026). Aggregation runs over the stored documents themselves,
 * so returning a resolved object/array value verbatim would let a caller
 * mutate stored data through the result. A thin, semantically named alias of
 * `cloneDocument`: primitives (including `null`/`undefined`) pass through
 * unchanged, objects/arrays are deep-cloned. Introduced for `$first`/`$last`
 * (ADR-021); reused by `$push`/`$addToSet` (ADR-023) and, per ADR-026, by
 * `distinct()`'s values and `groupBy()`'s `_key` values.
 */
export const cloneAccumulatorValue = (value: unknown): unknown =>
  cloneDocument(value);

/**
 * Returns `true` when an object has at least one own enumerable key.
 * Uses a `for…in` + `hasOwnProperty` loop so no intermediate array is
 * allocated, unlike `Object.keys(obj).length > 0`.
 */
export const hasAnyKey = (obj: Record<string, unknown>): boolean => {
  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) return true;
  }
  return false;
};

/**
 * Returns `true` when a filter is undefined or an empty object.
 * Avoids `Object.keys()` allocation by using `hasAnyKey`.
 */
export const isEmptyFilter = (
  filter: Record<string, unknown> | undefined,
): boolean => {
  return filter === undefined || !hasAnyKey(filter);
};
