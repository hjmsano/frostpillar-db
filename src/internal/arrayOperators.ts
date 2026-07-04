import { ValidationError } from '../errors.js';
import { deepEqual } from './deepEqual.js';
import { PATH_NOT_FOUND, type PathValue } from './documentPath.js';
import { allPrimitive } from './filterOperatorEvaluators.js';
import { MAX_OPERAND_ARRAY_SIZE } from './limits.js';

export const evaluateAll = (resolved: PathValue, operand: unknown): boolean => {
  if (!Array.isArray(operand)) {
    throw new ValidationError('$all expects an array.');
  }
  if (operand.length > MAX_OPERAND_ARRAY_SIZE) {
    throw new ValidationError(
      `$all operand exceeds maximum of ${String(MAX_OPERAND_ARRAY_SIZE)} elements.`,
    );
  }

  if (operand.length === 0) {
    return false;
  }

  if (resolved === PATH_NOT_FOUND || !Array.isArray(resolved)) {
    return false;
  }

  const fieldArray = resolved as unknown[];

  if (allPrimitive(operand) && allPrimitive(fieldArray)) {
    const fieldSet = new Set(fieldArray);
    for (const required of operand) {
      if (!fieldSet.has(required)) return false;
    }
    return true;
  }

  return operand.every((required: unknown) =>
    fieldArray.some((element: unknown) => deepEqual(element, required)),
  );
};

export const evaluateSize = (
  resolved: PathValue,
  operand: unknown,
): boolean => {
  if (
    typeof operand !== 'number' ||
    !Number.isInteger(operand) ||
    operand < 0
  ) {
    throw new ValidationError('$size expects a non-negative integer.');
  }

  if (resolved === PATH_NOT_FOUND || !Array.isArray(resolved)) {
    return false;
  }

  return (resolved as unknown[]).length === operand;
};
