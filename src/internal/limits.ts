/** Maximum number of segments in a dot-notation field path (e.g. "a.b.c" = 3). */
export const MAX_FIELD_PATH_DEPTH = 32;

/** Maximum character length of a dot-notation field path string. */
export const MAX_FIELD_PATH_LENGTH = 512;

/** Maximum nesting depth for $and / $or logical operators in a filter. */
export const MAX_FILTER_NESTING_DEPTH = 32;

/** Maximum character length of a $regex string pattern. */
export const MAX_REGEX_PATTERN_LENGTH = 1024;

/** Maximum number of quantifiers allowed in a $regex pattern (backstop against chained-quantifier ReDoS). */
export const MAX_REGEX_QUANTIFIERS = 20;

/**
 * Maximum number of *optional* quantifiers (minimum repetition count of zero:
 * `?`, `*`, `{0}`, `{0,}`, `{0,m}`) allowed in a $regex pattern.
 *
 * Each optional quantifier makes its atom independently skippable, so k of them
 * give a backtracking engine up to 2^k ways to distribute a *failing* match.
 * None of the other screens see this shape — no atom is repeated, no group is
 * nested or alternated — so `^.?.?...aaa...$` with 20 `.?` atoms sat inside
 * MAX_REGEX_QUANTIFIERS and cost ~1.5 ms per failing evaluation (~15 s over a
 * 10,000-document zero-match scan, which `maxMatchedDocuments` never cuts short
 * because nothing matches). A cap of 8 bounds the shape at ~2^8 = 256 paths.
 */
export const MAX_REGEX_OPTIONAL_QUANTIFIERS = 8;

/**
 * Maximum number of alternation groups `(a|b)` allowed in a $regex pattern
 * (backstop against unrolled/manually-repeated ambiguous alternation, which
 * carries no quantifier token and so evades MAX_REGEX_QUANTIFIERS and the
 * quantifier-keyed CATASTROPHIC_PATTERNS heuristics).
 */
export const MAX_REGEX_ALTERNATION_GROUPS = 4;

/** Maximum character length of a field value tested against a $regex pattern. */
export const MAX_REGEX_TEST_LENGTH = 8192;

/** Maximum number of elements in a single document array field (for $push / $addToSet). */
export const MAX_ARRAY_LENGTH = 100_000;

/** Maximum number of elements in a $in / $nin / $all operand array. */
export const MAX_OPERAND_ARRAY_SIZE = 10_000;

/** Maximum number of distinct group keys in a groupBy operation. */
export const MAX_GROUP_COUNT = 100_000;

/** Maximum number of documents in a single groupBy group. */
export const MAX_GROUP_DOCUMENTS = 100_000;

/** Maximum number of distinct values returned by distinct(). */
export const MAX_DISTINCT_COUNT = 100_000;

/** Maximum number of elements in a single $and / $or operand array. */
export const MAX_LOGICAL_OPERAND_COUNT = 1_000;

/** Default maximum number of matched documents returned by a single scan (find/update/remove). */
export const DEFAULT_MAX_MATCHED_DOCUMENTS = 100_000;

/**
 * Default maximum nesting depth for insert payloads and update operator
 * values (`$set` / `$push` / `$addToSet`), overridable via
 * `payloadLimits.maxDepth`. Enforced during validation, before recursion, to
 * prevent stack-overflow DoS from pathologically deep input.
 */
export const DEFAULT_MAX_DEPTH = 64;
