import { ValidationError } from '../errors.js';
import {
  getValueByPath,
  PATH_NOT_FOUND,
  setValueByPath,
  unsetValueByPath,
  validateFieldPath,
} from './documentPath.js';
import { cloneDocument, hasOwn, isObjectRecord } from './objectUtils.js';
import type {
  FrostpillarDocument,
  FrostpillarStoredDocument,
  ProjectionSpec,
  ProjectionValue,
} from '../types.js';

export const cloneProjectionSpec = (spec: ProjectionSpec): ProjectionSpec => {
  if (!isObjectRecord(spec)) {
    throw new ValidationError('Projection spec must be an object.');
  }

  let hasInclude = false;
  let hasExclude = false;
  const normalizedEntries: [string, ProjectionValue][] = [];

  for (const [field, mode] of Object.entries(spec)) {
    validateFieldPath(field);
    if (mode !== 0 && mode !== 1) {
      throw new ValidationError('Projection spec values must be 0 or 1.');
    }

    if (mode === 1) {
      hasInclude = true;
    }
    if (mode === 0 && field !== '_id') {
      hasExclude = true;
    }

    normalizedEntries.push([field, mode]);
  }

  if (hasInclude && hasExclude) {
    throw new ValidationError(
      'Projection cannot mix inclusion and exclusion (except "_id: 0").',
    );
  }

  return Object.fromEntries(normalizedEntries) as ProjectionSpec;
};

type ProjectionMode = 'exclude' | 'include';

const resolveProjectionMode = (projection: ProjectionSpec): ProjectionMode => {
  for (const field in projection) {
    if (!hasOwn(projection as Record<string, unknown>, field)) continue;
    const value = (projection as Record<string, unknown>)[field];
    if (value === 1) {
      return 'include';
    }
  }

  return 'exclude';
};

export const applyProjection = <TDocument extends FrostpillarDocument>(
  document: FrostpillarStoredDocument<TDocument>,
  projection: ProjectionSpec,
  pathCache: Map<string, string[]>,
): FrostpillarStoredDocument<TDocument> => {
  const mode = resolveProjectionMode(projection);

  if (mode === 'include') {
    const projected: Record<string, unknown> = {};
    if (projection._id !== 0) {
      projected._id = document._id;
    }

    for (const path in projection) {
      if (!hasOwn(projection as Record<string, unknown>, path)) continue;
      const value = (projection as Record<string, unknown>)[path];
      if (path === '_id' || value !== 1) {
        continue;
      }

      const resolved = getValueByPath(
        document as Record<string, unknown>,
        path,
        pathCache,
      );
      if (resolved === PATH_NOT_FOUND) {
        continue;
      }

      // Deep-clone so projected object/array values do not alias live datastore
      // payloads; mutating query results must never corrupt stored documents.
      setValueByPath(projected, path, cloneDocument(resolved), pathCache);
    }

    return projected as FrostpillarStoredDocument<TDocument>;
  }

  const projected = cloneDocument(document) as Record<string, unknown>;
  for (const path in projection) {
    if (!hasOwn(projection as Record<string, unknown>, path)) continue;
    const value = (projection as Record<string, unknown>)[path];
    if (value !== 0) {
      continue;
    }
    unsetValueByPath(projected, path, pathCache);
  }

  return projected as FrostpillarStoredDocument<TDocument>;
};
