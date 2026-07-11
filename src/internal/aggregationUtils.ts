import { ValidationError } from '../errors.js';
import {
  getValueByPath,
  PATH_NOT_FOUND,
  validateFieldPath,
} from './documentPath.js';
import { hasOwn } from './objectUtils.js';
import {
  MAX_DISTINCT_COUNT,
  MAX_GROUP_COUNT,
  MAX_GROUP_DOCUMENTS,
} from './limits.js';
import type {
  FrostpillarDocument,
  FrostpillarStoredDocument,
  GroupAccumulator,
  GroupAccumulators,
  GroupResultEntry,
} from '../types.js';

export const validateAggregationField = (field: string): string => {
  if (typeof field !== 'string' || field.length === 0) {
    throw new ValidationError(
      'Aggregation field path must be a non-empty string.',
    );
  }

  validateFieldPath(field);

  return field;
};

/**
 * Validates the `field` argument of `groupBy`, which accepts either a single
 * field path (string form) or an array of field paths (multi-dimension form).
 *
 * String form: delegates to `validateAggregationField` unchanged.
 *
 * Array form: the array must be non-empty; each element must independently
 * pass the same `validateAggregationField` check (non-empty string + eager
 * `validateFieldPath`); duplicate field paths within the array are rejected.
 * Validation runs eagerly, before any document is touched, and returns a
 * defensive shallow copy of the input array: the validated set of paths is
 * exactly the set used during execution, even if the caller mutates their
 * array afterwards (e.g. during `ResultChain.groupBy`'s fetch await).
 */
export const validateGroupByField = (
  field: string | string[],
): string | string[] => {
  if (!Array.isArray(field)) {
    return validateAggregationField(field);
  }

  if (field.length === 0) {
    throw new ValidationError('groupBy field array must not be empty.');
  }

  const copy = [...field];

  const seen = new Set<string>();
  for (const element of copy) {
    validateAggregationField(element);
    if (seen.has(element)) {
      throw new ValidationError(
        `groupBy field array contains duplicate field path "${element}".`,
      );
    }
    seen.add(element);
  }

  return copy;
};

/**
 * Reduces a value to a canonical string whose equality mirrors `deepEqual`:
 * object keys are sorted recursively, arrays keep element order, and the
 * primitive/Date/NaN/undefined branches match `deepEqual`'s special cases.
 * Two values produce the same string iff `deepEqual` holds, letting
 * `computeDistinct` dedupe objects via a `Set` instead of an O(N^2) scan.
 *
 * Date and non-finite numbers are rejected by payloadValidator and so cannot
 * appear in stored documents, but are handled here to keep this helper a
 * faithful, standalone counterpart to `deepEqual`.
 */
const serializeCanonical = (val: unknown): string => {
  if (val instanceof Date) {
    return `Date:${String(val.getTime())}`;
  }
  if (typeof val === 'number' && Number.isNaN(val)) {
    return 'NaN';
  }
  if (val === undefined) {
    return 'undefined';
  }
  if (typeof val !== 'object' || val === null) {
    return JSON.stringify(val);
  }
  if (Array.isArray(val)) {
    return `[${val.map(serializeCanonical).join(',')}]`;
  }
  const record = val as Record<string, unknown>;
  const parts = Object.keys(record)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${serializeCanonical(record[k])}`);
  return `{${parts.join(',')}}`;
};

export const computeDistinct = <TDocument extends FrostpillarDocument>(
  documents: FrostpillarStoredDocument<TDocument>[],
  field: string,
  pathCache: Map<string, string[]>,
): unknown[] => {
  validateFieldPath(field);

  const result: unknown[] = [];
  const primitiveSet = new Set<unknown>();
  // Object/array values are deduped by deep equality (spec 03 §1.3): two values
  // are the same when `deepEqual` holds, so e.g. `{a:1,b:2}` and `{b:2,a:1}`
  // collapse to one entry. Rather than an O(N^2) `deepEqual` scan, each object
  // is reduced to a canonical string (keys sorted recursively) and tracked in a
  // Set for O(1) membership — mirroring `deepEqual`'s equivalence relation.
  const seenObjectKeys = new Set<string>();

  for (const document of documents) {
    const resolved = getValueByPath(
      document as Record<string, unknown>,
      field,
      pathCache,
    );
    if (resolved === PATH_NOT_FOUND || resolved === undefined) {
      continue;
    }

    const value = resolved;
    const isObject = typeof value === 'object' && value !== null;

    const canonicalKey = isObject ? serializeCanonical(value) : undefined;
    const isNew = isObject
      ? !seenObjectKeys.has(canonicalKey!)
      : !primitiveSet.has(value);

    if (isNew) {
      if (result.length >= MAX_DISTINCT_COUNT) {
        throw new ValidationError(
          `distinct() result exceeds maximum of ${String(MAX_DISTINCT_COUNT)} unique values.`,
        );
      }
      if (isObject) {
        seenObjectKeys.add(canonicalKey!);
      } else {
        primitiveSet.add(value);
      }
      result.push(value);
    }
  }

  return result;
};

export const extractNumericValues = <TDocument extends FrostpillarDocument>(
  documents: FrostpillarStoredDocument<TDocument>[],
  field: string,
  pathCache: Map<string, string[]>,
): number[] => {
  validateFieldPath(field);

  const values: number[] = [];
  for (const document of documents) {
    const resolved = getValueByPath(
      document as Record<string, unknown>,
      field,
      pathCache,
    );
    if (resolved === PATH_NOT_FOUND || typeof resolved !== 'number') {
      continue;
    }

    if (!Number.isFinite(resolved)) {
      continue;
    }

    values.push(resolved);
  }

  return values;
};

const VALID_ACCUMULATOR_KEYS = new Set([
  '$count',
  '$sum',
  '$avg',
  '$min',
  '$max',
]);

const validateAccumulators = (accumulators: GroupAccumulators): void => {
  const entries = Object.entries(accumulators);
  if (entries.length === 0) {
    throw new ValidationError('groupBy accumulators must not be empty.');
  }

  for (const [outputField, accumulator] of entries) {
    const keys = Object.keys(accumulator);
    if (keys.length !== 1) {
      throw new ValidationError(
        `groupBy accumulator "${outputField}" must contain exactly one key.`,
      );
    }

    const key = keys[0];
    if (!VALID_ACCUMULATOR_KEYS.has(key)) {
      throw new ValidationError(
        `groupBy accumulator "${outputField}" has invalid key "${key}".`,
      );
    }

    if (key !== '$count') {
      const fieldPath = accumulator[key as keyof GroupAccumulator];
      if (typeof fieldPath !== 'string') {
        throw new ValidationError(
          `groupBy accumulator "${outputField}" operand for "${key}" must be a field path string.`,
        );
      }
      validateFieldPath(fieldPath);
    }
  }
};

const computeAccumulatorValue = <TDocument extends FrostpillarDocument>(
  groupDocs: FrostpillarStoredDocument<TDocument>[],
  accumulator: GroupAccumulator,
  pathCache: Map<string, string[]>,
): unknown => {
  const key = Object.keys(accumulator)[0] as keyof GroupAccumulator;

  if (key === '$count') {
    return groupDocs.length;
  }

  const fieldPath = accumulator[key]!;
  const numericValues = extractNumericValues(groupDocs, fieldPath, pathCache);

  switch (key) {
    case '$sum':
      return numericValues.reduce((total, value) => total + value, 0);
    case '$avg':
      if (numericValues.length === 0) {
        return null;
      }
      return (
        numericValues.reduce((total, value) => total + value, 0) /
        numericValues.length
      );
    case '$min':
      if (numericValues.length === 0) {
        return null;
      }
      return numericValues.reduce((currentMin, value) =>
        value < currentMin ? value : currentMin,
      );
    case '$max':
      if (numericValues.length === 0) {
        return null;
      }
      return numericValues.reduce((currentMax, value) =>
        value > currentMax ? value : currentMax,
      );
    default:
      return null;
  }
};

const serializeGroupKey = (key: unknown): string => {
  if (key === null) return 'null:null';
  if (typeof key === 'string') return `string:${key}`;
  if (typeof key === 'number') return `number:${key}`;
  if (typeof key === 'boolean') return `boolean:${key}`;
  return `object:${JSON.stringify(key)}`;
};

const buildGroupResults = <TDocument extends FrostpillarDocument>(
  groups: Map<
    string,
    { key: unknown; docs: FrostpillarStoredDocument<TDocument>[] }
  >,
  accumulators: GroupAccumulators,
  pathCache: Map<string, string[]>,
): GroupResultEntry[] => {
  const results: GroupResultEntry[] = [];
  for (const [, { key: groupKey, docs: groupDocs }] of groups) {
    const entry: GroupResultEntry = { _key: groupKey };
    for (const outputField in accumulators) {
      if (!hasOwn(accumulators, outputField)) continue;
      const accumulator = accumulators[outputField];
      entry[outputField] = computeAccumulatorValue(
        groupDocs,
        accumulator,
        pathCache,
      );
    }
    results.push(entry);
  }
  return results;
};

/**
 * Builds the composite `_key` object for the array (multi-dimension) form:
 * one property per requested field path, keyed by the literal path string
 * (not re-parsed into a nested structure), in the caller's array order.
 * Only invoked once per newly-created group, never per document.
 */
const buildCompositeGroupKey = (
  fieldPaths: readonly string[],
  values: readonly unknown[],
): Record<string, unknown> => {
  const key: Record<string, unknown> = {};
  for (let index = 0; index < fieldPaths.length; index += 1) {
    key[fieldPaths[index]] = values[index];
  }
  return key;
};

type GroupsMap<TDocument extends FrostpillarDocument> = Map<
  string,
  { key: unknown; docs: FrostpillarStoredDocument<TDocument>[] }
>;

/**
 * Adds `document` to the existing group for `serialized`, enforcing the
 * MAX_GROUP_DOCUMENTS / MAX_GROUP_COUNT limits shared by both groupBy forms.
 * Returns `true` when no group exists yet for `serialized` (after checking
 * the group-count limit), signalling the caller to create it — this lets
 * the caller build the group `_key` only on first occurrence of a group.
 */
const addDocumentToGroups = <TDocument extends FrostpillarDocument>(
  groups: GroupsMap<TDocument>,
  serialized: string,
  document: FrostpillarStoredDocument<TDocument>,
): boolean => {
  const existing = groups.get(serialized);
  if (existing !== undefined) {
    if (existing.docs.length >= MAX_GROUP_DOCUMENTS) {
      throw new ValidationError(
        `groupBy group exceeds maximum of ${String(MAX_GROUP_DOCUMENTS)} documents per group.`,
      );
    }
    existing.docs.push(document);
    return false;
  }

  if (groups.size >= MAX_GROUP_COUNT) {
    throw new ValidationError(
      `groupBy exceeds maximum of ${String(MAX_GROUP_COUNT)} distinct groups.`,
    );
  }
  return true;
};

export const computeGroupBy = <TDocument extends FrostpillarDocument>(
  documents: FrostpillarStoredDocument<TDocument>[],
  field: string | string[],
  accumulators: GroupAccumulators,
  pathCache: Map<string, string[]>,
): GroupResultEntry[] => {
  // For the array form the validated value is a defensive copy of the input,
  // so it is what must be iterated below -- not the caller's `field`.
  const validatedField = validateGroupByField(field);
  validateAccumulators(accumulators);

  const groups: GroupsMap<TDocument> = new Map();

  if (Array.isArray(validatedField)) {
    // Composite (array) form. Resolve every requested dimension per document
    // in a single pass; a dimension whose path is not found contributes
    // `null`, mirroring the string form's "missing field -> null" rule,
    // independently per dimension. Each dimension is serialized via the
    // existing type-aware serializeGroupKey, then the parts are combined
    // collision-free via JSON.stringify of the ordered array (ADR-017): this
    // guarantees no cross-dimension collision, unlike a plain string join.
    const len = validatedField.length;
    for (const document of documents) {
      const resolvedValues = new Array<unknown>(len);
      const serializedParts = new Array<string>(len);
      for (let i = 0; i < len; i += 1) {
        const resolved = getValueByPath(
          document as Record<string, unknown>,
          validatedField[i],
          pathCache,
        );
        const value: unknown = resolved !== PATH_NOT_FOUND ? resolved : null;
        resolvedValues[i] = value;
        serializedParts[i] = serializeGroupKey(value);
      }
      const serialized = JSON.stringify(serializedParts);

      if (addDocumentToGroups(groups, serialized, document)) {
        // The composite _key object is built only now, on first occurrence
        // of this group -- never per document.
        groups.set(serialized, {
          key: buildCompositeGroupKey(validatedField, resolvedValues),
          docs: [document],
        });
      }
    }
  } else {
    // Scalar (string) form: zero-allocation hot path, byte-for-byte the
    // single-field behavior that predates the composite form.
    for (const document of documents) {
      const resolved = getValueByPath(
        document as Record<string, unknown>,
        validatedField,
        pathCache,
      );
      const groupKey: unknown = resolved !== PATH_NOT_FOUND ? resolved : null;
      const serialized = serializeGroupKey(groupKey);

      if (addDocumentToGroups(groups, serialized, document)) {
        groups.set(serialized, { key: groupKey, docs: [document] });
      }
    }
  }

  return buildGroupResults(groups, accumulators, pathCache);
};
