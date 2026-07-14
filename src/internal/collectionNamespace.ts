import { validateCollectionName } from './collectionName.js';

/**
 * Characters a namespace fragment may carry verbatim. Everything else is
 * percent-escaped. `.` is deliberately excluded: it is the delimiter the
 * drivers build their key spaces from (see `collectionNamespace`).
 */
const UNSAFE_FRAGMENT_CHAR = /[^A-Za-z0-9_-]/g;

const escapeChar = (char: string): string => {
  const code = char.codePointAt(0) ?? 0;
  return `%${code.toString(16).toUpperCase().padStart(2, '0')}`;
};

/**
 * Encodes a collection name into a namespace fragment for a driver factory —
 * a `fileName`, `databaseKey`, `databaseName`, `directoryName`, or `keyPrefix`
 * (spec 01 §1.7).
 *
 * A validated collection name is safe to *place* in a file name or storage key,
 * but it is not safe to use as a namespace fragment, because it may contain the
 * `.` that drivers use as their own delimiter. The file backend names its data
 * files `<fileName>.fpdb.g.<generation>` and, on open, deletes every file in the
 * directory starting with `<fileName>.fpdb.g.` except its own active generation.
 * The collections `foo` and `foo.fpdb.g.0` are both valid names, and the second
 * one's data file (`foo.fpdb.g.0.fpdb.g.0`) begins with the first one's deletion
 * prefix — so opening `foo` deleted it and `foo.fpdb.g.0` reopened empty.
 *
 * The encoding percent-escapes every character outside `[A-Za-z0-9_-]`, which
 * for a valid collection name means the dots: `orders.2026` -> `orders%2E2026`.
 * The result is
 *
 * - **injective** — `%` cannot appear in a valid collection name, so it is free
 *   to serve as the escape character and distinct names encode distinctly; and
 * - **delimiter-free** — no `.` survives, so no fragment can be a delimited
 *   prefix of another fragment.
 *
 * Throws `ValidationError` for a name `collection()` would itself reject.
 */
export const collectionNamespace = (name: string): string => {
  validateCollectionName(name);
  return name.replace(UNSAFE_FRAGMENT_CHAR, escapeChar);
};
