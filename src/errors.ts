import {
  ConfigurationError,
  FrostpillarError,
} from '@frostpillar/frostpillar-storage-engine';

export { ConfigurationError };

export class ClosedDatabaseError extends FrostpillarError {}

export class ValidationError extends FrostpillarError {}

export class DuplicateIdError extends FrostpillarError {}
