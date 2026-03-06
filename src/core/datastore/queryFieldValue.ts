import type {
  NativeScalar,
  PersistedTimeseriesRecord,
} from '../types.js';

export const isNativeScalar = (value: unknown): value is NativeScalar => {
  return (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  );
};

const splitCanonicalPath = (fieldPath: string): string[] => {
  const segments: string[] = [];
  let current = '';
  let escape = false;

  for (const char of fieldPath) {
    if (escape) {
      current += char;
      escape = false;
      continue;
    }

    if (char === '\\') {
      escape = true;
      continue;
    }

    if (char === '.') {
      segments.push(current);
      current = '';
      continue;
    }

    current += char;
  }

  if (escape) {
    current += '\\';
  }

  segments.push(current);
  return segments;
};

export const readFieldValue = (
  record: PersistedTimeseriesRecord,
  field: string,
): NativeScalar | undefined => {
  if (field === 'timestamp') {
    return record.timestamp;
  }

  if (field === '_id') {
    return `${record.timestamp}:${record.insertionOrder.toString(10)}`;
  }

  const segments = splitCanonicalPath(field);
  let cursor: unknown = record.payload;

  for (const segment of segments) {
    if (
      typeof cursor !== 'object' ||
      cursor === null ||
      Array.isArray(cursor) ||
      !(segment in (cursor as Record<string, unknown>))
    ) {
      return undefined;
    }

    cursor = (cursor as Record<string, unknown>)[segment];
  }

  if (isNativeScalar(cursor)) {
    return cursor;
  }

  return undefined;
};

export const compareNullableScalar = (
  left: NativeScalar | undefined,
  right: NativeScalar | undefined,
): number => {
  const leftValue = left ?? null;
  const rightValue = right ?? null;

  const rank = (value: NativeScalar): number => {
    if (value === null) {
      return 0;
    }
    if (typeof value === 'boolean') {
      return 1;
    }
    if (typeof value === 'number') {
      return 2;
    }
    return 3;
  };

  const leftRank = rank(leftValue);
  const rightRank = rank(rightValue);

  if (leftRank !== rightRank) {
    return leftRank - rightRank;
  }

  if (leftValue === rightValue) {
    return 0;
  }

  if (typeof leftValue === 'number' && typeof rightValue === 'number') {
    return leftValue < rightValue ? -1 : 1;
  }

  if (typeof leftValue === 'string' && typeof rightValue === 'string') {
    return leftValue < rightValue ? -1 : 1;
  }

  if (typeof leftValue === 'boolean' && typeof rightValue === 'boolean') {
    return leftValue === false ? -1 : 1;
  }

  return 0;
};
