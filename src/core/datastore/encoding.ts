import { PageCorruptionError, ValidationError } from '../errors/index.js';
import type {
  PersistedTimeseriesRecord,
  RecordPayload,
} from '../types.js';
import { validateAndNormalizePayload } from '../validation/payload.js';
import type { SerializablePersistedRecord } from './types.js';

const UTF8_ENCODER = new TextEncoder();
const U64_MAX = 18446744073709551615n;

const stableStringifyPayloadValue = (value: unknown): string => {
  if (value === null) {
    return 'null';
  }

  if (typeof value === 'string') {
    return JSON.stringify(value);
  }

  if (typeof value === 'number') {
    return JSON.stringify(value);
  }

  if (typeof value === 'boolean') {
    return JSON.stringify(value);
  }

  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new ValidationError('Payload contains unsupported value for encoding.');
  }

  const objectValue = value as Record<string, unknown>;
  const keys = Object.keys(objectValue).sort((left, right) =>
    left.localeCompare(right),
  );
  const chunks = keys.map((key) => {
    return `${JSON.stringify(key)}:${stableStringifyPayloadValue(objectValue[key])}`;
  });

  return `{${chunks.join(',')}}`;
};

export const computeRecordEncodedBytes = (
  timestamp: number,
  payload: RecordPayload,
): number => {
  const stablePayload = stableStringifyPayloadValue(payload);
  return UTF8_ENCODER.encode(`${timestamp}|${stablePayload}`).byteLength;
};

export const parseUnsignedBigInt = (value: unknown, field: string): bigint => {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) {
    throw new PageCorruptionError(`${field} must be an unsigned decimal string.`);
  }

  const parsed = BigInt(value);
  if (parsed > U64_MAX) {
    throw new PageCorruptionError(`${field} exceeds uint64 boundary.`);
  }

  return parsed;
};

export const toSerializableRecord = (
  record: PersistedTimeseriesRecord,
): SerializablePersistedRecord => {
  return {
    timestamp: record.timestamp,
    payload: record.payload,
    insertionOrder: record.insertionOrder.toString(10),
  };
};

export const decodeSerializableRecord = (
  serialized: SerializablePersistedRecord,
): PersistedTimeseriesRecord => {
  if (!Number.isSafeInteger(serialized.timestamp)) {
    throw new PageCorruptionError('Record timestamp must be a safe integer.');
  }

  const normalizedPayload = validateAndNormalizePayload(serialized.payload);
  const insertionOrder = parseUnsignedBigInt(
    serialized.insertionOrder,
    'record.insertionOrder',
  );
  const encodedBytes = computeRecordEncodedBytes(
    serialized.timestamp,
    normalizedPayload,
  );

  return {
    timestamp: serialized.timestamp,
    payload: normalizedPayload,
    insertionOrder,
    encodedBytes,
  };
};
