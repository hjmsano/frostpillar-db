import { ValidationError } from '../errors.js';
import {
  getValueByPath,
  PATH_NOT_FOUND,
  validateFieldPath,
} from './documentPath.js';
import { isObjectRecord } from './objectUtils.js';
import type {
  FrostpillarDocument,
  FrostpillarStoredDocument,
  SortDirection,
  SortInput,
  SortSpecEntries,
} from '../types.js';

export const cloneSortSpec = (spec: SortInput): [string, SortDirection][] => {
  if (Array.isArray(spec)) {
    const normalizedEntries: [string, SortDirection][] = [];
    const seen = new Set<string>();
    for (const entry of spec) {
      if (!Array.isArray(entry) || entry.length !== 2) {
        throw new ValidationError(
          'Sort spec array entries must be [field, direction] tuples.',
        );
      }
      const [field, direction] = entry as [unknown, unknown];
      if (typeof field !== 'string') {
        throw new ValidationError(
          'Sort spec array entries must be [field, direction] tuples.',
        );
      }
      validateFieldPath(field);
      if (direction !== 1 && direction !== -1) {
        throw new ValidationError('Sort spec values must be 1 or -1.');
      }
      if (seen.has(field)) {
        throw new ValidationError(
          `Sort spec contains duplicate field "${field}".`,
        );
      }
      seen.add(field);
      normalizedEntries.push([field, direction]);
    }
    return normalizedEntries;
  }

  if (!isObjectRecord(spec)) {
    throw new ValidationError(
      'Sort spec must be an object or an array of [field, direction] entries.',
    );
  }

  const normalizedEntries: [string, SortDirection][] = [];
  for (const [field, direction] of Object.entries(spec)) {
    validateFieldPath(field);
    if (direction !== 1 && direction !== -1) {
      throw new ValidationError('Sort spec values must be 1 or -1.');
    }
    normalizedEntries.push([field, direction]);
  }
  return normalizedEntries;
};

const valueRank = (value: unknown): number => {
  if (value === undefined) {
    return 0;
  }
  if (value === null) {
    return 1;
  }

  switch (typeof value) {
    case 'number':
      return 2;
    case 'string':
      return 3;
    case 'boolean':
      return 4;
    default:
      return 5;
  }
};

/**
 * Caches the canonical JSON key used to order object/array-valued sort fields,
 * keyed by value identity. Frostpillar documents are treated as immutable —
 * updates replace records wholesale rather than mutating nested values in place
 * (see cloneDocument's JSON-safety contract) — so a value object's serialization
 * is stable for its lifetime, making identity-keyed caching safe. The WeakMap
 * lets entries be reclaimed once the value is no longer referenced.
 */
const sortJsonKeyCache = new WeakMap<object, string>();

const canonicalSortKey = (value: unknown): string => {
  if (value !== null && typeof value === 'object') {
    const cached = sortJsonKeyCache.get(value);
    if (cached !== undefined) return cached;
    const serialized = JSON.stringify(value);
    sortJsonKeyCache.set(value, serialized);
    return serialized;
  }
  return JSON.stringify(value);
};

const compareUnknownValues = (left: unknown, right: unknown): number => {
  if (Object.is(left, right)) {
    return 0;
  }

  if (typeof left === 'number' && typeof right === 'number') {
    if (Number.isNaN(left)) {
      return Number.isNaN(right) ? 0 : -1;
    }
    if (Number.isNaN(right)) {
      return 1;
    }

    return left < right ? -1 : 1;
  }

  if (typeof left === 'string' && typeof right === 'string') {
    return left < right ? -1 : left > right ? 1 : 0;
  }

  if (typeof left === 'boolean' && typeof right === 'boolean') {
    if (left === right) {
      return 0;
    }

    return left ? 1 : -1;
  }

  const leftRank = valueRank(left);
  const rightRank = valueRank(right);
  if (leftRank !== rightRank) {
    return leftRank < rightRank ? -1 : 1;
  }

  const leftJson = canonicalSortKey(left);
  const rightJson = canonicalSortKey(right);
  return leftJson < rightJson ? -1 : leftJson > rightJson ? 1 : 0;
};

const compareByPath = (
  leftDocument: Record<string, unknown>,
  rightDocument: Record<string, unknown>,
  path: string,
  pathCache: Map<string, string[]>,
): number => {
  const leftValue = getValueByPath(leftDocument, path, pathCache);
  const rightValue = getValueByPath(rightDocument, path, pathCache);

  if (leftValue === PATH_NOT_FOUND && rightValue === PATH_NOT_FOUND) {
    return 0;
  }
  if (leftValue === PATH_NOT_FOUND) {
    return -1;
  }
  if (rightValue === PATH_NOT_FOUND) {
    return 1;
  }

  return compareUnknownValues(leftValue, rightValue);
};

const makeComparator = <TDocument extends FrostpillarDocument>(
  sortEntries: SortSpecEntries,
  pathCache: Map<string, string[]>,
): ((
  a: FrostpillarStoredDocument<TDocument>,
  b: FrostpillarStoredDocument<TDocument>,
) => number) => {
  return (a, b) => {
    for (const [path, direction] of sortEntries) {
      const compared = compareByPath(
        a as Record<string, unknown>,
        b as Record<string, unknown>,
        path,
        pathCache,
      );
      if (compared !== 0) {
        return direction === 1 ? compared : -compared;
      }
    }
    return 0;
  };
};

const siftUpMax = <T>(
  heap: T[],
  i: number,
  compare: (a: T, b: T) => number,
): void => {
  while (i > 0) {
    const parent = (i - 1) >> 1;
    if (compare(heap[i], heap[parent]) <= 0) break;
    [heap[i], heap[parent]] = [heap[parent], heap[i]];
    i = parent;
  }
};

const siftDownMax = <T>(
  heap: T[],
  k: number,
  compare: (a: T, b: T) => number,
): void => {
  let i = 0;
  while (true) {
    let largest = i;
    const left = 2 * i + 1;
    const right = 2 * i + 2;
    if (left < k && compare(heap[left], heap[largest]) > 0) largest = left;
    if (right < k && compare(heap[right], heap[largest]) > 0) largest = right;
    if (largest === i) break;
    [heap[i], heap[largest]] = [heap[largest], heap[i]];
    i = largest;
  }
};

const topK = <T>(
  items: T[],
  k: number,
  compare: (a: T, b: T) => number,
): T[] => {
  const heap: T[] = [];

  for (const item of items) {
    if (heap.length < k) {
      heap.push(item);
      siftUpMax(heap, heap.length - 1, compare);
    } else if (compare(item, heap[0]) < 0) {
      heap[0] = item;
      siftDownMax(heap, k, compare);
    }
  }

  heap.sort(compare);
  return heap;
};

export const applySort = <TDocument extends FrostpillarDocument>(
  documents: FrostpillarStoredDocument<TDocument>[],
  sortEntries: SortSpecEntries,
  pathCache: Map<string, string[]>,
  limit?: number,
): FrostpillarStoredDocument<TDocument>[] => {
  if (sortEntries.length === 0) {
    return documents;
  }

  const compare = makeComparator<TDocument>(sortEntries, pathCache);

  if (limit !== undefined && limit < documents.length) {
    const decorated = documents.map((doc, index) => ({ doc, index }));
    const stableCompare = (
      a: { doc: FrostpillarStoredDocument<TDocument>; index: number },
      b: { doc: FrostpillarStoredDocument<TDocument>; index: number },
    ): number => {
      const result = compare(a.doc, b.doc);
      return result !== 0 ? result : a.index - b.index;
    };
    return topK(decorated, limit, stableCompare).map((entry) => entry.doc);
  }

  const copy = documents.slice();
  copy.sort(compare);
  return copy;
};
