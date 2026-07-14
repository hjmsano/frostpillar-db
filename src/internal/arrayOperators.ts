import { ValidationError } from '../errors.js';
import { deepEqual } from './deepEqual.js';
import { PATH_NOT_FOUND, type PathValue } from './documentPath.js';
import { allPrimitive } from './filterOperatorEvaluators.js';
import { MAX_OPERAND_ARRAY_SIZE } from './limits.js';

/**
 * Asserts the `$all` operand shape and returns it narrowed. Shared with the
 * structural filter validator so both paths raise the identical error.
 */
export const assertAllOperand = (operand: unknown): unknown[] => {
  if (!Array.isArray(operand)) {
    throw new ValidationError('$all expects an array.');
  }
  if (operand.length > MAX_OPERAND_ARRAY_SIZE) {
    throw new ValidationError(
      `$all operand exceeds maximum of ${String(MAX_OPERAND_ARRAY_SIZE)} elements.`,
    );
  }
  return operand as unknown[];
};

/** Asserts the `$size` operand shape and returns it narrowed. */
export const assertSizeOperand = (operand: unknown): number => {
  if (
    typeof operand !== 'number' ||
    !Number.isInteger(operand) ||
    operand < 0
  ) {
    throw new ValidationError('$size expects a non-negative integer.');
  }
  return operand;
};

export const evaluateAll = (resolved: PathValue, operand: unknown): boolean => {
  const required = assertAllOperand(operand);

  if (required.length === 0) {
    return false;
  }

  if (resolved === PATH_NOT_FOUND || !Array.isArray(resolved)) {
    return false;
  }

  const fieldArray = resolved as unknown[];

  if (allPrimitive(required) && allPrimitive(fieldArray)) {
    const fieldSet = new Set(fieldArray);
    for (const item of required) {
      if (!fieldSet.has(item)) return false;
    }
    return true;
  }

  return required.every((item: unknown) =>
    fieldArray.some((element: unknown) => deepEqual(element, item)),
  );
};

export const evaluateSize = (
  resolved: PathValue,
  operand: unknown,
): boolean => {
  const size = assertSizeOperand(operand);

  if (resolved === PATH_NOT_FOUND || !Array.isArray(resolved)) {
    return false;
  }

  return (resolved as unknown[]).length === size;
};
