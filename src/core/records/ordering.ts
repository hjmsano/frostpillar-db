import type {
  PersistedTimeseriesRecord,
  TimeseriesRecord,
} from '../types.js';
import { clonePayloadObject } from '../validation/payload.js';

export const compareByLogicalOrder = (
  left: PersistedTimeseriesRecord,
  right: PersistedTimeseriesRecord,
): number => {
  if (left.timestamp !== right.timestamp) {
    return left.timestamp - right.timestamp;
  }

  if (left.insertionOrder === right.insertionOrder) {
    return 0;
  }

  return left.insertionOrder < right.insertionOrder ? -1 : 1;
};

export const toPublicRecord = (
  record: PersistedTimeseriesRecord,
): TimeseriesRecord => {
  return {
    timestamp: record.timestamp,
    payload: clonePayloadObject(record.payload),
  };
};
