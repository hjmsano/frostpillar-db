import {
  QueryValidationError,
  UnsupportedQueryFeatureError,
} from '../errors/index.js';
import { compareByLogicalOrder } from '../records/ordering.js';
import {
  ensurePatternLengthBounded,
  matchLikePattern,
  validateRegexpPattern,
} from './queryPatternSafety.js';
import {
  compareNullableScalar,
  isNativeScalar,
  readFieldValue,
} from './queryFieldValue.js';
import type {
  NativeFilterExpression,
  NativeQueryRequest,
  NativeQueryResultRow,
  PersistedTimeseriesRecord,
} from '../types.js';

interface QueryEvaluationContext {
  regexpByPattern: Map<string, RegExp>;
}

const MAX_FILTER_EXPRESSION_DEPTH = 64;
const MAX_QUERY_SCANNED_ROWS = 10000;
const MAX_QUERY_OUTPUT_ROWS = 5000;

const readOrCompileRegexp = (
  pattern: string,
  context: QueryEvaluationContext,
): RegExp => {
  const cached = context.regexpByPattern.get(pattern);
  if (cached !== undefined) {
    return cached;
  }

  try {
    validateRegexpPattern(pattern);
    const compiled = new RegExp(pattern, 'u');
    context.regexpByPattern.set(pattern, compiled);
    return compiled;
  } catch {
    throw new QueryValidationError('Invalid regexp pattern.');
  }
};

const validateFilterExpressionDepth = (
  expression: NativeFilterExpression,
  depth: number,
): void => {
  if (depth > MAX_FILTER_EXPRESSION_DEPTH) {
    throw new QueryValidationError(
      `Filter expression depth must be <= ${MAX_FILTER_EXPRESSION_DEPTH}.`,
    );
  }

  if ('and' in expression) {
    for (const item of expression.and) {
      validateFilterExpressionDepth(item, depth + 1);
    }
    return;
  }

  if ('or' in expression) {
    for (const item of expression.or) {
      validateFilterExpressionDepth(item, depth + 1);
    }
    return;
  }

  if ('not' in expression) {
    validateFilterExpressionDepth(expression.not, depth + 1);
  }
};

const evaluateFilterExpression = (
  record: PersistedTimeseriesRecord,
  expression: NativeFilterExpression,
  context: QueryEvaluationContext,
): boolean => {
  if ('and' in expression) {
    return expression.and.every((item) =>
      evaluateFilterExpression(record, item, context),
    );
  }

  if ('or' in expression) {
    return expression.or.some((item) =>
      evaluateFilterExpression(record, item, context),
    );
  }

  if ('not' in expression) {
    return !evaluateFilterExpression(record, expression.not, context);
  }

  const fieldValue = readFieldValue(record, expression.field);
  const operator = expression.operator;

  if (operator === 'exists') {
    return fieldValue !== undefined;
  }
  if (operator === 'not_exists') {
    return fieldValue === undefined;
  }
  if (operator === 'is_null') {
    return fieldValue === null;
  }
  if (operator === 'is_not_null') {
    return fieldValue !== undefined && fieldValue !== null;
  }
  if (fieldValue === undefined) {
    return false;
  }
  if (operator === '=') {
    return fieldValue === expression.value;
  }
  if (operator === '!=') {
    return fieldValue !== expression.value;
  }
  if (operator === 'between') {
    if (expression.range === undefined) {
      throw new QueryValidationError('between operator requires range.');
    }
    const [start, end] = expression.range;
    if (
      typeof fieldValue === 'number' &&
      typeof start === 'number' &&
      typeof end === 'number'
    ) {
      return fieldValue >= start && fieldValue <= end;
    }
    if (
      typeof fieldValue === 'string' &&
      typeof start === 'string' &&
      typeof end === 'string'
    ) {
      return fieldValue >= start && fieldValue <= end;
    }
    return false;
  }
  if (operator === 'like') {
    if (typeof fieldValue !== 'string' || typeof expression.value !== 'string') {
      return false;
    }
    ensurePatternLengthBounded(expression.value, 'like');
    return matchLikePattern(fieldValue, expression.value);
  }
  if (operator === 'regexp') {
    if (typeof fieldValue !== 'string' || typeof expression.value !== 'string') {
      return false;
    }
    const regex = readOrCompileRegexp(expression.value, context);
    return regex.test(fieldValue);
  }
  if (
    operator === '>' ||
    operator === '>=' ||
    operator === '<' ||
    operator === '<='
  ) {
    const compared = expression.value;
    if (
      (typeof fieldValue === 'number' && typeof compared === 'number') ||
      (typeof fieldValue === 'string' && typeof compared === 'string')
    ) {
      if (operator === '>') {
        return fieldValue > compared;
      }
      if (operator === '>=') {
        return fieldValue >= compared;
      }
      if (operator === '<') {
        return fieldValue < compared;
      }
      return fieldValue <= compared;
    }
  }

  return false;
};

const buildQueryRow = (
  record: PersistedTimeseriesRecord,
  select?: string[],
): NativeQueryResultRow => {
  if (select === undefined || select.length === 0) {
    const row: NativeQueryResultRow = { timestamp: record.timestamp };
    for (const [key, value] of Object.entries(record.payload)) {
      if (isNativeScalar(value)) {
        row[key] = value;
      }
    }
    return row;
  }

  const row: NativeQueryResultRow = {};
  for (const field of select) {
    const value = readFieldValue(record, field);
    row[field] = value ?? null;
  }

  return row;
};

export const executeNativeQuery = (
  records: PersistedTimeseriesRecord[],
  request: NativeQueryRequest,
): NativeQueryResultRow[] => {
  if (request.aggregates !== undefined || request.groupBy !== undefined) {
    throw new UnsupportedQueryFeatureError(
      'Aggregates and groupBy are not implemented in current query slice.',
    );
  }

  if (request.limit !== undefined) {
    if (!Number.isInteger(request.limit) || request.limit <= 0) {
      throw new QueryValidationError('limit must be a positive integer.');
    }
  }

  const evaluationContext: QueryEvaluationContext = {
    regexpByPattern: new Map<string, RegExp>(),
  };
  if (request.where !== undefined) {
    validateFilterExpressionDepth(request.where, 0);
  }

  const filtered: PersistedTimeseriesRecord[] = [];
  let scannedRows = 0;
  for (const record of records) {
    scannedRows += 1;
    if (scannedRows > MAX_QUERY_SCANNED_ROWS) {
      throw new QueryValidationError(
        `Query scanned rows must be <= ${MAX_QUERY_SCANNED_ROWS}.`,
      );
    }

    if (
      request.where === undefined ||
      evaluateFilterExpression(record, request.where, evaluationContext)
    ) {
      filtered.push(record);
    }
  }

  filtered.sort((left, right) => {
    if (request.orderBy === undefined || request.orderBy.length === 0) {
      return compareByLogicalOrder(left, right);
    }

    for (const order of request.orderBy) {
      if (order.direction !== 'asc' && order.direction !== 'desc') {
        throw new QueryValidationError('orderBy.direction must be "asc" or "desc".');
      }
      const compared = compareNullableScalar(
        readFieldValue(left, order.field),
        readFieldValue(right, order.field),
      );
      if (compared !== 0) {
        return order.direction === 'asc' ? compared : -compared;
      }
    }

    return compareByLogicalOrder(left, right);
  });

  const output: NativeQueryResultRow[] = [];
  const seenRows = request.distinct ? new Set<string>() : null;

  for (const record of filtered) {
    const row = buildQueryRow(record, request.select);

    if (seenRows !== null) {
      const serialized = JSON.stringify(row);
      if (seenRows.has(serialized)) {
        continue;
      }
      seenRows.add(serialized);
    }

    output.push(row);
    if (output.length > MAX_QUERY_OUTPUT_ROWS) {
      throw new QueryValidationError(
        `Query output rows must be <= ${MAX_QUERY_OUTPUT_ROWS}.`,
      );
    }

    if (request.limit !== undefined && output.length >= request.limit) {
      break;
    }
  }

  return output;
};
