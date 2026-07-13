import type { PayloadLimitsConfig } from '@frostpillar/frostpillar-storage-engine';

import { ValidationError } from '../errors.js';
import { hasOwn, isPlainObject, isReservedKey } from './objectUtils.js';
import { DEFAULT_MAX_DEPTH } from './limits.js';

const DEFAULT_MAX_KEY_BYTES = 1024;
const DEFAULT_MAX_STRING_BYTES = 65535;
const DEFAULT_MAX_KEYS_PER_OBJECT = 256;
const DEFAULT_MAX_TOTAL_KEYS = 4096;
const DEFAULT_MAX_TOTAL_BYTES = 1048576;

// JSON delimiter overhead per key: open-quote + close-quote + colon
const JSON_KEY_OVERHEAD_BYTES = 3;
// JSON delimiter overhead per string value: open-quote + close-quote
const JSON_STRING_OVERHEAD_BYTES = 2;
// JSON delimiter overhead per array or object: opening + closing bracket/brace
const JSON_CONTAINER_OVERHEAD_BYTES = 2;

interface ResolvedLimits {
  maxDepth: number;
  maxKeyBytes: number;
  maxStringBytes: number;
  maxKeysPerObject: number;
  maxTotalKeys: number;
  maxTotalBytes: number;
}

interface ValidationState {
  activePath: WeakSet<object>;
  totalKeyCount: number;
  totalBytes: number;
  limits: ResolvedLimits;
  /**
   * Top-level keys the write path will add to the payload after validation
   * (`_id`, and `_createdAt` on a TTL collection). They are absent from the
   * caller's object but present in the stored document, so they are charged to
   * the root object's key count.
   */
  extraTopLevelKeys: number;
}

export const computeUtf8ByteLength = (str: string): number => {
  let bytes = 0;
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    if (code <= 0x7f) {
      bytes += 1;
    } else if (code <= 0x7ff) {
      bytes += 2;
    } else if (code >= 0xd800 && code <= 0xdbff) {
      // High surrogate: only a valid trailing low surrogate forms a 4-byte
      // code point. A lone high surrogate is escaped by JSON.stringify as
      // \uXXXX (6 bytes). charCodeAt returns NaN past the end, which fails the
      // range test, so an unpaired high surrogate at end of string counts as 6.
      const next = str.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        i += 1;
      } else {
        bytes += 6;
      }
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      // Lone low surrogate → JSON.stringify escapes as \uXXXX (6 bytes).
      bytes += 6;
    } else {
      bytes += 3;
    }
  }
  return bytes;
};

const addBytes = (state: ValidationState, bytes: number): void => {
  state.totalBytes += bytes;
  if (state.totalBytes > state.limits.maxTotalBytes) {
    throw new ValidationError(
      `Payload total bytes must be <= ${state.limits.maxTotalBytes}.`,
    );
  }
};

const validateKey = (key: string, state: ValidationState): void => {
  if (key.trim().length === 0) {
    throw new ValidationError('Payload keys must be non-empty strings.');
  }
  if (isReservedKey(key)) {
    throw new ValidationError(
      `Payload key "${key}" is reserved and not allowed.`,
    );
  }
  const keyBytes = computeUtf8ByteLength(key);
  if (keyBytes > state.limits.maxKeyBytes) {
    throw new ValidationError(
      `Payload key UTF-8 byte length must be <= ${state.limits.maxKeyBytes}.`,
    );
  }
  state.totalKeyCount += 1;
  if (state.totalKeyCount > state.limits.maxTotalKeys) {
    throw new ValidationError(
      `Payload total key count must be <= ${state.limits.maxTotalKeys}.`,
    );
  }
  // JSON overhead: "key": → quoted string + colon
  addBytes(state, keyBytes + JSON_KEY_OVERHEAD_BYTES);
};

// validateValue, validateArray, and validateObject are mutually recursive const
// arrow functions. Each body captures the others by name; at the time any of
// them is first *called* (from validateInsertPayload → validateObject), all
// three are already fully initialised, so the cross-references are safe.

const validateValue = (
  value: unknown,
  depth: number,
  state: ValidationState,
): void => {
  if (value === null) {
    addBytes(state, 4); // "null"
    return;
  }
  if (typeof value === 'string') {
    const stringBytes = computeUtf8ByteLength(value);
    if (stringBytes > state.limits.maxStringBytes) {
      throw new ValidationError(
        `Payload string UTF-8 byte length must be <= ${state.limits.maxStringBytes}.`,
      );
    }
    addBytes(state, stringBytes + JSON_STRING_OVERHEAD_BYTES); // quotes
    return;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new ValidationError('Payload number values must be finite.');
    }
    addBytes(state, String(value).length);
    return;
  }
  if (typeof value === 'boolean') {
    addBytes(state, value ? 4 : 5);
    return;
  }
  if (typeof value === 'bigint') {
    throw new ValidationError('Payload bigint values are not supported.');
  }
  if (typeof value === 'object') {
    if (Array.isArray(value)) {
      validateArray(value, depth + 1, state);
      return;
    }
    if (!isPlainObject(value)) {
      throw new ValidationError('Payload values must be plain objects.');
    }
    validateObject(value, depth + 1, state);
    return;
  }
  throw new ValidationError(UNSUPPORTED_VALUE_MESSAGE);
};

const validateArray = (
  arr: unknown[],
  depth: number,
  state: ValidationState,
): void => {
  const arrayLevel = depth + 1;
  if (arrayLevel > state.limits.maxDepth) {
    throw new ValidationError(
      `Payload nesting depth must be <= ${state.limits.maxDepth}.`,
    );
  }
  // Track arrays in the active path so self-referential arrays raise a
  // ValidationError instead of recursing until the stack overflows.
  if (state.activePath.has(arr)) {
    throw new ValidationError('Circular payload references are not supported.');
  }
  state.activePath.add(arr);
  // JSON overhead: brackets + commas
  const commaBytes = arr.length > 1 ? arr.length - 1 : 0;
  addBytes(state, JSON_CONTAINER_OVERHEAD_BYTES + commaBytes);
  for (const element of arr) {
    validateValue(element, depth, state);
  }
  state.activePath.delete(arr);
};

const validateObject = (
  obj: Record<string, unknown>,
  depth: number,
  state: ValidationState,
): void => {
  const objectLevel = depth + 1;
  if (objectLevel > state.limits.maxDepth) {
    throw new ValidationError(
      `Payload nesting depth must be <= ${state.limits.maxDepth}.`,
    );
  }
  if (state.activePath.has(obj)) {
    throw new ValidationError('Circular payload references are not supported.');
  }
  const entries = Object.entries(obj);
  // Only the root object (depth 0) gains the write path's generated fields.
  const generatedKeys = depth === 0 ? state.extraTopLevelKeys : 0;
  if (entries.length + generatedKeys > state.limits.maxKeysPerObject) {
    throw new ValidationError(
      `Payload object key count must be <= ${state.limits.maxKeysPerObject}.`,
    );
  }
  state.activePath.add(obj);

  // JSON overhead: braces + commas
  const commaBytes = entries.length > 1 ? entries.length - 1 : 0;
  addBytes(state, JSON_CONTAINER_OVERHEAD_BYTES + commaBytes);

  for (const [key, value] of entries) {
    validateKey(key, state);
    validateValue(value, depth, state);
  }

  state.activePath.delete(obj);
};

/** A generated `_id` is a 36-character UUID; the 2 bytes are its JSON quotes. */
const GENERATED_ID_VALUE_BYTES = 38;
/** `_createdAt` is `Date.now()` — a 13-digit millisecond epoch until 2286. */
const GENERATED_TIMESTAMP_VALUE_BYTES = 13;

/**
 * Charges the fields the write path adds after validation (`_id`, and
 * `_createdAt` on a TTL collection) to the limits, so a document is measured as
 * it will be stored. Without this, a document could pass insert at exactly
 * `maxKeysPerObject` and then fail every later update under the same limit,
 * since `update` validates the stored document — generated fields included.
 * A key the caller already supplied is counted by the walk itself, not here.
 */
const accountGeneratedKeys = (
  payload: Record<string, unknown>,
  generatedKeys: readonly string[],
  state: ValidationState,
): void => {
  for (const key of generatedKeys) {
    if (hasOwn(payload, key)) continue;
    state.extraTopLevelKeys += 1;
    validateKey(key, state);
    addBytes(
      state,
      key === '_createdAt'
        ? GENERATED_TIMESTAMP_VALUE_BYTES
        : GENERATED_ID_VALUE_BYTES,
    );
  }
};

const resolveLimits = (config?: PayloadLimitsConfig): ResolvedLimits => ({
  maxDepth: config?.maxDepth ?? DEFAULT_MAX_DEPTH,
  maxKeyBytes: config?.maxKeyBytes ?? DEFAULT_MAX_KEY_BYTES,
  maxStringBytes: config?.maxStringBytes ?? DEFAULT_MAX_STRING_BYTES,
  maxKeysPerObject: config?.maxKeysPerObject ?? DEFAULT_MAX_KEYS_PER_OBJECT,
  maxTotalKeys: config?.maxTotalKeys ?? DEFAULT_MAX_TOTAL_KEYS,
  maxTotalBytes: config?.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES,
});

const UNSUPPORTED_VALUE_MESSAGE =
  'Payload values must be string | number | boolean | null, an array, or a nested object.';

/**
 * The security walk rejects the same non-storable leaf types the full validator
 * does: `bigint`, `function`, `symbol`, and `undefined`. None is JSON-safe, and
 * `function`/`symbol` are reference types that `cloneDocument` copies by
 * reference — under `skipPayloadValidation` a stored document kept sharing the
 * caller's function object, so mutating a property on it after the write changed
 * what later `find()` and `distinct()` calls returned. Screening them here means
 * no aliasable value reaches storage on any path (ADR-030).
 */
const validateSecurityValue = (
  value: unknown,
  activePath: WeakSet<object>,
  depth: number,
  maxDepth: number,
): void => {
  if (value === null) return;
  if (typeof value === 'bigint') {
    throw new ValidationError('Payload bigint values are not supported.');
  }
  if (typeof value !== 'object') {
    if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      return;
    }
    throw new ValidationError(UNSUPPORTED_VALUE_MESSAGE);
  }
  if (depth > maxDepth) {
    throw new ValidationError(`Payload nesting depth must be <= ${maxDepth}.`);
  }
  if (Array.isArray(value)) {
    if (activePath.has(value)) {
      throw new ValidationError(
        'Circular payload references are not supported.',
      );
    }
    activePath.add(value);
    for (const element of value) {
      validateSecurityValue(element, activePath, depth + 1, maxDepth);
    }
    activePath.delete(value);
    return;
  }
  // A non-plain object is rejected, not skipped: the traversal cannot see the
  // reserved keys or cycles inside a value it will not descend into, and the
  // write path deep-clones the payload afterwards — a self-referential class
  // instance passed this check and then overflowed the stack inside the clone.
  if (!isPlainObject(value)) {
    throw new ValidationError('Payload values must be plain objects.');
  }
  if (activePath.has(value)) {
    throw new ValidationError('Circular payload references are not supported.');
  }
  activePath.add(value);
  for (const [key, nested] of Object.entries(value)) {
    if (isReservedKey(key)) {
      throw new ValidationError(
        `Payload key "${key}" is reserved and not allowed.`,
      );
    }
    validateSecurityValue(nested, activePath, depth + 1, maxDepth);
  }
  activePath.delete(value);
};

/**
 * Lightweight security-only validator that checks for reserved keys recursively
 * and enforces a nesting-depth cap to prevent stack-overflow DoS.
 * Does NOT check sizes, byte counts, or key lengths.
 * Always runs regardless of `skipInsertValidation`.
 *
 * Throws `ValidationError` on invalid payloads.
 */
export const validatePayloadSecurity = (
  payload: unknown,
  maxDepth: number = DEFAULT_MAX_DEPTH,
): void => {
  if (!isPlainObject(payload)) {
    throw new ValidationError('Document must be a non-null plain object.');
  }
  validateSecurityValue(payload, new WeakSet<object>(), 1, maxDepth);
};

/**
 * Validates a payload at the frostpillar-db level.
 * Performs structural validation (circular references, unsupported types, depth/size limits)
 * without deep-cloning, since insert paths already create shallow copies.
 *
 * NOTE: The byte count computed here is an *approximation* of `JSON.stringify` output size.
 * It accounts for UTF-8 character widths and JSON delimiters (quotes, colons, braces, brackets,
 * commas). Lone/unpaired UTF-16 surrogates (high or low) are counted as 6 bytes each, matching
 * the `\uXXXX` escape sequences that `JSON.stringify` emits for them. The approximation still
 * does not reproduce every escape detail (e.g. control characters inflate the real output).
 * Users setting `maxTotalBytes` near a boundary should not expect byte-exact enforcement.
 *
 * Throws `ValidationError` on invalid payloads.
 */
export const validateInsertPayload = (
  payload: unknown,
  payloadLimits?: PayloadLimitsConfig,
  generatedKeys: readonly string[] = [],
): void => {
  if (!isPlainObject(payload)) {
    throw new ValidationError('Document must be a non-null plain object.');
  }
  const limits = resolveLimits(payloadLimits);
  const state: ValidationState = {
    activePath: new WeakSet<object>(),
    totalKeyCount: 0,
    totalBytes: 0,
    limits,
    extraTopLevelKeys: 0,
  };
  accountGeneratedKeys(payload, generatedKeys, state);
  validateObject(payload, 0, state);
};

const materializeArray = (
  value: unknown[],
  activePath: WeakSet<object>,
  depth: number,
  maxDepth: number,
): unknown[] => {
  if (depth > maxDepth) {
    throw new ValidationError(`Payload nesting depth must be <= ${maxDepth}.`);
  }
  if (activePath.has(value)) {
    throw new ValidationError('Circular payload references are not supported.');
  }
  activePath.add(value);
  const copy: unknown[] = [];
  for (const element of value) {
    copy.push(materializeValue(element, activePath, depth + 1, maxDepth));
  }
  activePath.delete(value);
  return copy;
};

const materializeObject = (
  value: Record<string, unknown>,
  activePath: WeakSet<object>,
  depth: number,
  maxDepth: number,
): Record<string, unknown> => {
  if (depth > maxDepth) {
    throw new ValidationError(`Payload nesting depth must be <= ${maxDepth}.`);
  }
  if (activePath.has(value)) {
    throw new ValidationError('Circular payload references are not supported.');
  }
  activePath.add(value);
  const copy: Record<string, unknown> = {};
  // `Object.entries` reads each own enumerable property exactly once, and the
  // value it hands back is the one both checked and copied below — a getter (or
  // a Proxy `get` trap) has no second read to answer differently.
  for (const [key, nested] of Object.entries(value)) {
    if (isReservedKey(key)) {
      throw new ValidationError(
        `Payload key "${key}" is reserved and not allowed.`,
      );
    }
    copy[key] = materializeValue(nested, activePath, depth + 1, maxDepth);
  }
  activePath.delete(value);
  return copy;
};

// Mutually recursive with materializeArray / materializeObject; see the note
// above `validateValue` — all three are initialised before the first call.
const materializeValue = (
  value: unknown,
  activePath: WeakSet<object>,
  depth: number,
  maxDepth: number,
): unknown => {
  if (value === null) return null;
  if (typeof value === 'bigint') {
    throw new ValidationError('Payload bigint values are not supported.');
  }
  if (typeof value !== 'object') {
    if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      return value;
    }
    throw new ValidationError(UNSUPPORTED_VALUE_MESSAGE);
  }
  if (Array.isArray(value)) {
    return materializeArray(value, activePath, depth, maxDepth);
  }
  if (!isPlainObject(value)) {
    throw new ValidationError('Payload values must be plain objects.');
  }
  return materializeObject(value, activePath, depth, maxDepth);
};

/**
 * Takes the write path's single, authoritative read of a caller-supplied
 * document: returns a detached deep copy, built by reading every own enumerable
 * property exactly once, and applying the security checks
 * (`validatePayloadSecurity`'s reserved keys, cycles, depth cap, plain-object
 * and leaf-type rules) to that same read.
 *
 * Every later pass — the full `validateInsertPayload` walk, the record written
 * to the datastore, the document handed to `watch()` — operates on this copy,
 * never on the caller's object. Validating the caller's object and *then*
 * copying it read each property twice, so an accessor property (or a Proxy)
 * could answer the validator with a clean value and the copy with another: a
 * `bigint` that no validator ever saw reached storage that way (ADR-030).
 *
 * Throws `ValidationError`; the copy is only returned when the payload is sound.
 */
export const materializePayload = (
  payload: unknown,
  maxDepth: number = DEFAULT_MAX_DEPTH,
): Record<string, unknown> => {
  if (!isPlainObject(payload)) {
    throw new ValidationError('Document must be a non-null plain object.');
  }
  return materializeObject(payload, new WeakSet<object>(), 1, maxDepth);
};
