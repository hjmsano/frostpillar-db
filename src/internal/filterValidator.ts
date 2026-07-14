import { ValidationError } from '../errors.js';
import type { DatabaseCaches } from './databaseCaches.js';
import type { Filter } from '../types.js';
import { assertAllOperand, assertSizeOperand } from './arrayOperators.js';
import { validateFieldPath } from './documentPath.js';
import { getCachedRegex } from './filterCache.js';
import {
  assertExistsOperand,
  assertInclusionOperand,
  isOperatorExpression,
} from './filterOperatorEvaluators.js';
import {
  MAX_FILTER_NESTING_DEPTH,
  MAX_LOGICAL_OPERAND_COUNT,
} from './limits.js';
import {
  hasAnyKey,
  hasOwn,
  isObjectRecord,
  isPlainObject,
  isReservedKey,
} from './objectUtils.js';

/** Operators accepted inside a field condition (`{ field: { $op: … } }`). */
export const FIELD_OPERATORS = new Set([
  '$eq',
  '$ne',
  '$gt',
  '$gte',
  '$lt',
  '$lte',
  '$in',
  '$nin',
  '$not',
  '$regex',
  '$exists',
  '$elemMatch',
  '$all',
  '$size',
]);

export const assertLogicalOperand = (
  operator: '$and' | '$or',
  value: unknown,
): Filter[] => {
  if (!Array.isArray(value)) {
    throw new ValidationError(
      `${operator} expects an array of filter objects.`,
    );
  }

  if (value.length > MAX_LOGICAL_OPERAND_COUNT) {
    throw new ValidationError(
      `${operator} array exceeds maximum of ${String(MAX_LOGICAL_OPERAND_COUNT)} elements.`,
    );
  }

  for (const element of value) {
    if (!isPlainObject(element)) {
      throw new ValidationError(
        `${operator} array elements must be plain filter objects.`,
      );
    }
  }

  return value as Filter[];
};

const assertDepth = (depth: number): void => {
  if (depth > MAX_FILTER_NESTING_DEPTH) {
    throw new ValidationError(
      `Filter nesting depth exceeds maximum of ${String(MAX_FILTER_NESTING_DEPTH)}.`,
    );
  }
};

const validateOperand = (
  operator: string,
  operand: unknown,
  depth: number,
  caches: DatabaseCaches,
): void => {
  switch (operator) {
    case '$in':
    case '$nin':
      assertInclusionOperand(operand, operator);
      return;
    case '$all':
      assertAllOperand(operand);
      return;
    case '$size':
      assertSizeOperand(operand);
      return;
    case '$exists':
      assertExistsOperand(operand);
      return;
    case '$regex':
      // Compiles (and caches) the pattern, so an unsafe or malformed pattern is
      // rejected here rather than on the first string field value it meets.
      getCachedRegex(operand, caches.regexStringCache);
      return;
    case '$not':
      validateConditionValue(operand, depth + 1, caches);
      return;
    case '$elemMatch':
      validateElemMatchOperand(operand, depth, caches);
      return;
    default:
      // $eq / $ne / $gt / $gte / $lt / $lte accept any operand: a type mismatch
      // against the stored value is a non-match, not an error (see
      // `evaluateComparison`).
      return;
  }
};

const validateElemMatchOperand = (
  operand: unknown,
  depth: number,
  caches: DatabaseCaches,
): void => {
  // A non-object operand can never match an array element, which `$elemMatch`
  // reports as a non-match rather than an error; mirror that here instead of
  // tightening the contract.
  if (!isObjectRecord(operand)) return;
  if (isOperatorExpression(operand)) {
    validateOperatorExpression(operand, depth + 1, caches);
    return;
  }
  validateFilterStructure(operand, depth + 1, caches);
};

const validateOperatorExpression = (
  expression: Record<string, unknown>,
  depth: number,
  caches: DatabaseCaches,
): void => {
  for (const operator in expression) {
    if (!hasOwn(expression, operator)) continue;
    if (!FIELD_OPERATORS.has(operator)) {
      throw new ValidationError(`Unknown filter operator "${operator}".`);
    }
    validateOperand(operator, expression[operator], depth, caches);
  }
};

const validateConditionValue = (
  condition: unknown,
  depth: number,
  caches: DatabaseCaches,
): void => {
  assertDepth(depth);
  // `isOperatorExpression` also rejects a condition that mixes operator keys
  // with regular keys. A non-operator condition is a literal compared by deep
  // equality, so it carries no structure to validate.
  if (isOperatorExpression(condition)) {
    validateOperatorExpression(condition, depth, caches);
  }
};

const validateFilterStructure = (
  filter: unknown,
  depth: number,
  caches: DatabaseCaches,
): void => {
  if (!isPlainObject(filter)) {
    throw new ValidationError('Filter must be a plain object.');
  }
  if (!hasAnyKey(filter)) return;
  assertDepth(depth);

  for (const key in filter) {
    if (!hasOwn(filter, key)) continue;
    const condition = filter[key];

    if (isReservedKey(key)) {
      throw new ValidationError(`Filter contains reserved key "${key}".`);
    }

    if (key === '$and' || key === '$or') {
      for (const element of assertLogicalOperand(key, condition)) {
        validateFilterStructure(element, depth + 1, caches);
      }
      continue;
    }

    if (key.startsWith('$')) {
      throw new ValidationError(`Unknown filter operator "${key}".`);
    }

    validateFieldPath(key);
    validateConditionValue(condition, depth, caches);
  }
};

/**
 * Eagerly validates a filter's structure — reserved keys, field paths, unknown
 * operators, operand shapes, `$regex` safety, logical operand shape and nesting
 * depth — independently of the data being queried.
 *
 * This must be a dedicated walk, not an evaluation against an empty document:
 * `matchesFilter` short-circuits on the first false predicate, so evaluating
 * `{ a: 1, b: { $nope: 2 } }` against `{}` stops at `a` and never inspects `b`.
 * The invalid filter was then accepted on an empty collection (and, with
 * `upsert: true`, inserted a document) while throwing on a populated one.
 * Every branch of the filter tree is visited here regardless of match outcome,
 * so a structurally invalid filter throws consistently on every query path.
 */
export const validateFilter = (
  filter: Filter | undefined,
  caches: DatabaseCaches,
): void => {
  if (filter === undefined) return;
  validateFilterStructure(filter, 0, caches);
};
