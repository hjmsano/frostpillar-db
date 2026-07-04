import { ValidationError } from '../errors.js';
import { deepEqual } from './deepEqual.js';
import type { DatabaseCaches } from './databaseCaches.js';
import type { Filter } from '../types.js';
import { evaluateAll, evaluateSize } from './arrayOperators.js';
import {
  getValueByPath,
  PATH_NOT_FOUND,
  type PathValue,
} from './documentPath.js';
import {
  MAX_FILTER_NESTING_DEPTH,
  MAX_LOGICAL_OPERAND_COUNT,
} from './limits.js';
import {
  hasAnyKey,
  hasOwn,
  isObjectRecord,
  isReservedKey,
} from './objectUtils.js';
import {
  evaluateElemMatch,
  evaluateExists,
  evaluateInclusion,
  evaluateRegex,
  isOperatorExpression,
  isPrimitive,
} from './filterOperatorEvaluators.js';

const FIELD_OPERATORS = new Set([
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

type ComparableValue = string | number | boolean;

const isComparableValue = (value: unknown): value is ComparableValue => {
  return (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  );
};

/**
 * Evaluates an ordering comparison between two values.
 *
 * **Cross-type comparisons always return `false` by design.**
 * This mirrors MongoDB semantics: if the document field type differs from the
 * operand type (e.g. a numeric `age` field queried with `{ $gt: '30' }`), the
 * predicate evaluates to `false` and the document is excluded from results.
 * No type coercion is attempted. If a query unexpectedly returns zero results,
 * verify that the operand type matches the stored field type.
 */
const evaluateComparison = (
  left: unknown,
  right: unknown,
  operator: '$gt' | '$gte' | '$lt' | '$lte',
): boolean => {
  if (!isComparableValue(left) || !isComparableValue(right)) {
    return false;
  }

  if (typeof left !== typeof right) {
    return false;
  }

  switch (operator) {
    case '$gt':
      return left > right;
    case '$gte':
      return left >= right;
    case '$lt':
      return left < right;
    case '$lte':
      return left <= right;
  }
};

const evaluateElemMatchWithContext = (
  resolved: PathValue,
  operand: unknown,
  depth: number,
  caches: DatabaseCaches,
): boolean => {
  return evaluateElemMatch(
    resolved,
    operand,
    depth,
    (r: PathValue, e: Record<string, unknown>, d: number) =>
      evaluateOperatorExpression(r, e, d, caches),
    (doc: Record<string, unknown>, f: Record<string, unknown>, d: number) =>
      matchesFilterInternal(doc, f, d, caches),
  );
};

const evaluateOperator = (
  resolved: PathValue,
  operator: string,
  operand: unknown,
  depth: number,
  caches: DatabaseCaches,
): boolean => {
  switch (operator) {
    case '$eq':
      if (isPrimitive(operand)) {
        return resolved !== PATH_NOT_FOUND && resolved === operand;
      }
      return resolved !== PATH_NOT_FOUND && deepEqual(resolved, operand);
    case '$ne':
      if (isPrimitive(operand)) {
        return resolved === PATH_NOT_FOUND || resolved !== operand;
      }
      return resolved === PATH_NOT_FOUND || !deepEqual(resolved, operand);
    case '$gt':
    case '$gte':
    case '$lt':
    case '$lte':
      return (
        resolved !== PATH_NOT_FOUND &&
        evaluateComparison(resolved, operand, operator)
      );
    case '$in':
    case '$nin':
      return evaluateInclusion(resolved, operand, operator);
    case '$not':
      return !evaluateConditionValue(resolved, operand, depth + 1, caches);
    case '$regex':
      return evaluateRegex(resolved, operand, caches.regexStringCache);
    case '$exists':
      return evaluateExists(resolved, operand);
    case '$elemMatch':
      return evaluateElemMatchWithContext(resolved, operand, depth, caches);
    case '$all':
      return evaluateAll(resolved, operand);
    case '$size':
      return evaluateSize(resolved, operand);
    default:
      throw new ValidationError(`Unknown filter operator "${operator}".`);
  }
};

const evaluateOperatorExpression = (
  resolved: PathValue,
  expression: Record<string, unknown>,
  depth: number,
  caches: DatabaseCaches,
): boolean => {
  for (const operator in expression) {
    if (!hasOwn(expression, operator)) continue;
    const operand = expression[operator];
    if (!FIELD_OPERATORS.has(operator)) {
      throw new ValidationError(`Unknown filter operator "${operator}".`);
    }

    if (!evaluateOperator(resolved, operator, operand, depth, caches)) {
      return false;
    }
  }

  return true;
};

const evaluateConditionValue = (
  resolved: PathValue,
  condition: unknown,
  depth = 0,
  caches: DatabaseCaches,
): boolean => {
  if (depth > MAX_FILTER_NESTING_DEPTH) {
    throw new ValidationError(
      `Filter nesting depth exceeds maximum of ${String(MAX_FILTER_NESTING_DEPTH)}.`,
    );
  }
  if (isOperatorExpression(condition)) {
    return evaluateOperatorExpression(resolved, condition, depth, caches);
  }

  if (isPrimitive(condition)) {
    return resolved !== PATH_NOT_FOUND && resolved === condition;
  }

  return resolved !== PATH_NOT_FOUND && deepEqual(resolved, condition);
};

const assertLogicalOperand = (
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
    if (!isObjectRecord(element)) {
      throw new ValidationError(
        `${operator} array elements must be filter objects.`,
      );
    }
  }

  return value as Filter[];
};

const evaluateLogicalOperator = (
  operator: '$and' | '$or',
  condition: unknown,
  document: Record<string, unknown>,
  depth: number,
  caches: DatabaseCaches,
): boolean => {
  const filters = assertLogicalOperand(operator, condition);
  const check = (item: Filter) =>
    matchesFilterInternal(document, item, depth + 1, caches);
  return operator === '$and' ? filters.every(check) : filters.some(check);
};

const matchesFilterInternal = (
  document: Record<string, unknown>,
  filter: Filter | undefined,
  depth: number,
  caches: DatabaseCaches,
): boolean => {
  if (filter === undefined || !hasAnyKey(filter)) return true;
  if (!isObjectRecord(filter)) {
    throw new ValidationError('Filter must be an object.');
  }
  if (depth > MAX_FILTER_NESTING_DEPTH) {
    throw new ValidationError(
      `Filter nesting depth exceeds maximum of ${String(MAX_FILTER_NESTING_DEPTH)}.`,
    );
  }
  for (const key in filter) {
    if (!hasOwn(filter as Record<string, unknown>, key)) continue;
    const condition = (filter as Record<string, unknown>)[key];
    if (isReservedKey(key)) {
      throw new ValidationError(`Filter contains reserved key "${key}".`);
    }

    if (key === '$and' || key === '$or') {
      if (!evaluateLogicalOperator(key, condition, document, depth, caches)) {
        return false;
      }
      continue;
    }

    if (key.startsWith('$')) {
      throw new ValidationError(`Unknown filter operator "${key}".`);
    }

    const resolved = getValueByPath(document, key, caches.pathCache);
    if (!evaluateConditionValue(resolved, condition, depth, caches)) {
      return false;
    }
  }

  return true;
};

export const matchesFilter = (
  document: Record<string, unknown>,
  filter: Filter | undefined,
  caches: DatabaseCaches,
): boolean => {
  return matchesFilterInternal(document, filter, 0, caches);
};

/**
 * Eagerly validates a filter's structure (reserved keys, unknown operators,
 * logical operand shape, nesting depth) independently of the data being
 * queried. Without this, validation only runs while iterating candidate
 * records, so an invalid filter silently passes on an empty collection but
 * throws on a populated one (see FP-03). Validation reuses the evaluation path
 * against an empty document so there is a single source of truth.
 */
export const validateFilter = (
  filter: Filter | undefined,
  caches: DatabaseCaches,
): void => {
  matchesFilterInternal({}, filter, 0, caches);
};
