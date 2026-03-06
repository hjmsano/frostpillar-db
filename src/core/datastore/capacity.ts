import { QuotaExceededError } from '../errors/index.js';
import { compareByLogicalOrder } from '../records/ordering.js';
import type { PersistedTimeseriesRecord } from '../types.js';
import type { CapacityState } from './types.js';

const evictOldestRecord = (records: PersistedTimeseriesRecord[]): number => {
  let oldestIndex = 0;
  for (let index = 1; index < records.length; index += 1) {
    if (compareByLogicalOrder(records[index], records[oldestIndex]) < 0) {
      oldestIndex = index;
    }
  }

  const removed = records[oldestIndex];
  records.splice(oldestIndex, 1);
  return removed.encodedBytes;
};

export const enforceCapacityPolicy = (
  records: PersistedTimeseriesRecord[],
  capacityState: CapacityState | null,
  currentSizeBytes: number,
  encodedBytes: number,
): number => {
  if (capacityState === null) {
    return currentSizeBytes;
  }

  if (encodedBytes > capacityState.maxSizeBytes) {
    throw new QuotaExceededError(
      'Record exceeds configured capacity.maxSize boundary.',
    );
  }

  if (capacityState.policy === 'strict') {
    if (currentSizeBytes + encodedBytes > capacityState.maxSizeBytes) {
      throw new QuotaExceededError(
        'Insert exceeds configured capacity.maxSize under strict policy.',
      );
    }
    return currentSizeBytes;
  }

  let nextSizeBytes = currentSizeBytes;
  while (nextSizeBytes + encodedBytes > capacityState.maxSizeBytes) {
    if (records.length === 0) {
      throw new QuotaExceededError(
        'Record cannot fit in turnover policy with empty datastore.',
      );
    }

    nextSizeBytes -= evictOldestRecord(records);
  }

  return nextSizeBytes;
};
