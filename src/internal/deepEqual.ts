/**
 * Environment-agnostic deep equality for the value types that can appear
 * in Frostpillar documents and filter operands:
 *   - primitives (===, with NaN === NaN)
 *   - null / undefined
 *   - Date (compared by .getTime())
 *   - plain arrays (element-by-element recursion)
 *   - plain objects (own-key-by-key recursion)
 *
 * Replaces `isDeepStrictEqual` from `node:util` in all internal call-sites
 * so that the distributed ESM files do not carry a Node.js dependency.
 *
 * See ADR-013.
 */

export const deepEqual = (a: unknown, b: unknown): boolean => {
  // Identical reference or primitive equality.
  // Note: NaN !== NaN so NaN is handled separately below.
  if (a === b) return true;

  // Undefined (already caught by === above unless mixed with another type).
  if (a === undefined || b === undefined) return false;

  // Null (same: caught by === if both null, otherwise one is null).
  if (a === null || b === null) return false;

  // Type mismatch at the typeof level.
  if (typeof a !== typeof b) return false;

  // Non-object primitives that are not strictly equal.
  // The only case where two same-type non-object values can be unequal but
  // "deeply equal" is NaN (typeof NaN === 'number').
  if (typeof a !== 'object') {
    return (
      typeof a === 'number' &&
      Number.isNaN(a) &&
      typeof b === 'number' &&
      Number.isNaN(b)
    );
  }

  // Both are non-null objects with the same typeof.

  // Date comparison.
  if (a instanceof Date || b instanceof Date) {
    return (
      a instanceof Date && b instanceof Date && a.getTime() === b.getTime()
    );
  }

  // Array comparison.
  if (Array.isArray(a) !== Array.isArray(b)) return false;

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }

  // Plain object comparison (own enumerable keys).
  const recordA = a as Record<string, unknown>;
  const recordB = b as Record<string, unknown>;

  const keysA = Object.keys(recordA);
  const keysB = Object.keys(recordB);

  if (keysA.length !== keysB.length) return false;

  for (const key of keysA) {
    if (!Object.prototype.hasOwnProperty.call(recordB, key)) return false;
    if (!deepEqual(recordA[key], recordB[key])) return false;
  }

  return true;
};
