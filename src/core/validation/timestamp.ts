import { TimestampParseError, ValidationError } from '../errors/index.js';
import type { TimestampInput } from '../types.js';

const TIMESTAMP_ISO_8601_WITH_TIMEZONE_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;

export const normalizeTimestampInput = (
  value: TimestampInput,
  fieldName: string,
): number => {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) {
      throw new ValidationError(
        `${fieldName} must be a JavaScript safe integer epoch milliseconds.`,
      );
    }

    return value;
  }

  if (typeof value === 'string') {
    if (!TIMESTAMP_ISO_8601_WITH_TIMEZONE_PATTERN.test(value)) {
      throw new TimestampParseError(
        `${fieldName} must be ISO 8601 date-time with timezone.`,
      );
    }

    const parsed = Date.parse(value);
    if (!Number.isFinite(parsed)) {
      throw new TimestampParseError(`${fieldName} could not be parsed.`);
    }

    if (!Number.isSafeInteger(parsed)) {
      throw new ValidationError(
        `${fieldName} must normalize to a JavaScript safe integer.`,
      );
    }

    return parsed;
  }

  if (value instanceof Date) {
    const parsed = value.getTime();
    if (!Number.isFinite(parsed)) {
      throw new TimestampParseError(`${fieldName} Date value is invalid.`);
    }

    if (!Number.isSafeInteger(parsed)) {
      throw new ValidationError(
        `${fieldName} must normalize to a JavaScript safe integer.`,
      );
    }

    return parsed;
  }

  throw new ValidationError(
    `${fieldName} must be one of number | string | Date.`,
  );
};
