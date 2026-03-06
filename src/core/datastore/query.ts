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

const evaluateFilterExpression = (
  record: PersistedTimeseriesRecord,
  expression: NativeFilterExpression,
): boolean => {
  if ('and' in expression) {
    return expression.and.every((item) => evaluateFilterExpression(record, item));
  }

  if ('or' in expression) {
    return expression.or.some((item) => evaluateFilterExpression(record, item));
  }

  if ('not' in expression) {
    return !evaluateFilterExpression(record, expression.not);
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
    try {
      validateRegexpPattern(expression.value);
      const regex = new RegExp(expression.value, 'u');
      return regex.test(fieldValue);
    } catch {
      throw new QueryValidationError('Invalid regexp pattern.');
    }
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

const distinctRows = (rows: NativeQueryResultRow[]): NativeQueryResultRow[] => {
  const output: NativeQueryResultRow[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    const serialized = JSON.stringify(row);
    if (seen.has(serialized)) {
      continue;
    }

    seen.add(serialized);
    output.push(row);
  }

  return output;
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

  const filtered = records.filter((record) => {
    if (request.where === undefined) {
      return true;
    }
    return evaluateFilterExpression(record, request.where);
  });

  const sorted = filtered.sort((left, right) => {
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

  const rows = sorted.map((record) => buildQueryRow(record, request.select));
  const deduplicated = request.distinct ? distinctRows(rows) : rows;

  if (request.limit === undefined) {
    return deduplicated;
  }

  return deduplicated.slice(0, request.limit);
};
