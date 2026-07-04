import { ValidationError } from '../errors.js';
import type { FrostpillarStoredDocument, UpdateOperations } from '../types.js';
import { deepEqual } from './deepEqual.js';
import {
  getValueByPath,
  PATH_NOT_FOUND,
  setValueByPath,
  unsetValueByPath,
} from './documentPath.js';
import { DEFAULT_MAX_DEPTH } from './limits.js';
import { cloneDocument, hasOwn } from './objectUtils.js';
import { applyPush, applyPull, applyAddToSet } from './updateArrayOperators.js';
import { normalizeUpdateOperations } from './updateValidator.js';

export interface ApplyUpdateResult {
  document: FrostpillarStoredDocument;
  changed: boolean;
}

const applySet = (
  target: Record<string, unknown>,
  values: Record<string, unknown>,
  pathCache: Map<string, string[]>,
): boolean => {
  let changed = false;
  for (const path in values) {
    if (!hasOwn(values, path)) continue;
    const value = values[path];
    const resolved = getValueByPath(target, path, pathCache);
    if (resolved !== PATH_NOT_FOUND && deepEqual(resolved, value)) {
      continue;
    }
    setValueByPath(target, path, value, pathCache);
    changed = true;
  }
  return changed;
};

const applyUnset = (
  target: Record<string, unknown>,
  values: Record<string, unknown>,
  pathCache: Map<string, string[]>,
): boolean => {
  let changed = false;
  for (const path of Object.keys(values)) {
    if (unsetValueByPath(target, path, pathCache)) {
      changed = true;
    }
  }
  return changed;
};

const applyInc = (
  target: Record<string, unknown>,
  values: Record<string, unknown>,
  pathCache: Map<string, string[]>,
): boolean => {
  let changed = false;
  for (const path in values) {
    if (!hasOwn(values, path)) continue;
    const rawIncrement = values[path];
    const increment = rawIncrement as number;
    const resolved = getValueByPath(target, path, pathCache);
    if (resolved === PATH_NOT_FOUND) {
      setValueByPath(target, path, increment, pathCache);
      changed = true;
      continue;
    }

    if (typeof resolved !== 'number') {
      throw new ValidationError('$inc target field must be a number.');
    }

    if (increment === 0) {
      continue;
    }

    const result = resolved + increment;
    if (!Number.isFinite(result)) {
      throw new ValidationError('$inc result must be a finite number.');
    }
    setValueByPath(target, path, result, pathCache);
    changed = true;
  }
  return changed;
};

const applyRename = (
  target: Record<string, unknown>,
  values: Record<string, unknown>,
  pathCache: Map<string, string[]>,
): boolean => {
  let changed = false;
  for (const sourcePath in values) {
    if (!hasOwn(values, sourcePath)) continue;
    const destinationRaw = values[sourcePath];
    const destinationPath = destinationRaw as string;
    if (sourcePath === destinationPath) {
      continue;
    }

    const resolved = getValueByPath(target, sourcePath, pathCache);
    if (resolved === PATH_NOT_FOUND) {
      continue;
    }

    const destinationResolved = getValueByPath(
      target,
      destinationPath,
      pathCache,
    );
    if (destinationResolved !== PATH_NOT_FOUND) {
      throw new ValidationError(
        `$rename cannot overwrite existing destination field "${destinationPath}" from source "${sourcePath}". Use $unset to remove the destination field first.`,
      );
    }

    unsetValueByPath(target, sourcePath, pathCache);
    setValueByPath(target, destinationPath, resolved, pathCache);
    changed = true;
  }
  return changed;
};

export const applyUpdateOperations = (
  document: FrostpillarStoredDocument,
  operations: UpdateOperations,
  pathCache: Map<string, string[]>,
  protectCreatedAt = false,
  maxDepth: number = DEFAULT_MAX_DEPTH,
): ApplyUpdateResult => {
  const normalized = normalizeUpdateOperations(
    operations,
    protectCreatedAt,
    maxDepth,
  );
  const operationCount =
    Object.keys(normalized.set).length +
    Object.keys(normalized.unset).length +
    Object.keys(normalized.inc).length +
    Object.keys(normalized.rename).length +
    Object.keys(normalized.push).length +
    Object.keys(normalized.pull).length +
    Object.keys(normalized.addToSet).length;

  if (operationCount === 0) {
    return { document, changed: false };
  }

  const next = cloneDocument(document) as Record<string, unknown>;
  const dirtySet = applySet(next, normalized.set, pathCache);
  const dirtyUnset = applyUnset(next, normalized.unset, pathCache);
  const dirtyInc = applyInc(next, normalized.inc, pathCache);
  const dirtyRename = applyRename(next, normalized.rename, pathCache);
  const dirtyPush = applyPush(next, normalized.push, pathCache);
  const dirtyPull = applyPull(next, normalized.pull, pathCache);
  const dirtyAddToSet = applyAddToSet(next, normalized.addToSet, pathCache);
  const dirty =
    dirtySet ||
    dirtyUnset ||
    dirtyInc ||
    dirtyRename ||
    dirtyPush ||
    dirtyPull ||
    dirtyAddToSet;

  if (typeof next._id !== 'string' || next._id.length === 0) {
    throw new ValidationError('Updated document must contain immutable _id.');
  }

  const updatedDocument = next as FrostpillarStoredDocument;
  return { document: updatedDocument, changed: dirty };
};
