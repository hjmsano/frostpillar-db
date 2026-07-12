import { ValidationError } from '../errors.js';
import {
  getValueByPath,
  PATH_NOT_FOUND,
  validateFieldPath,
} from './documentPath.js';
import { cloneAccumulatorValue, hasOwn, isObjectRecord } from './objectUtils.js';
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

/**
 * Shared distinct-value scan core (ADR-022 §6): iterates `documents`,
 * resolves `field` on each, and tracks which resolved values are newly
 * distinct via the same two seen-sets `computeDistinct` has always used (a
 * primitive `Set` plus a canonical-key `Set` for objects/arrays, keyed by
 * `serializeCanonical` so deep equality collapses to `Set` membership). The
 * `MAX_DISTINCT_COUNT` cap is enforced on the running unique-value count
 * before each new value is admitted, identically regardless of whether the
 * caller also collects the values.
 *
 * `onNew`, when provided, is invoked once per newly-seen distinct value, in
 * first-occurrence order — the hook `computeDistinct` uses to build its
 * result array. `computeCountDistinct` omits it and only counts, so no
 * result array is ever allocated for the count-only path. `context` is
 * folded into the cap's `ValidationError` message to identify the caller.
 */
const scanDistinctValues = <TDocument extends FrostpillarDocument>(
  documents: FrostpillarStoredDocument<TDocument>[],
  field: string,
  pathCache: Map<string, string[]>,
  context: string,
  onNew?: (value: unknown) => void,
): number => {
  let count = 0;
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
      if (count >= MAX_DISTINCT_COUNT) {
        throw new ValidationError(
          `${context} exceeds maximum of ${String(MAX_DISTINCT_COUNT)} unique values.`,
        );
      }
      if (isObject) {
        seenObjectKeys.add(canonicalKey!);
      } else {
        primitiveSet.add(value);
      }
      count += 1;
      onNew?.(value);
    }
  }

  return count;
};

/**
 * Object/array values are defensively cloned via `cloneAccumulatorValue`
 * before entering the result array (ADR-026), since the scanned documents are
 * references to stored documents; primitives and `null` pass through
 * unchanged. Dedup happens inside `scanDistinctValues` on the original value,
 * so equality semantics are unaffected and at most one clone is taken per
 * distinct value.
 */
export const computeDistinct = <TDocument extends FrostpillarDocument>(
  documents: FrostpillarStoredDocument<TDocument>[],
  field: string,
  pathCache: Map<string, string[]>,
): unknown[] => {
  validateFieldPath(field);

  const result: unknown[] = [];
  scanDistinctValues(documents, field, pathCache, 'distinct() result', (value) => {
    result.push(cloneAccumulatorValue(value));
  });

  return result;
};

/**
 * Counts exactly the values `computeDistinct` would return, without
 * allocating the result array (ADR-022): `computeCountDistinct(docs, f,
 * cache) === computeDistinct(docs, f, cache).length` always holds, since
 * both run the same `scanDistinctValues` core with the identical equality
 * and cap semantics — only the `onNew` collection hook differs.
 */
export const computeCountDistinct = <TDocument extends FrostpillarDocument>(
  documents: FrostpillarStoredDocument<TDocument>[],
  field: string,
  pathCache: Map<string, string[]>,
  context?: string,
): number => {
  validateFieldPath(field);

  return scanDistinctValues(
    documents,
    field,
    pathCache,
    context ?? 'countDistinct() result',
  );
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

/**
 * Computes the `p`-th percentile of `values` using linear interpolation
 * between closest ranks (`PERCENTILE_CONT` semantics — the definition used by
 * SQL, numpy, and pandas). `values` is sorted ascending into a fresh array;
 * the caller's array is never mutated. `p` must already be validated (see
 * `validatePercentile`) — a fraction in `[0, 1]`.
 *
 * `rank = p * (n - 1)`; `lo = floor(rank)`, `frac = rank - lo`;
 * `result = v[lo] + frac * (v[lo + 1] - v[lo])` (`v[lo]` when `frac === 0`).
 * Returns `null` for an empty `values` array, mirroring `$avg`/`$min`/`$max`.
 */
export const computePercentile = (
  values: number[],
  p: number,
): number | null => {
  if (values.length === 0) {
    return null;
  }

  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 1) {
    return sorted[0];
  }

  const rank = p * (sorted.length - 1);
  const lo = Math.floor(rank);
  const frac = rank - lo;

  if (frac === 0) {
    return sorted[lo];
  }

  return sorted[lo] + frac * (sorted[lo + 1] - sorted[lo]);
};

/**
 * Welford's single-pass online algorithm: accumulates `count`, the running
 * `mean`, and `m2` (the sum of squared deviations from the running mean) in
 * one pass over `values`. This is the numerically stable building block for
 * variance/standard deviation — unlike the naive `E[x^2] - E[x]^2` formula,
 * it never subtracts two large nearly-equal numbers, so it stays accurate
 * even for large-magnitude, low-variance data (spec 03 §1.3, ADR-019 §3).
 */
export const computeWelford = (
  values: number[],
): { count: number; mean: number; m2: number } => {
  let count = 0;
  let mean = 0;
  let m2 = 0;

  for (const x of values) {
    count += 1;
    const delta = x - mean;
    mean += delta / count;
    m2 += delta * (x - mean);
  }

  return { count, mean, m2 };
};

export const clampVariance = (variance: number): number =>
  Math.max(0, variance);

/**
 * Derives population (`sample = false`) or sample (`sample = true`) variance
 * from `computeWelford`'s accumulators, applying the MongoDB-aligned edge
 * rules (ADR-019 §4): `count === 0` -> `null` (no numeric values); `count
 * === 1` -> `0` for population (a single point has zero dispersion from
 * itself) or `null` for sample (the `count - 1 = 0` divisor is undefined);
 * `count >= 2` -> the computed variance. No `NaN` or negative value can
 * leak from this function.
 */
export const computeVariance = (
  values: number[],
  sample: boolean,
): number | null => {
  const { count, m2 } = computeWelford(values);

  if (count === 0) {
    return null;
  }
  if (count === 1) {
    return sample ? null : 0;
  }

  const variance = sample ? m2 / (count - 1) : m2 / count;
  return clampVariance(variance);
};

/**
 * Standard deviation is the square root of the corresponding variance;
 * `null` propagates unchanged (ADR-019 §3) so no `NaN` can leak here either.
 */
export const computeStdDev = (
  values: number[],
  sample: boolean,
): number | null => {
  const variance = computeVariance(values, sample);
  return variance === null ? null : Math.sqrt(variance);
};

const validateScalarPercentile = (p: unknown): number => {
  if (typeof p !== 'number' || !Number.isFinite(p) || p < 0 || p > 1) {
    throw new ValidationError(
      'percentile p must be a finite number between 0 and 1 (inclusive).',
    );
  }
  return p;
};

/**
 * Validates the scalar `p` argument of `.percentile()`. It must be a finite
 * fraction in `[0, 1]`; arrays and all other values throw `ValidationError`
 * eagerly.
 */
export const validatePercentile = (p: unknown): number =>
  validateScalarPercentile(p);

const VALID_ACCUMULATOR_KEYS = new Set([
  '$count',
  '$sum',
  '$avg',
  '$min',
  '$max',
  '$median',
  '$percentile',
  '$stdDevPop',
  '$stdDevSamp',
  '$variancePop',
  '$varianceSamp',
  '$first',
  '$last',
  '$countDistinct',
  '$push',
  '$addToSet',
]);

/**
 * Validates the operand of a `$percentile` accumulator entry: it must be a
 * plain object with exactly the keys `field` (a valid field path, same eager
 * validation as every other accumulator's field-path operand) and `p` (the
 * same `[0, 1]` scalar rule as the `.percentile()` terminal — array `p` is
 * rejected, since `$percentile` is scalar-only inside `groupBy`).
 */
const validatePercentileOperand = (
  operand: unknown,
  outputField: string,
): void => {
  if (!isObjectRecord(operand)) {
    throw new ValidationError(
      `groupBy accumulator "${outputField}" operand for "$percentile" must be an object with "field" and "p".`,
    );
  }

  const keys = Object.keys(operand);
  if (
    keys.length !== 2 ||
    !hasOwn(operand, 'field') ||
    !hasOwn(operand, 'p')
  ) {
    throw new ValidationError(
      `groupBy accumulator "${outputField}" operand for "$percentile" must contain exactly the keys "field" and "p".`,
    );
  }

  const field = operand.field;
  if (typeof field !== 'string') {
    throw new ValidationError(
      `groupBy accumulator "${outputField}" operand "field" for "$percentile" must be a field path string.`,
    );
  }
  validateFieldPath(field);

  validateScalarPercentile(operand.p);
};

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

    if (key === '$count') {
      continue;
    }

    if (key === '$percentile') {
      validatePercentileOperand(accumulator.$percentile, outputField);
      continue;
    }

    const fieldPath = accumulator[key as keyof GroupAccumulator];
    if (typeof fieldPath !== 'string') {
      throw new ValidationError(
        `groupBy accumulator "${outputField}" operand for "${key}" must be a field path string.`,
      );
    }
    validateFieldPath(fieldPath);
  }
};

/**
 * Reduces the extracted numeric values for the field-path accumulators
 * (`$sum`/`$avg`/`$min`/`$max`/`$median`). Split out of `computeAccumulatorValue`
 * so each function stays under the project's max-lines-per-function budget.
 */
const computeNumericAccumulator = (
  key: keyof GroupAccumulator,
  numericValues: number[],
): unknown => {
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
    case '$median':
      return computePercentile(numericValues, 0.5);
    case '$stdDevPop':
      return computeStdDev(numericValues, false);
    case '$stdDevSamp':
      return computeStdDev(numericValues, true);
    case '$variancePop':
      return computeVariance(numericValues, false);
    case '$varianceSamp':
      return computeVariance(numericValues, true);
    default:
      return null;
  }
};

/**
 * Implements `$first` / `$last` (ADR-021): selects the positional document
 * of the group (first or last, per the aggregation input order established
 * by ADR-020 -- the chain's `.sort()` order when present, otherwise storage
 * order) and THEN reads `fieldPath` from it. This is deliberately
 * positional-then-read, not "the first/last document that has the field":
 * if the selected document lacks `fieldPath`, the result is `null` even
 * when another document in the group has the field. A group always has at
 * least one document. Unlike every other accumulator, the value may be of
 * any type; object/array values are defensively cloned via
 * `cloneAccumulatorValue` before being returned, since group documents are
 * references to stored documents.
 */
const computeFirstLast = <TDocument extends FrostpillarDocument>(
  groupDocs: FrostpillarStoredDocument<TDocument>[],
  position: 'first' | 'last',
  fieldPath: string,
  pathCache: Map<string, string[]>,
): unknown => {
  if (groupDocs.length === 0) {
    return null;
  }

  const selectedDoc =
    position === 'first' ? groupDocs[0] : groupDocs[groupDocs.length - 1];
  const resolved = getValueByPath(
    selectedDoc as Record<string, unknown>,
    fieldPath,
    pathCache,
  );
  if (resolved === PATH_NOT_FOUND || resolved === undefined) {
    return null;
  }

  return cloneAccumulatorValue(resolved);
};

/**
 * Implements `$push` (ADR-023): collects the resolved value of `fieldPath`
 * for every document in the group, in aggregation input order (ADR-020 --
 * the chain's `.sort()` order when present, otherwise storage order; no
 * re-sorting happens here). Missing/`undefined` values are skipped; `null`
 * is included; duplicates are preserved. Object/array values are
 * defensively cloned via `cloneAccumulatorValue` before entering the result
 * array, since group documents are references to stored documents;
 * primitives/`null` pass through unchanged. An empty group field set (no
 * present values) yields `[]`. No dedicated limit is needed: a group holds
 * at most `MAX_GROUP_DOCUMENTS` documents and `$push` emits at most one
 * value per document, so the output is already bounded.
 */
const computePush = <TDocument extends FrostpillarDocument>(
  groupDocs: FrostpillarStoredDocument<TDocument>[],
  fieldPath: string,
  pathCache: Map<string, string[]>,
): unknown[] => {
  const result: unknown[] = [];
  for (const document of groupDocs) {
    const resolved = getValueByPath(
      document as Record<string, unknown>,
      fieldPath,
      pathCache,
    );
    if (resolved === PATH_NOT_FOUND || resolved === undefined) {
      continue;
    }
    result.push(cloneAccumulatorValue(resolved));
  }
  return result;
};

/**
 * Implements `$addToSet` (ADR-023): collects the *distinct* resolved values
 * of `fieldPath` within the group, in first-occurrence order within the
 * aggregation input order, using exactly `scanDistinctValues`'s equality
 * semantics (identical to `.distinct()`: missing/`undefined` skipped, `null`
 * a valid member, deep equality for objects/arrays, strict equality for
 * primitives). Reuses the shared `scanDistinctValues` core so the per-group
 * `MAX_DISTINCT_COUNT` cap (and its `ValidationError`) is inherited for
 * free, identifying the failing operation as the `$addToSet` accumulator.
 * Each newly-distinct value is defensively cloned via `cloneAccumulatorValue`
 * before entering the result array, since group documents are references to
 * stored documents. An empty group field set yields `[]`.
 */
const computeAddToSet = <TDocument extends FrostpillarDocument>(
  groupDocs: FrostpillarStoredDocument<TDocument>[],
  fieldPath: string,
  pathCache: Map<string, string[]>,
): unknown[] => {
  const result: unknown[] = [];
  scanDistinctValues(
    groupDocs,
    fieldPath,
    pathCache,
    '$addToSet accumulator',
    (value) => {
      result.push(cloneAccumulatorValue(value));
    },
  );
  return result;
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

  if (key === '$percentile') {
    const operand = accumulator.$percentile!;
    const numericValues = extractNumericValues(
      groupDocs,
      operand.field,
      pathCache,
    );
    return computePercentile(numericValues, operand.p);
  }

  if (key === '$first' || key === '$last') {
    const fieldPath = accumulator[key]!;
    return computeFirstLast(
      groupDocs,
      key === '$first' ? 'first' : 'last',
      fieldPath,
      pathCache,
    );
  }

  if (key === '$countDistinct') {
    const fieldPath = accumulator.$countDistinct!;
    return computeCountDistinct(
      groupDocs,
      fieldPath,
      pathCache,
      '$countDistinct accumulator',
    );
  }

  if (key === '$push') {
    return computePush(groupDocs, accumulator.$push!, pathCache);
  }

  if (key === '$addToSet') {
    return computeAddToSet(groupDocs, accumulator.$addToSet!, pathCache);
  }

  const fieldPath = accumulator[key]!;
  const numericValues = extractNumericValues(groupDocs, fieldPath, pathCache);
  return computeNumericAccumulator(key, numericValues);
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
 *
 * Each dimension's value is defensively cloned via `cloneAccumulatorValue`
 * (ADR-026): the resolved values are references into the stored documents, so
 * an object/array dimension would otherwise let a caller mutate stored data
 * through `_key`. The key is already serialized by the time this runs, so the
 * clone cannot affect grouping.
 */
const buildCompositeGroupKey = (
  fieldPaths: readonly string[],
  values: readonly unknown[],
): Record<string, unknown> => {
  const key: Record<string, unknown> = {};
  for (let index = 0; index < fieldPaths.length; index += 1) {
    key[fieldPaths[index]] = cloneAccumulatorValue(values[index]);
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
        // An object/array group key is a reference into the stored document,
        // so it is cloned before it becomes the result's `_key` (ADR-026).
        // Serialization above ran on the original, so grouping is unaffected,
        // and the clone is taken once per group, never per document.
        groups.set(serialized, {
          key: cloneAccumulatorValue(groupKey),
          docs: [document],
        });
      }
    }
  }

  return buildGroupResults(groups, accumulators, pathCache);
};
