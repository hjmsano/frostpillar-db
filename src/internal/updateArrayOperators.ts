import { ValidationError } from '../errors.js';
import { deepEqual } from './deepEqual.js';
import {
  getValueByPath,
  PATH_NOT_FOUND,
  setValueByPath,
} from './documentPath.js';
import { MAX_ARRAY_LENGTH } from './limits.js';

export const applyPush = (
  target: Record<string, unknown>,
  values: Record<string, unknown>,
  pathCache: Map<string, string[]>,
): boolean => {
  for (const [path, value] of Object.entries(values)) {
    const resolved = getValueByPath(target, path, pathCache);
    if (resolved === PATH_NOT_FOUND) {
      setValueByPath(target, path, [value], pathCache);
      continue;
    }

    if (!Array.isArray(resolved)) {
      throw new ValidationError('$push target field must be an array.');
    }

    if (resolved.length >= MAX_ARRAY_LENGTH) {
      throw new ValidationError(
        `$push would exceed maximum array length of ${String(MAX_ARRAY_LENGTH)}.`,
      );
    }

    resolved.push(value);
  }
  return Object.keys(values).length > 0;
};

export const applyPull = (
  target: Record<string, unknown>,
  values: Record<string, unknown>,
  pathCache: Map<string, string[]>,
): boolean => {
  let changed = false;
  for (const [path, value] of Object.entries(values)) {
    const resolved = getValueByPath(target, path, pathCache);
    if (resolved === PATH_NOT_FOUND) {
      continue;
    }

    if (!Array.isArray(resolved)) {
      throw new ValidationError('$pull target field must be an array.');
    }

    let hasMatch = false;
    for (const element of resolved) {
      if (deepEqual(element, value)) {
        hasMatch = true;
        break;
      }
    }
    if (!hasMatch) continue; // no-op for this path, skip to next entry

    const filtered = resolved.filter(
      (element: unknown) => !deepEqual(element, value),
    );
    changed = true;
    setValueByPath(target, path, filtered, pathCache);
  }
  return changed;
};

export const applyAddToSet = (
  target: Record<string, unknown>,
  values: Record<string, unknown>,
  pathCache: Map<string, string[]>,
): boolean => {
  let changed = false;
  for (const [path, value] of Object.entries(values)) {
    const resolved = getValueByPath(target, path, pathCache);
    if (resolved === PATH_NOT_FOUND) {
      setValueByPath(target, path, [value], pathCache);
      changed = true;
      continue;
    }

    if (!Array.isArray(resolved)) {
      throw new ValidationError('$addToSet target field must be an array.');
    }

    const alreadyExists = resolved.some((element: unknown) =>
      deepEqual(element, value),
    );
    if (!alreadyExists) {
      if (resolved.length >= MAX_ARRAY_LENGTH) {
        throw new ValidationError(
          `$addToSet would exceed maximum array length of ${String(MAX_ARRAY_LENGTH)}.`,
        );
      }
      resolved.push(value);
      changed = true;
    }
  }
  return changed;
};
