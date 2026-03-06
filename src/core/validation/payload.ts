import { ValidationError } from '../errors/index.js';
import type { RecordPayload, SupportedNestedValue } from '../types.js';

const MAX_PAYLOAD_DEPTH = 64;
const MAX_PAYLOAD_KEY_BYTES = 1024;
const MAX_PAYLOAD_STRING_BYTES = 65535;
const UTF8_ENCODER = new TextEncoder();

const utf8ByteLength = (value: string): number => {
  return UTF8_ENCODER.encode(value).byteLength;
};

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  if (Array.isArray(value)) {
    return false;
  }

  const objectValue: object = value;
  const prototype: unknown = Object.getPrototypeOf(objectValue);
  return prototype === Object.prototype || prototype === null;
};

const validatePayloadKey = (key: string): void => {
  if (key.length === 0) {
    throw new ValidationError('Payload keys must be non-empty strings.');
  }

  if (utf8ByteLength(key) > MAX_PAYLOAD_KEY_BYTES) {
    throw new ValidationError(
      `Payload key UTF-8 byte length must be <= ${MAX_PAYLOAD_KEY_BYTES}.`,
    );
  }
};

const validatePayloadValue = (
  value: unknown,
  depth: number,
  activePath: WeakSet<object>,
): void => {
  if (value === null) {
    return;
  }

  if (typeof value === 'string') {
    if (utf8ByteLength(value) > MAX_PAYLOAD_STRING_BYTES) {
      throw new ValidationError(
        `Payload string UTF-8 byte length must be <= ${MAX_PAYLOAD_STRING_BYTES}.`,
      );
    }
    return;
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new ValidationError('Payload number values must be finite.');
    }
    return;
  }

  if (typeof value === 'boolean') {
    return;
  }

  if (typeof value === 'bigint') {
    throw new ValidationError('Payload bigint values are not supported.');
  }

  if (typeof value === 'object') {
    if (Array.isArray(value)) {
      throw new ValidationError('Payload arrays are not supported.');
    }

    if (!isPlainObject(value)) {
      throw new ValidationError('Payload values must be plain objects.');
    }

    validatePayloadObject(value, depth, activePath);
    return;
  }

  throw new ValidationError(
    'Payload values must be string | number | boolean | null or nested object.',
  );
};

const validatePayloadObject = (
  payloadObject: Record<string, unknown>,
  depth: number,
  activePath: WeakSet<object>,
): void => {
  if (depth > MAX_PAYLOAD_DEPTH) {
    throw new ValidationError(
      `Payload nesting depth must be <= ${MAX_PAYLOAD_DEPTH}.`,
    );
  }

  if (activePath.has(payloadObject)) {
    throw new ValidationError('Circular payload references are not supported.');
  }

  activePath.add(payloadObject);

  for (const [key, value] of Object.entries(payloadObject)) {
    validatePayloadKey(key);
    validatePayloadValue(value, depth + 1, activePath);
  }

  activePath.delete(payloadObject);
};

const clonePayloadValue = (value: SupportedNestedValue): SupportedNestedValue => {
  if (value === null) {
    return null;
  }

  if (typeof value === 'string') {
    return value;
  }

  if (typeof value === 'number') {
    return value;
  }

  if (typeof value === 'boolean') {
    return value;
  }

  return clonePayloadObject(value as RecordPayload);
};

export const clonePayloadObject = (payloadObject: RecordPayload): RecordPayload => {
  const copied: RecordPayload = {};

  for (const [key, value] of Object.entries(payloadObject)) {
    copied[key] = clonePayloadValue(value);
  }

  return copied;
};

export const validateAndNormalizePayload = (payload: unknown): RecordPayload => {
  if (!isPlainObject(payload)) {
    throw new ValidationError('payload must be a non-null plain object.');
  }

  validatePayloadObject(payload, 0, new WeakSet<object>());

  return clonePayloadObject(payload as RecordPayload);
};
