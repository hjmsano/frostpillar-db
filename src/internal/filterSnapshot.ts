import { ValidationError } from '../errors.js';
import type { Filter } from '../types.js';
import { validateFilterArgument } from './filterUtils.js';
import { DEFAULT_MAX_DEPTH } from './limits.js';
import { defineOwnProperty, isPlainObject } from './objectUtils.js';

const snapshotValue = (
  value: unknown,
  activePath: WeakSet<object>,
  depth: number,
  maxDepth: number,
): unknown => {
  if (value === null || typeof value !== 'object') return value;
  // A `RegExp` is carried by reference: it is the `$regex` operand itself, and
  // `getCachedRegex` reads its `source`/`flags` once and compiles a private
  // copy. Copying it structurally would turn it into `{}`.
  if (value instanceof RegExp) return value;

  if (depth > maxDepth) {
    throw new ValidationError(`Filter nesting depth must be <= ${maxDepth}.`);
  }
  if (activePath.has(value)) {
    throw new ValidationError('Circular filter references are not supported.');
  }

  if (Array.isArray(value)) {
    activePath.add(value);
    const copy: unknown[] = [];
    for (const element of value) {
      copy.push(snapshotValue(element, activePath, depth + 1, maxDepth));
    }
    activePath.delete(value);
    return copy;
  }

  // Any other non-plain object (a `Date`, a `Map`, a class instance) is a leaf
  // operand: it is only ever compared against stored values, never stored, and
  // deep-equality against a JSON-safe document does not read through it. Carry
  // it by reference rather than mangling it into a structural copy.
  if (!isPlainObject(value)) return value;

  activePath.add(value);
  const copy: Record<string, unknown> = {};
  // `Object.entries` reads each own enumerable property exactly once, and that
  // single read is what lands in the snapshot.
  for (const [key, nested] of Object.entries(value)) {
    defineOwnProperty(
      copy,
      key,
      snapshotValue(nested, activePath, depth + 1, maxDepth),
    );
  }
  activePath.delete(value);
  return copy;
};

/**
 * Detaches a caller-supplied filter from the query that uses it: returns a deep
 * copy built by reading every own enumerable property exactly once.
 *
 * A filter is read many times over the life of one call — the structural
 * validator walks it, `matchesFilter` re-walks it per candidate document, and
 * the `_id` fast paths read it on both sides of an `await`. Reading the
 * caller's object each time made every one of those reads independently
 * forgeable: an accessor property (or a Proxy `get` trap) answered the
 * validator with one `$and` array and the evaluator with another, which removed
 * documents the validated filter never matched, and a plain array operand
 * mutated during an `await` changed the set of `_id`s a `remove()` had already
 * validated. Snapshotting first makes the validated filter and the evaluated
 * filter the same immutable object (ADR-030).
 *
 * `maxDepth` bounds the recursion, which is otherwise unbounded: operand values
 * carry arbitrary caller structure (`{ a: { $eq: <deep object> } }`), unlike the
 * `$and`/`$or` nesting that `MAX_FILTER_NESTING_DEPTH` already caps.
 *
 * Throws `ValidationError` on a cycle or on nesting past `maxDepth`.
 */
export const snapshotFilter = (
  filter: Filter,
  maxDepth: number = DEFAULT_MAX_DEPTH,
): Filter => {
  return snapshotValue(filter, new WeakSet<object>(), 0, maxDepth) as Filter;
};

/**
 * Validates an optional filter argument at a `Collection` entry point and
 * returns the detached snapshot every downstream stage must use. For the
 * methods that accept no filter (`find`, `findOne`, `count`), `undefined`
 * passes through.
 */
export const snapshotOptionalFilterArgument = (
  filter: Filter | undefined,
  methodName: string,
  maxDepth: number = DEFAULT_MAX_DEPTH,
): Filter | undefined => {
  validateFilterArgument(filter, methodName, true);
  if (filter === undefined) return undefined;
  return snapshotFilter(filter, maxDepth);
};

/** As above, for the entry points where the filter is required (`update`, `remove`). */
export const snapshotRequiredFilterArgument = (
  filter: Filter,
  methodName: string,
  maxDepth: number = DEFAULT_MAX_DEPTH,
): Filter => {
  validateFilterArgument(filter, methodName, false);
  return snapshotFilter(filter, maxDepth);
};
