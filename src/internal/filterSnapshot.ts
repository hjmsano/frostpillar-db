import { ValidationError } from '../errors.js';
import type { Filter } from '../types.js';
import { DEFAULT_MAX_DEPTH } from './limits.js';
import { defineOwnProperty, isPlainObject } from './objectUtils.js';

interface SnapshotContext {
  readonly maxDepth: number;
  readonly valueName: string;
}

const NON_PLAIN_SNAPSHOT_PROTOTYPE: object = Object.freeze({});

const assertContainerCanBeVisited = (
  value: object,
  activePath: WeakSet<object>,
  depth: number,
  context: SnapshotContext,
): void => {
  if (depth > context.maxDepth) {
    throw new ValidationError(
      `${context.valueName} nesting depth must be <= ${context.maxDepth}.`,
    );
  }
  if (activePath.has(value)) {
    throw new ValidationError(
      `Circular ${context.valueName.toLowerCase()} references are not supported.`,
    );
  }
};

const snapshotRegExp = (
  value: RegExp,
  activePath: WeakSet<object>,
  depth: number,
  context: SnapshotContext,
): RegExp => {
  assertContainerCanBeVisited(value, activePath, depth, context);
  activePath.add(value);
  try {
    let enumerableKeys: string[];
    let source: string;
    let flags: string;
    let copy: RegExp;
    try {
      // Object.keys discovers the enumerable shape without invoking its value
      // getters. `source` and `flags` are then read exactly once, including when
      // an own enumerable accessor shadows either inherited RegExp getter.
      enumerableKeys = Object.keys(value);
      source = value.source;
      flags = value.flags;
      copy = new RegExp(source, flags);
    } catch {
      throw new ValidationError('Invalid RegExp comparison operand.');
    }
    const record = value as unknown as Record<string, unknown>;

    for (const key of enumerableKeys) {
      const nested =
        key === 'source' ? source : key === 'flags' ? flags : record[key];
      Object.defineProperty(copy, key, {
        configurable: true,
        enumerable: true,
        value: snapshotValue(nested, activePath, depth + 1, context),
        writable: true,
      });
    }
    return copy;
  } finally {
    activePath.delete(value);
  }
};

const snapshotDate = (value: Date): Date => {
  try {
    return new Date(Date.prototype.getTime.call(value));
  } catch {
    throw new ValidationError('Invalid Date comparison operand.');
  }
};

const classifyObject = (
  value: object,
): 'date' | 'other' | 'plain' | 'regexp' => {
  let prototype: object | null = Object.getPrototypeOf(value) as object | null;
  if (prototype === Object.prototype || prototype === null) return 'plain';
  while (prototype !== null) {
    if (prototype === Date.prototype) return 'date';
    if (prototype === RegExp.prototype) return 'regexp';
    prototype = Object.getPrototypeOf(prototype) as object | null;
  }
  return 'other';
};

const snapshotObjectShape = (
  value: object,
  activePath: WeakSet<object>,
  depth: number,
  context: SnapshotContext,
  plain: boolean,
): Record<string, unknown> => {
  assertContainerCanBeVisited(value, activePath, depth, context);
  activePath.add(value);
  try {
    const copy = (
      plain ? {} : Object.create(NON_PLAIN_SNAPSHOT_PROTOTYPE)
    ) as Record<string, unknown>;
    for (const [key, nested] of Object.entries(value)) {
      defineOwnProperty(
        copy,
        key,
        snapshotValue(nested, activePath, depth + 1, context),
      );
    }
    return copy;
  } finally {
    activePath.delete(value);
  }
};

const snapshotValue = (
  value: unknown,
  activePath: WeakSet<object>,
  depth: number,
  context: SnapshotContext,
): unknown => {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    assertContainerCanBeVisited(value, activePath, depth, context);
    activePath.add(value);
    try {
      const copy: unknown[] = [];
      for (const element of value) {
        copy.push(snapshotValue(element, activePath, depth + 1, context));
      }
      return copy;
    } finally {
      activePath.delete(value);
    }
  }

  const objectKind = classifyObject(value);
  if (objectKind === 'regexp') {
    return snapshotRegExp(value as RegExp, activePath, depth, context);
  }
  if (objectKind === 'date') return snapshotDate(value as Date);

  // Comparison semantics use own enumerable properties for every other
  // object, including class instances, Map, and Set. Capture that shape in an
  // owned object so evaluation never touches the caller's object again. A
  // private non-plain prototype marker preserves structural-filter rejection.
  return snapshotObjectShape(
    value,
    activePath,
    depth,
    context,
    objectKind === 'plain',
  );
};

const snapshotRootFilter = (
  filter: Record<string, unknown>,
  maxDepth: number,
): Filter => {
  // The root was classified by the caller immediately before this function.
  // Snapshot its entries directly so a Proxy receives no second prototype read.
  return snapshotObjectShape(
    filter,
    new WeakSet<object>(),
    0,
    { maxDepth, valueName: 'Filter' },
    true,
  ) as Filter;
};

/**
 * Detaches a caller-supplied filter from the query that uses it: returns a deep
 * copy built by reading every own enumerable property exactly once.
 *
 * The caller's root is classified once, then passed directly to the snapshot
 * pass. This matters for a `Proxy`, whose `getPrototypeOf` trap may answer each
 * read differently. Comparison objects are represented by their own enumerable
 * shape; `Date` and `RegExp` retain their query semantics through private copies.
 *
 * Throws `ValidationError` on a non-plain root, a cycle, or nesting past
 * `maxDepth`.
 */
export const snapshotFilter = (
  filter: Filter,
  maxDepth: number = DEFAULT_MAX_DEPTH,
): Filter => {
  if (!isPlainObject(filter)) {
    throw new ValidationError('Filter must be a plain object.');
  }
  return snapshotRootFilter(filter, maxDepth);
};

/** Detaches a comparison operand such as a `$pull` value. */
export const snapshotComparisonValue = (
  value: unknown,
  maxDepth: number = DEFAULT_MAX_DEPTH,
  depth = 0,
): unknown => {
  return snapshotValue(value, new WeakSet<object>(), depth, {
    maxDepth,
    valueName: 'Comparison value',
  });
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
  if (filter === undefined) return undefined;
  if (!isPlainObject(filter)) {
    throw new ValidationError(`${methodName}: filter must be a plain object.`);
  }
  return snapshotRootFilter(filter, maxDepth);
};

/** As above, for the entry points where the filter is required (`update`, `remove`). */
export const snapshotRequiredFilterArgument = (
  filter: Filter,
  methodName: string,
  maxDepth: number = DEFAULT_MAX_DEPTH,
): Filter => {
  if ((filter as unknown) === undefined) {
    throw new ValidationError(
      `${methodName}: filter argument is required and must be a plain object.`,
    );
  }
  if (!isPlainObject(filter)) {
    throw new ValidationError(`${methodName}: filter must be a plain object.`);
  }
  return snapshotRootFilter(filter, maxDepth);
};
