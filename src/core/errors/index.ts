class FrostpillarError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class ValidationError extends FrostpillarError {}

export class TimestampParseError extends FrostpillarError {}

export class InvalidQueryRangeError extends FrostpillarError {}

export class ConfigurationError extends FrostpillarError {}

export class UnsupportedBackendError extends FrostpillarError {}

export class ClosedDatastoreError extends FrostpillarError {}

export class StorageEngineError extends FrostpillarError {}

export class DatabaseLockedError extends StorageEngineError {}

export class BinaryFormatError extends StorageEngineError {}

export class PageCorruptionError extends StorageEngineError {}

export class IndexCorruptionError extends StorageEngineError {}

export class QuotaExceededError extends FrostpillarError {}
