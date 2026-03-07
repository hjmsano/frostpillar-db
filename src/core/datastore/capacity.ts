import type { CapacityState } from './types.js';
import { QuotaExceededError } from '../errors/index.js';

export const enforceCapacityPolicy = (
  capacityState: CapacityState | null,
  currentSizeBytes: number,
  encodedBytes: number,
  getRecordCount: () => number,
  evictOldestRecord: () => number,
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
    if (getRecordCount() === 0) {
      throw new QuotaExceededError(
        'Record cannot fit in turnover policy with empty datastore.',
      );
    }

    nextSizeBytes -= evictOldestRecord();
  }

  return nextSizeBytes;
};
