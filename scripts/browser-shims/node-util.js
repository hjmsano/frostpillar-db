/**
 * Minimal browser shim for node:util.
 *
 * NOTE: This file is no longer referenced by the build (see ADR-013).
 * The --alias:node:util=... flag was removed from scripts/build.mjs after
 * WI-2 replaced all node:util.isDeepStrictEqual call-sites with the internal
 * src/internal/deepEqual.ts utility. This file is kept for historical
 * reference and can be deleted.
 */

function isDeepStrictEqual(a, b) {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== typeof b) return false;

  if (typeof a !== 'object') return false;

  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!isDeepStrictEqual(a[i], b[i])) return false;
    }
    return true;
  }

  if (Array.isArray(b)) return false;

  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;

  for (const key of keysA) {
    if (!Object.prototype.hasOwnProperty.call(b, key)) return false;
    if (!isDeepStrictEqual(a[key], b[key])) return false;
  }

  return true;
}

export { isDeepStrictEqual };
