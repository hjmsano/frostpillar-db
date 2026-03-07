import { ValidationError } from '../errors/index.js';
import type { RecordPayload, SupportedNestedValue } from '../types.js';

const MAX_PAYLOAD_DEPTH = 64;
const MAX_PAYLOAD_KEY_BYTES = 1024;
const MAX_PAYLOAD_STRING_BYTES = 65535;
const MAX_PAYLOAD_KEYS_PER_OBJECT = 256;
const MAX_PAYLOAD_KEYS_TOTAL = 4096;
const MAX_PAYLOAD_TOTAL_BYTES = 1048576;
const NUMBER_VALIDATION_BYTES = 8;
const BOOLEAN_VALIDATION_BYTES = 1;
const NULL_VALIDATION_BYTES = 1;
const UTF8_ENCODER = new TextEncoder();

interface PayloadValidationState {
  activePath: WeakSet<object>;
  totalKeyCount: number;
  totalValidationBytes: number;
}

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

const addValidationBytes = (
  state: PayloadValidationState,
  bytes: number,
): void => {
  state.totalValidationBytes += bytes;
  if (state.totalValidationBytes > MAX_PAYLOAD_TOTAL_BYTES) {
    throw new ValidationError(
      `Payload aggregate validation bytes must be <= ${MAX_PAYLOAD_TOTAL_BYTES}.`,
    );
  }
};

const validatePayloadKey = (
  key: string,
  state: PayloadValidationState,
): void => {
  if (key.length === 0) {
    throw new ValidationError('Payload keys must be non-empty strings.');
  }

  const keyBytes = utf8ByteLength(key);
  if (keyBytes > MAX_PAYLOAD_KEY_BYTES) {
    throw new ValidationError(
      `Payload key UTF-8 byte length must be <= ${MAX_PAYLOAD_KEY_BYTES}.`,
    );
  }

  state.totalKeyCount += 1;
  if (state.totalKeyCount > MAX_PAYLOAD_KEYS_TOTAL) {
    throw new ValidationError(
      `Payload total key count must be <= ${MAX_PAYLOAD_KEYS_TOTAL}.`,
    );
  }

  addValidationBytes(state, keyBytes);
};

const validatePayloadValue = (
  value: unknown,
  depth: number,
  state: PayloadValidationState,
): void => {
  if (value === null) {
    addValidationBytes(state, NULL_VALIDATION_BYTES);
    return;
  }

  if (typeof value === 'string') {
    const stringBytes = utf8ByteLength(value);
    if (stringBytes > MAX_PAYLOAD_STRING_BYTES) {
      throw new ValidationError(
        `Payload string UTF-8 byte length must be <= ${MAX_PAYLOAD_STRING_BYTES}.`,
      );
    }
    addValidationBytes(state, stringBytes);
    return;
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new ValidationError('Payload number values must be finite.');
    }
    addValidationBytes(state, NUMBER_VALIDATION_BYTES);
    return;
  }

  if (typeof value === 'boolean') {
    addValidationBytes(state, BOOLEAN_VALIDATION_BYTES);
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

    validatePayloadObject(value, depth, state);
    return;
  }

  throw new ValidationError(
    'Payload values must be string | number | boolean | null or nested object.',
  );
};

const validatePayloadObject = (
  payloadObject: Record<string, unknown>,
  depth: number,
  state: PayloadValidationState,
): void => {
  if (depth > MAX_PAYLOAD_DEPTH) {
    throw new ValidationError(
      `Payload nesting depth must be <= ${MAX_PAYLOAD_DEPTH}.`,
    );
  }

  if (state.activePath.has(payloadObject)) {
    throw new ValidationError('Circular payload references are not supported.');
  }

  const entries = Object.entries(payloadObject);
  if (entries.length > MAX_PAYLOAD_KEYS_PER_OBJECT) {
    throw new ValidationError(
      `Payload object key count must be <= ${MAX_PAYLOAD_KEYS_PER_OBJECT}.`,
    );
  }

  state.activePath.add(payloadObject);

  for (const [key, value] of entries) {
    validatePayloadKey(key, state);
    validatePayloadValue(value, depth + 1, state);
  }

  state.activePath.delete(payloadObject);
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

  validatePayloadObject(payload, 0, {
    activePath: new WeakSet<object>(),
    totalKeyCount: 0,
    totalValidationBytes: 0,
  });

  return clonePayloadObject(payload as RecordPayload);
};
