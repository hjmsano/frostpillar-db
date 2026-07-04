/**
 * Per-Database cache instances.
 *
 * These caches were originally module-level globals shared across all Database
 * instances. Moving them here scopes each cache to a single Database so that:
 *   - Parallel tests / worker threads do not observe each other's state.
 *   - Database.close() naturally releases the associated memory.
 *   - The "Database is the entry point" invariant holds.
 *
 * See bug-12 (tmp/bug-12-module-level-caches.md) for the full rationale.
 */

export interface DatabaseCaches {
  /** LRU cache for parsed field-path segments (documentPath.ts). */
  readonly pathCache: Map<string, string[]>;
  /** Compiled-regex cache keyed by pattern string (filterCache.ts). */
  readonly regexStringCache: Map<string, RegExp>;
}

export const createDatabaseCaches = (): DatabaseCaches => ({
  pathCache: new Map<string, string[]>(),
  regexStringCache: new Map<string, RegExp>(),
});
