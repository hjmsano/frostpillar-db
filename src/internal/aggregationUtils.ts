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

export const computeGroupBy = <TDocument extends FrostpillarDocument>(
  documents: FrostpillarStoredDocument<TDocument>[],
  field: string,
  accumulators: GroupAccumulators,
  pathCache: Map<string, string[]>,
): GroupResultEntry[] => {
  validateFieldPath(field);
  validateAccumulators(accumulators);

  const groups = new Map<
    string,
    { key: unknown; docs: FrostpillarStoredDocument<TDocument>[] }
  >();

  for (const document of documents) {
    const resolved = getValueByPath(
      document as Record<string, unknown>,
      field,
      pathCache,
    );
    const groupKey: unknown = resolved !== PATH_NOT_FOUND ? resolved : null;
    const serialized = serializeGroupKey(groupKey);

    const existing = groups.get(serialized);
    if (existing !== undefined) {
      if (existing.docs.length >= MAX_GROUP_DOCUMENTS) {
        throw new ValidationError(
          `groupBy group exceeds maximum of ${String(MAX_GROUP_DOCUMENTS)} documents per group.`,
        );
      }
      existing.docs.push(document);
    } else {
      if (groups.size >= MAX_GROUP_COUNT) {
        throw new ValidationError(
          `groupBy exceeds maximum of ${String(MAX_GROUP_COUNT)} distinct groups.`,
        );
      }
      groups.set(serialized, { key: groupKey, docs: [document] });
    }
  }

  return buildGroupResults(groups, accumulators, pathCache);
};
