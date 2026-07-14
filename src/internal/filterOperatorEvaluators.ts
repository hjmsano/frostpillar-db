import { ValidationError } from '../errors.js';
import { deepEqual } from './deepEqual.js';
import { PATH_NOT_FOUND, type PathValue } from './documentPath.js';
import {
  getCachedRegex,
  inclusionSetCache,
  operandAllPrimitiveCache,
} from './filterCache.js';
import { MAX_OPERAND_ARRAY_SIZE, MAX_REGEX_TEST_LENGTH } from './limits.js';
import { isObjectRecord } from './objectUtils.js';

export const isPrimitive = (value: unknown): boolean => {
  if (value === null || value === undefined) {
    return true;
  }
  const t = typeof value;
  return t === 'string' || t === 'number' || t === 'boolean';
};

export const allPrimitive = (arr: unknown[]): boolean => {
  for (const item of arr) {
    if (!isPrimitive(item)) {
      return false;
    }
  }
  return true;
};

export const getOperandAllPrimitive = (operand: unknown[]): boolean => {
  const cached = operandAllPrimitiveCache.get(operand);
  if (cached !== undefined && cached.length === operand.length) {
    return cached.value;
  }
  const result = allPrimitive(operand);
  operandAllPrimitiveCache.set(operand, {
    value: result,
    length: operand.length,
  });
  return result;
};

export const getInclusionSet = (operand: unknown[]): Set<unknown> => {
  const cached = inclusionSetCache.get(operand);
  if (cached !== undefined && cached.length === operand.length) {
    return cached.set;
  }
  const set = new Set(operand);
  inclusionSetCache.set(operand, { set, length: operand.length });
  return set;
};

export const evaluateArrayInclusion = (
  fieldArray: unknown[],
  operand: unknown[],
): boolean => {
  if (getOperandAllPrimitive(operand) && allPrimitive(fieldArray)) {
    const set = getInclusionSet(operand);
    return fieldArray.some((element) => set.has(element));
  }
  return fieldArray.some((element) =>
    operand.some((candidate) => deepEqual(element, candidate)),
  );
};

/**
 * Asserts the `$in` / `$nin` operand shape and returns it narrowed. Shared with
 * the structural filter validator so both paths raise the identical error.
 */
export const assertInclusionOperand = (
  operand: unknown,
  mode: '$in' | '$nin',
): unknown[] => {
  if (!Array.isArray(operand)) {
    throw new ValidationError(`${mode} expects an array.`);
  }
  if (operand.length > MAX_OPERAND_ARRAY_SIZE) {
    throw new ValidationError(
      `${mode} operand exceeds maximum of ${String(MAX_OPERAND_ARRAY_SIZE)} elements.`,
    );
  }
  return operand as unknown[];
};

/** Asserts the `$exists` operand shape and returns it narrowed. */
export const assertExistsOperand = (operand: unknown): boolean => {
  if (typeof operand !== 'boolean') {
    throw new ValidationError('$exists expects a boolean.');
  }
  return operand;
};

export const evaluateInclusion = (
  resolved: PathValue,
  operand: unknown,
  mode: '$in' | '$nin',
): boolean => {
  const candidates = assertInclusionOperand(operand, mode);
  if (resolved === PATH_NOT_FOUND) {
    return mode === '$nin';
  }

  if (Array.isArray(resolved)) {
    const found = evaluateArrayInclusion(resolved, candidates);
    return mode === '$in' ? found : !found;
  }

  if (getOperandAllPrimitive(candidates) && isPrimitive(resolved)) {
    const found = getInclusionSet(candidates).has(resolved);
    return mode === '$in' ? found : !found;
  }

  const found = candidates.some((candidate) => deepEqual(candidate, resolved));
  return mode === '$in' ? found : !found;
};

export const evaluateRegex = (
  resolved: PathValue,
  operand: unknown,
  regexStringCache: Map<string, RegExp>,
): boolean => {
  if (resolved === PATH_NOT_FOUND || typeof resolved !== 'string') {
    return false;
  }
  if (resolved.length > MAX_REGEX_TEST_LENGTH) {
    throw new ValidationError(
      `$regex target field value exceeds maximum length of ${MAX_REGEX_TEST_LENGTH} characters.`,
    );
  }
  return getCachedRegex(operand, regexStringCache).test(resolved);
};

export const evaluateExists = (
  resolved: PathValue,
  operand: unknown,
): boolean => {
  return (resolved !== PATH_NOT_FOUND) === assertExistsOperand(operand);
};

export const isOperatorExpression = (
  value: unknown,
): value is Record<string, unknown> => {
  if (!isObjectRecord(value)) {
    return false;
  }

  let total = 0;
  let operators = 0;
  for (const key in value) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
    total++;
    if (key.charCodeAt(0) === 36 /* '$' */) operators++;
  }
  if (operators === 0) {
    return false;
  }

  if (operators !== total) {
    throw new ValidationError(
      'Field condition cannot mix operators and regular keys.',
    );
  }

  return true;
};

export const evaluateElemMatch = (
  resolved: PathValue,
  operand: unknown,
  depth: number,
  evalOperatorExpr: (
    resolved: PathValue,
    expression: Record<string, unknown>,
    depth: number,
  ) => boolean,
  evalFilterInternal: (
    document: Record<string, unknown>,
    filter: Record<string, unknown>,
    depth: number,
  ) => boolean,
): boolean => {
  if (resolved === PATH_NOT_FOUND || !Array.isArray(resolved)) return false;
  if (isOperatorExpression(operand)) {
    return resolved.some((element: unknown) =>
      evalOperatorExpr(element, operand, depth + 1),
    );
  }
  if (isObjectRecord(operand)) {
    return resolved.some(
      (element: unknown) =>
        isObjectRecord(element) &&
        evalFilterInternal(element, operand, depth + 1),
    );
  }
  return false;
};
