import { ValidationError } from '../errors.js';

export const validateSkip = (value: number): void => {
  if (!Number.isInteger(value) || value < 0) {
    throw new ValidationError('skip must be a non-negative integer.');
  }
};

export { applySort, cloneSortSpec } from './resultChainSort.js';
export {
  applyProjection,
  cloneProjectionSpec,
} from './resultChainProjection.js';
