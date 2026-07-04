import { ValidationError } from '../errors.js';
import { MAX_FIELD_PATH_DEPTH, MAX_FIELD_PATH_LENGTH } from './limits.js';
import { hasOwn, isObjectRecord, isReservedKey } from './objectUtils.js';

export const PATH_NOT_FOUND: unique symbol = Symbol('PATH_NOT_FOUND');
export type PathValue = unknown;

const MAX_PATH_CACHE_SIZE = 1024;

export const validateFieldPath = (path: string): void => {
  if (path.length === 0) {
    throw new ValidationError('Field path must be a non-empty string.');
  }

  if (path.length > MAX_FIELD_PATH_LENGTH) {
    throw new ValidationError(
      `Field path exceeds maximum length of ${String(MAX_FIELD_PATH_LENGTH)} characters.`,
    );
  }

  const segments = path.split('.');
  if (segments.some((s) => s.length === 0 || isReservedKey(s))) {
    throw new ValidationError(
      'Field path contains an invalid or restricted segment.',
    );
  }

  if (segments.length > MAX_FIELD_PATH_DEPTH) {
    throw new ValidationError(
      `Field path exceeds maximum depth of ${String(MAX_FIELD_PATH_DEPTH)} segments.`,
    );
  }
};

const splitPath = (path: string, cache: Map<string, string[]>): string[] => {
  const cached = cache.get(path);
  if (cached !== undefined) {
    // Move to MRU position by re-inserting at the end.
    cache.delete(path);
    cache.set(path, cached);
    return cached;
  }

  validateFieldPath(path);

  const segments = path.split('.');

  if (cache.size >= MAX_PATH_CACHE_SIZE) {
    // Evict the least-recently-used entry (first insertion-order key).
    const lruKey = cache.keys().next().value;
    if (lruKey !== undefined) {
      cache.delete(lruKey);
    }
  }
  cache.set(path, segments);

  return segments;
};

export const getValueByPath = (
  source: Record<string, unknown>,
  path: string,
  pathCache: Map<string, string[]>,
): PathValue => {
  const segments = splitPath(path, pathCache);
  let cursor: unknown = source;

  for (const segment of segments) {
    if (!isObjectRecord(cursor) || !hasOwn(cursor, segment)) {
      return PATH_NOT_FOUND;
    }

    cursor = cursor[segment];
  }

  return cursor;
};

export const setValueByPath = (
  target: Record<string, unknown>,
  path: string,
  value: unknown,
  pathCache: Map<string, string[]>,
): void => {
  const segments = splitPath(path, pathCache);
  let cursor: Record<string, unknown> = target;

  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index];
    const next = cursor[segment];
    if (next === undefined || next === null) {
      const created: Record<string, unknown> = {};
      cursor[segment] = created;
      cursor = created;
      continue;
    }
    if (!isObjectRecord(next)) {
      throw new ValidationError(
        'Cannot create nested field in a non-object element.',
      );
    }

    cursor = next;
  }

  const last = segments[segments.length - 1];
  cursor[last] = value;
};

export const unsetValueByPath = (
  target: Record<string, unknown>,
  path: string,
  pathCache: Map<string, string[]>,
): boolean => {
  const segments = splitPath(path, pathCache);
  let cursor: unknown = target;

  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index];
    if (!isObjectRecord(cursor) || !hasOwn(cursor, segment)) {
      return false;
    }

    cursor = cursor[segment];
  }

  if (!isObjectRecord(cursor)) {
    return false;
  }

  const last = segments[segments.length - 1];
  if (!hasOwn(cursor, last)) {
    return false;
  }

  delete cursor[last];
  return true;
};
