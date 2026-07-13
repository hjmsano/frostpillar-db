import { ValidationError } from '../errors.js';
import {
  MAX_REGEX_ALTERNATION_GROUPS,
  MAX_REGEX_PATTERN_LENGTH,
  MAX_REGEX_QUANTIFIERS,
  MAX_REGEX_VARIABLE_QUANTIFIERS,
} from './limits.js';

/**
 * Hand-written catastrophic-backtracking detectors that cover shapes NOT
 * subsumed by the general, algorithmic `hasNestedQuantifier` and
 * `hasQuantifiedAlternationGroup` checks below: adjacency and backreference
 * shapes rather than nesting or quantified alternation.
 *
 * Nested-quantifier shapes (a quantified group whose own content is itself
 * quantified, in any combination of `+`/`*`/`?`/`{n,m}` syntax on either
 * side) used to be covered here by several hand-written entries, one per
 * specific quantifier-syntax combination. Round-2 adversarial testing found
 * `^(a{1,10}){1,10}$` — bounded-inside-bounded — slipped through all of them,
 * because none had been written for that exact combination. Rather than add
 * yet another enumerated entry for this one shape, those entries were
 * replaced by `hasNestedQuantifier`, a single structural check that detects
 * the nested-quantifier shape regardless of which quantifier syntax is used
 * on either side. See ADR for the round-2 follow-up.
 *
 * Alternation-with-quantifier used to be covered here by the entry
 * `/\([^)]*\|[^)]*\)[+*]/`, which matched only a literal `+`/`*` after the
 * group: a repeating brace bound (`(aa|a){2,}`, `(?:aa|a){2,50}`) evaded it
 * while still exploding as ~2^n paths. That entry was replaced by
 * `hasQuantifiedAlternationGroup`, a structural check that covers every
 * repeating quantifier syntax via the shared `quantifierRepeats` rule.
 */
const CATASTROPHIC_PATTERNS: RegExp[] = [
  /\(\.\*[^)]*\.\*\)/, // overlapping wildcards inside group: (.*a.*)
  /([+*?])\{?\d*,?\d*\}?\1/, // adjacent quantifiers
  /\\[1-9]\d*[+*]/, // backreference with quantifier: (a+)\1+, (...)\2*
  // Adjacent quantified classes/wildcards: \d+\d+, .+.+, [a-z]+[a-z]+, \w*\w*
  /(?:\\[dDwWsS]|\.|\[[^\]]*\])(?:[+*]|\{\d+,\d*\})\??(?:\\[dDwWsS]|\.|\[[^\]]*\])(?:[+*]|\{\d+,\d*\})\??/,
  // Adjacent same-literal quantifiers: a+a+, a*a+
  /([A-Za-z0-9])(?:[+*]|\{\d+,\d*\})\??\1(?:[+*]|\{\d+,\d*\})\??/,
];

/**
 * Count unescaped quantifier tokens in a regex pattern string.
 * Tokens inside character classes `[...]` are excluded.
 * Escaped quantifiers (e.g. `\*`) are not counted.
 *
 * A `?` that appears immediately after an unescaped `(` is always group
 * syntax in JS regex — `(?:`, `(?=`, `(?!`, `(?<=`, `(?<!`, `(?<name>` —
 * and is therefore not counted as a quantifier token. The remaining
 * group-type characters (`:`, `=`, `!`, `<`, name chars, `>`) are
 * ordinary content characters and do not affect the count.
 */
const countQuantifiers = (pattern: string): number => {
  let count = 0;
  let inClass = false;
  let escaped = false;
  // True when the immediately preceding consumed unescaped character (outside
  // a class) was '('. A '?' seen in this state is group syntax, not a
  // quantifier, and must not be counted.
  let afterOpenParen = false;

  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];

    if (escaped) {
      escaped = false;
      afterOpenParen = false;
      continue;
    }

    if (ch === '\\') {
      escaped = true;
      afterOpenParen = false;
      continue;
    }

    if (inClass) {
      if (ch === ']') {
        inClass = false;
      }
      // afterOpenParen was reset to false when '[' was seen; no '(' inside a
      // character class opens a group, so it stays false throughout the class.
      continue;
    }

    if (ch === '[') {
      inClass = true;
      afterOpenParen = false;
      continue;
    }

    if (ch === '(') {
      afterOpenParen = true;
      continue;
    }

    if (ch === '*' || ch === '+') {
      count++;
      afterOpenParen = false;
      continue;
    }

    if (ch === '?') {
      if (!afterOpenParen) {
        // Real quantifier — not part of group syntax.
        count++;
      }
      // If afterOpenParen was true, this '?' is a group-syntax prefix
      // ((?:, (?=, (?!, (?<=, (?<!, (?<name>) and must not be counted.
      afterOpenParen = false;
      continue;
    }

    if (ch === '{') {
      // Check whether this opens a {n}, {n,}, or {n,m} quantifier bound.
      const rest = pattern.slice(i + 1);
      if (/^\d+,?\d*\}/.test(rest)) {
        count++;
        // Advance past the closing '}'.
        const closeIdx = rest.indexOf('}');
        i += closeIdx + 1;
      }
      afterOpenParen = false;
      continue;
    }

    // Any other character (letters, digits, ')', '|', '^', '$', '.', etc.)
    afterOpenParen = false;
  }

  return count;
};

/**
 * Count alternation groups `(a|b)` in a regex pattern string: parenthesized
 * groups whose own top-level content contains at least one unescaped `|`. A
 * `|` belonging to a nested sub-group is attributed only to that innermost
 * group, not propagated to the enclosing group that contains it.
 *
 * This is a backstop against manually-unrolled ambiguous alternation (e.g.
 * `(a|aa)(a|aa)(a|aa)...` repeated with no quantifier character at all),
 * which produces the same class of exponential backtracking blowup as a
 * quantified alternation group but carries zero quantifier tokens, so it
 * evades `countQuantifiers` and every quantifier-keyed pattern in
 * `CATASTROPHIC_PATTERNS`.
 *
 * Escape and character-class handling mirrors `countQuantifiers` above:
 * tokens inside `[...]` are ignored, and escaped characters (`\(`, `\|`,
 * `\)`) do not open/close a group or count as a pipe.
 *
 * Unbalanced/unclosed groups at end-of-string are handled gracefully — this
 * function never throws; a genuinely malformed pattern fails at
 * `new RegExp()` time instead.
 */
export const countAlternationGroups = (pattern: string): number => {
  let count = 0;
  let inClass = false;
  let escaped = false;
  const groupHasPipe: boolean[] = [];

  for (const ch of pattern) {
    if (escaped) {
      escaped = false;
      continue;
    }

    if (ch === '\\') {
      escaped = true;
      continue;
    }

    if (inClass) {
      if (ch === ']') {
        inClass = false;
      }
      continue;
    }

    if (ch === '[') {
      inClass = true;
      continue;
    }

    if (ch === '(') {
      groupHasPipe.push(false);
      continue;
    }

    if (ch === '|') {
      if (groupHasPipe.length > 0) {
        groupHasPipe[groupHasPipe.length - 1] = true;
      }
      continue;
    }

    if (ch === ')') {
      const hadPipe = groupHasPipe.pop();
      if (hadPipe === true) {
        count++;
      }
    }
  }

  return count;
};

/**
 * Decide whether a quantifier lets its target match two or more times — the
 * property that makes a nested quantifier catastrophic. `+`, `*`, unbounded
 * `{n,}`, and bounded `{n,m}`/`{n}` with a maximum of `>= 2` all repeat; `?`
 * and `{0,1}`/`{1,1}`/`{1}`/`{0,0}` cap the target at a single match and so
 * can never cause exponential backtracking, however the group's content is
 * quantified. `bound` is the digits/comma between `{` and `}` (e.g. `"1,10"`,
 * `"3"`, `"2,"`); pass `undefined` for the single-character `+`/`*`/`?` forms
 * (all of which are handled by their literal chars, so this is only called
 * for the `{...}` case).
 */
const quantifierRepeats = (bound: string): boolean => {
  const commaIndex = bound.indexOf(',');
  if (commaIndex === -1) {
    // `{n}` — repeats iff n >= 2.
    return Number(bound) >= 2;
  }
  const max = bound.slice(commaIndex + 1);
  // `{n,}` (open-ended) always reaches >= 2; `{n,m}` repeats iff m >= 2.
  return max === '' || Number(max) >= 2;
};

/**
 * Decide whether a `{n}` / `{n,}` / `{n,m}` bound is *variable-width*: whether
 * its minimum and maximum repetition counts differ, so the engine has a choice
 * of how many repetitions to consume. `{n,}` is always variable (unbounded
 * maximum); `{n,m}` is variable iff `m > n`; a bare `{n}` (and the degenerate
 * `{n,n}`) is fixed-width. `bound` is the digits/comma between `{` and `}`
 * (e.g. `"0,5"`, `"1,2"`, `"3"`).
 */
const quantifierIsVariableWidth = (bound: string): boolean => {
  const commaIndex = bound.indexOf(',');
  if (commaIndex === -1) return false; // `{n}` — fixed width.
  const max = bound.slice(commaIndex + 1);
  if (max === '') return true; // `{n,}` — unbounded.
  const min = bound.slice(0, commaIndex);
  return Number(max) > Number(min);
};

/**
 * Count *variable-width* quantifier tokens: those whose minimum and maximum
 * repetition counts differ, so the atom they quantify can be consumed at more
 * than one width — `?` (0-1), `*` (0-inf), `+` (1-inf), and any `{n,}` or
 * `{n,m}` bound with `m > n`. A fixed-width `{n}` is not counted: it consumes
 * exactly n repetitions and offers the engine nothing to backtrack over.
 *
 * Each variable-width quantifier is an independent choice point for the
 * backtracking engine, so a chain of k of them costs an exponential number of
 * paths whenever the overall match *fails* — and a failing match is the common
 * case during a scan. This is the one catastrophic shape none of the other
 * screens see: `^.?.?...aaa...$` (20 `.?` atoms, then 20 literal `a`s) repeats
 * no atom, nests no quantifier, contains no alternation, and has no
 * adjacent-duplicate pair for `CATASTROPHIC_PATTERNS` to match, yet it burns
 * ~2^20 paths per failing test. `MAX_REGEX_VARIABLE_QUANTIFIERS` caps the
 * exponent; see `assertSafeRegexPattern`.
 *
 * The counter originally recognised only the *skippable* quantifiers — those
 * with a minimum of zero. Raising the minimum to one preserved the shape and
 * evaded the cap entirely: `(?:.{1,2}){1}`-style chains of `{1,2}` atoms still
 * distribute a failing match 2^k ways (~5.2 ms per warmed non-match, which a
 * collection scan multiplies by the document count), and a chain of `+`/`{1,}`
 * atoms is worse still. Minimum-of-zero is therefore not the property that
 * matters; a variable width is.
 *
 * The count is over the whole pattern, not over the longest adjacent run: a
 * fixed-width atom interleaved between the variable ones (`.?\w.?\w…`) always
 * consumes the same width and therefore prunes no branch, so it does not make
 * the chain safe.
 *
 * Deliberately conservative in one spot: the lazy marker of `*?` / `+?` /
 * `{n,m}?` is itself a `?` token and is counted a second time. It over-counts
 * harmlessly.
 *
 * Scanning conventions mirror `countQuantifiers` above: tokens inside `[...]`
 * are ignored, escaped tokens (`\?`, `\*`) do not count, and a `?` immediately
 * after an unescaped `(` is group syntax (`(?:`, `(?=`, `(?<name>`), not a
 * quantifier.
 */
export const countVariableWidthQuantifiers = (pattern: string): number => {
  let count = 0;
  let inClass = false;
  let escaped = false;
  let afterOpenParen = false;

  for (let i = 0; i < pattern.length; i += 1) {
    const ch = pattern[i];

    if (escaped) {
      escaped = false;
      afterOpenParen = false;
      continue;
    }

    if (ch === '\\') {
      escaped = true;
      afterOpenParen = false;
      continue;
    }

    if (inClass) {
      if (ch === ']') {
        inClass = false;
      }
      continue;
    }

    if (ch === '[') {
      inClass = true;
      afterOpenParen = false;
      continue;
    }

    if (ch === '(') {
      afterOpenParen = true;
      continue;
    }

    if (ch === '*' || ch === '+') {
      count += 1;
      afterOpenParen = false;
      continue;
    }

    if (ch === '?') {
      if (!afterOpenParen) {
        // Real quantifier — not a group-syntax prefix.
        count += 1;
      }
      afterOpenParen = false;
      continue;
    }

    if (ch === '{') {
      const rest = pattern.slice(i + 1);
      const match = /^\d+,?\d*\}/.exec(rest);
      if (match !== null) {
        const bound = match[0].slice(0, -1); // strip the closing '}'
        if (quantifierIsVariableWidth(bound)) {
          count += 1;
        }
        // Advance past the closing '}'.
        i += match[0].length;
      }
      afterOpenParen = false;
      continue;
    }

    afterOpenParen = false;
  }

  return count;
};

/**
 * Detects a *repeated alternation group*: a repeating quantifier — `+`, `*`,
 * or a `{n}`/`{n,}`/`{n,m}` bound that repeats per `quantifierRepeats` —
 * applied to a group that contains an unescaped `|` *at any nesting depth*.
 * An ambiguous alternation under a repeat (`(aa|a){2,}`) explodes as ~2^n
 * backtracking paths even when the bound is finite (`(aa|a){2,50}` is
 * ~2^50), so any repeating bound is rejected.
 *
 * The pipe is propagated outward as each group closes: a repeat on an
 * enclosing group repeats everything nested inside it, so a redundant
 * wrapping group must not be able to hide the alternation from the outer
 * repeat. `(a|aa)+`, `((a|aa))+`, and `(?:(?:a|ab))+` are all rejected;
 * without propagation the latter two evade the screen entirely.
 *
 * This replaces the hand-written `CATASTROPHIC_PATTERNS` entry
 * `/\([^)]*\|[^)]*\)[+*]/`, which matched only a literal `+`/`*` after the
 * group and missed every brace-quantified repeat. The screen is deliberately
 * conservative and performs no ambiguity analysis: `(a|b)+` is rejected even
 * though its branches do not overlap, matching the prior entry's behavior.
 * By the same token it makes no attempt to prove that an inner alternation
 * is delimited from ambiguity by surrounding literals — a repeated group
 * that carries a pipe anywhere within it (`(x(a|b)y)+`) is rejected.
 *
 * A *non-repeating* quantifier (`?`, `{0,1}`, `{1}`) matches the group at
 * most once and cannot backtrack exponentially, so `(a|b)?` and `(a|b){1}`
 * are accepted, as are bare alternation groups (`(a|b)`, `(?:a|b)`), which
 * remain subject to the `MAX_REGEX_ALTERNATION_GROUPS` count limit.
 *
 * Scanning conventions mirror `countAlternationGroups` above: tokens inside
 * `[...]` are ignored, escaped characters (`\(`, `\|`, `\)`) do not open or
 * close a group or count as a pipe, and the `{n,m}` lookahead/advance logic
 * matches `countQuantifiers`'s. A `?` needs no group-syntax special case
 * here: the group-syntax `?` of `(?:`/`(?=`/`(?<name>` follows a `(` (never
 * a `)`), and a real `?` quantifier is non-repeating — neither can flag the
 * shape.
 *
 * Unbalanced/unclosed groups are handled gracefully (popped value defaults
 * to `false`) — this function never throws; a genuinely malformed pattern
 * fails at `new RegExp()` time instead.
 */
export const hasQuantifiedAlternationGroup = (pattern: string): boolean => {
  let inClass = false;
  let escaped = false;
  const groupHasPipe: boolean[] = [];
  // Set when a ')' closes a group that carried a pipe (its own or one
  // propagated up from a nested group) — but only for the single next token:
  // any other character in between resets it to null.
  let lastClosedGroupHadPipe: boolean | null = null;

  for (let i = 0; i < pattern.length; i += 1) {
    const ch = pattern[i];

    if (escaped) {
      escaped = false;
      lastClosedGroupHadPipe = null;
      continue;
    }

    if (ch === '\\') {
      escaped = true;
      lastClosedGroupHadPipe = null;
      continue;
    }

    if (inClass) {
      if (ch === ']') {
        inClass = false;
      }
      lastClosedGroupHadPipe = null;
      continue;
    }

    if (ch === '[') {
      inClass = true;
      lastClosedGroupHadPipe = null;
      continue;
    }

    if (ch === '(') {
      groupHasPipe.push(false);
      lastClosedGroupHadPipe = null;
      continue;
    }

    if (ch === '|') {
      if (groupHasPipe.length > 0) {
        groupHasPipe[groupHasPipe.length - 1] = true;
      }
      lastClosedGroupHadPipe = null;
      continue;
    }

    if (ch === ')') {
      const closedHadPipe = groupHasPipe.pop() ?? false;
      lastClosedGroupHadPipe = closedHadPipe;
      // Propagate a pipe up to the enclosing group: a repeat applied to a
      // parent group repeats everything nested inside it, so an alternation
      // at any depth under that repeat is exposed to the same catastrophic
      // backtracking. Without this, one redundant wrapping group
      // (`((a|aa))+`, `(?:(?:a|ab))+`) hides the pipe from the outer
      // repeat and evades the screen entirely.
      if (closedHadPipe && groupHasPipe.length > 0) {
        groupHasPipe[groupHasPipe.length - 1] = true;
      }
      continue;
    }

    if (ch === '*' || ch === '+') {
      if (lastClosedGroupHadPipe === true) {
        return true;
      }
      lastClosedGroupHadPipe = null;
      continue;
    }

    if (ch === '{') {
      const rest = pattern.slice(i + 1);
      const match = /^\d+,?\d*\}/.exec(rest);
      if (match !== null) {
        const bound = match[0].slice(0, -1); // strip the closing '}'
        if (lastClosedGroupHadPipe === true && quantifierRepeats(bound)) {
          return true;
        }
        // Advance past the closing '}'.
        i += match[0].length;
      }
      lastClosedGroupHadPipe = null;
      continue;
    }

    // Any other character — including a real '?' quantifier (non-repeating)
    // and the group-syntax '?' of '(?:' (not a quantifier at all).
    lastClosedGroupHadPipe = null;
  }

  return false;
};

/**
 * Detects a dangerous "nested quantifier": a parenthesized group that is
 * *repeated* (`+`, `*`, or a `{n,m}` whose maximum is 2+/unbounded), whose
 * own content contains another quantifier anywhere within it (at any nesting
 * depth), in any quantifier syntax. This is the classic catastrophic-
 * backtracking shape (`(a+)+`), generalized: round-2 adversarial testing
 * found `(a{1,10}){1,10}` — bounded-inside-bounded — evaded every hand-
 * written `CATASTROPHIC_PATTERNS` entry because each was written for one
 * specific quantifier-syntax combination. This algorithmic check subsumes
 * all of them at once.
 *
 * The outer quantifier must *repeat* the group to be dangerous. A group
 * quantified by `?` (or a max-<=1 bound like `{0,1}`) matches at most once,
 * so no amount of inner quantification can make it backtrack exponentially —
 * ubiquitous, benign patterns like `(\d+)?`, `(https?)?`, or `^(v\d+)?$`
 * must therefore be accepted, not flagged. A non-repeating quantifier is
 * still recorded as "content" of any enclosing group, so a repeating
 * *outer* quantifier around it is still caught (e.g. `((a+)?)+`).
 *
 * Escape and character-class handling mirrors `countQuantifiers` above:
 * tokens inside `[...]` are ignored, escaped characters do not count as a
 * quantifier or group boundary, and the `{n,m}` lookahead/advance logic is
 * identical to `countQuantifiers`'s.
 *
 * A `?` that appears immediately after an unescaped `(` is always group
 * syntax in JS regex (`(?:`, `(?=`, `(?!`, `(?<=`, `(?<!`, `(?<name>`) and
 * is therefore not treated as a quantifier token that marks the group as
 * having inner quantification. Only a `?` that is NOT immediately after `(`
 * (i.e., a real optional-quantifier on a preceding atom or closing paren)
 * is counted. This means `(?:abc)+`, `(?<name>abc)+`, `(?:abc)*`, and
 * similar patterns are correctly accepted (their group content contains no
 * real quantifier); `(?:a+)+` and `(?<name>a+)+` are still correctly
 * rejected (the `+` on `a` is a genuine inner quantifier).
 *
 * Algorithm: track, per currently-open group (a stack of booleans), whether
 * a quantifier has been seen anywhere inside it since it opened. When a `)`
 * closes a group, remember whether that group contained a quantifier
 * (`lastClosedGroupHadQuantifier`) — but only for the single next token: any
 * other character in between resets it to `null`. If the very next token
 * after a `)` is a *repeating* quantifier AND the just-closed group contained
 * a quantifier, that repeat is being applied to an already-quantified group:
 * report the nested-quantifier shape immediately. Every quantifier token
 * (repeating or not) marks every currently-open group (at every nesting
 * depth) as "has a quantifier", so an enclosing group's own later repeating
 * quantifier can still detect the nesting even though the inner quantifier's
 * group has already closed further down the stack.
 *
 * Unbalanced/unclosed groups are handled gracefully (popped value defaults
 * to `false`) — this function never throws; a genuinely malformed pattern
 * fails at `new RegExp()` time instead.
 */
export const hasNestedQuantifier = (pattern: string): boolean => {
  let inClass = false;
  let escaped = false;
  const groupHasQuantifier: boolean[] = [];
  let lastClosedGroupHadQuantifier: boolean | null = null;
  // True when the immediately preceding consumed unescaped character (outside
  // a class) was '('. A '?' seen in this state is group syntax
  // ((?:, (?=, (?!, (?<=, (?<!, (?<name>), not a quantifier token.
  let afterOpenParen = false;

  // Record a quantifier token. `repeating` is true when it lets its target
  // match 2+ times. Returns true only when a repeating quantifier is applied
  // directly to a group that itself contained a quantifier (the catastrophic
  // nested shape). Either way the quantifier counts as content of every
  // currently-open enclosing group.
  const applyQuantifier = (repeating: boolean): boolean => {
    if (repeating && lastClosedGroupHadQuantifier === true) {
      return true;
    }
    for (let j = 0; j < groupHasQuantifier.length; j += 1) {
      groupHasQuantifier[j] = true;
    }
    return false;
  };

  for (let i = 0; i < pattern.length; i += 1) {
    const ch = pattern[i];

    if (escaped) {
      escaped = false;
      lastClosedGroupHadQuantifier = null;
      afterOpenParen = false;
      continue;
    }

    if (ch === '\\') {
      escaped = true;
      lastClosedGroupHadQuantifier = null;
      afterOpenParen = false;
      continue;
    }

    if (inClass) {
      if (ch === ']') {
        inClass = false;
      }
      lastClosedGroupHadQuantifier = null;
      // afterOpenParen was reset to false when '[' was seen; no '(' inside a
      // character class opens a group, so it stays false throughout the class.
      continue;
    }

    if (ch === '[') {
      inClass = true;
      lastClosedGroupHadQuantifier = null;
      afterOpenParen = false;
      continue;
    }

    if (ch === '(') {
      groupHasQuantifier.push(false);
      lastClosedGroupHadQuantifier = null;
      afterOpenParen = true;
      continue;
    }

    if (ch === ')') {
      const popped = groupHasQuantifier.pop() ?? false;
      lastClosedGroupHadQuantifier = popped;
      afterOpenParen = false;
      continue;
    }

    if (ch === '*' || ch === '+') {
      if (applyQuantifier(true)) {
        return true;
      }
      lastClosedGroupHadQuantifier = null;
      afterOpenParen = false;
      continue;
    }

    if (ch === '?') {
      if (afterOpenParen) {
        // Group-syntax prefix: (?:, (?=, (?!, (?<=, (?<!, (?<name>…).
        // This '?' is not a quantifier token — do not mark groups or check
        // for nesting. The group just opened with no inner quantifier yet.
        lastClosedGroupHadQuantifier = null;
        afterOpenParen = false;
        continue;
      }
      // Real quantifier: '?' never repeats its target, so it can never be
      // the outer half of a catastrophic nested quantifier; it still counts
      // as inner content of every enclosing group.
      applyQuantifier(false);
      lastClosedGroupHadQuantifier = null;
      afterOpenParen = false;
      continue;
    }

    if (ch === '{') {
      const rest = pattern.slice(i + 1);
      const match = /^\d+,?\d*\}/.exec(rest);
      if (match !== null) {
        const bound = match[0].slice(0, -1); // strip the closing '}'
        if (applyQuantifier(quantifierRepeats(bound))) {
          return true;
        }
        // Advance past the closing '}'.
        i += match[0].length;
        lastClosedGroupHadQuantifier = null;
        afterOpenParen = false;
        continue;
      }
      lastClosedGroupHadQuantifier = null;
      afterOpenParen = false;
      continue;
    }

    lastClosedGroupHadQuantifier = null;
    afterOpenParen = false;
  }

  return false;
};

const assertSafeRegexPattern = (pattern: string): void => {
  if (pattern.length > MAX_REGEX_PATTERN_LENGTH) {
    throw new ValidationError(
      `$regex pattern exceeds maximum length of ${String(MAX_REGEX_PATTERN_LENGTH)} characters.`,
    );
  }

  if (countQuantifiers(pattern) > MAX_REGEX_QUANTIFIERS) {
    throw new ValidationError(
      `$regex pattern exceeds the maximum of ${String(MAX_REGEX_QUANTIFIERS)} quantifiers.`,
    );
  }

  if (countVariableWidthQuantifiers(pattern) > MAX_REGEX_VARIABLE_QUANTIFIERS) {
    throw new ValidationError(
      `$regex pattern exceeds the maximum of ${String(MAX_REGEX_VARIABLE_QUANTIFIERS)} variable-width quantifiers (a chain of atoms whose width the engine can choose risks exponential backtracking).`,
    );
  }

  if (countAlternationGroups(pattern) > MAX_REGEX_ALTERNATION_GROUPS) {
    throw new ValidationError(
      `$regex pattern exceeds the maximum of ${String(MAX_REGEX_ALTERNATION_GROUPS)} alternation groups.`,
    );
  }

  if (hasNestedQuantifier(pattern)) {
    throw new ValidationError(
      '$regex pattern contains a nested quantifier (a quantified group whose content is itself quantified), which risks catastrophic backtracking.',
    );
  }

  if (hasQuantifiedAlternationGroup(pattern)) {
    throw new ValidationError(
      '$regex pattern contains a repeated alternation group (an alternation group followed by a repeating quantifier), which risks catastrophic backtracking.',
    );
  }

  for (const detector of CATASTROPHIC_PATTERNS) {
    if (detector.test(pattern)) {
      throw new ValidationError(
        '$regex pattern is rejected: potential catastrophic backtracking detected.',
      );
    }
  }
};

const compileRegex = (pattern: string): RegExp => {
  assertSafeRegexPattern(pattern);
  try {
    return new RegExp(pattern);
  } catch {
    throw new ValidationError('Invalid regular expression pattern in $regex.');
  }
};

const MAX_REGEX_CACHE_SIZE = 1024;

/**
 * WeakMap for RegExp-keyed regex caching. Keyed by object reference, so it is
 * naturally scoped by key lifetime and does not need per-Database isolation.
 */
const regexCache = new WeakMap<RegExp, RegExp>();

export const getCachedRegex = (
  operand: unknown,
  regexStringCache: Map<string, RegExp>,
): RegExp => {
  if (operand instanceof RegExp) {
    const cached = regexCache.get(operand);
    if (cached !== undefined) {
      return cached;
    }
    // `source` and `flags` are read once each: an own accessor shadowing either
    // prototype getter could otherwise screen one pattern and compile another.
    const source = operand.source;
    const flags = operand.flags;
    assertSafeRegexPattern(source);
    const safeFlags = flags.replace(/[gy]/g, '');
    const safe = new RegExp(source, safeFlags);
    regexCache.set(operand, safe);
    return safe;
  }

  if (typeof operand === 'string') {
    const cached = regexStringCache.get(operand);
    if (cached !== undefined) {
      // Move to MRU position by re-inserting at the end.
      regexStringCache.delete(operand);
      regexStringCache.set(operand, cached);
      return cached;
    }
    const compiled = compileRegex(operand);
    if (regexStringCache.size >= MAX_REGEX_CACHE_SIZE) {
      // Evict the least-recently-used entry (first insertion-order key).
      const lruKey = regexStringCache.keys().next().value;
      if (lruKey !== undefined) {
        regexStringCache.delete(lruKey);
      }
    }
    regexStringCache.set(operand, compiled);
    return compiled;
  }

  throw new ValidationError('$regex expects a RegExp or string pattern.');
};

/**
 * Cache mapping a `$in`/`$nin` operand array to the `Set` built from it.
 *
 * WeakMap semantics:
 * - Key is the array object reference, not its contents.
 * - Per-request filters (fresh array each call) are eligible for GC as soon as
 *   the caller drops the filter; no manual eviction required.
 * - Long-held filter objects (e.g. module-level constants) persist for their
 *   natural lifetime, which is the intended optimisation.
 *
 * Benchmarked in scripts/benchmarks/scenarios/filter-in-cache.bench.ts:
 *   N=10,000  per-request filters → delta after forced GC: +0.15 MB (bounded)
 *   N=100,000 per-request filters → delta after forced GC: +0.01 MB (bounded)
 *   Throughput: ~6,500 $in filter evals/sec on a 200-doc collection
 *
 * Conclusion: memory growth is effectively zero after GC; no LRU replacement needed.
 * See docs/adr/015-weakmap-inclusion-set-cache.md for full rationale.
 *
 * Mutation safety: the cached entry stores the operand length alongside the Set.
 * If `operand.length` differs from the stored length, the entry is rebuilt (O(1)
 * check). This fixes the foot-gun of push/pop/splice on a reused operand array
 * between queries. A same-length in-place element replacement is NOT detected;
 * operands should still be treated as effectively immutable.
 */
export const inclusionSetCache = new WeakMap<
  unknown[],
  { set: Set<unknown>; length: number }
>();

/**
 * Cache mapping a `$in`/`$nin` operand array to the result of `allPrimitive(operand)`.
 *
 * The operand is invariant across all documents in a scan, so the `allPrimitive`
 * check can be computed once per unique operand array reference and reused.
 *
 * Same WeakMap semantics as `inclusionSetCache`: keys are held weakly, so
 * per-request filter arrays are eligible for GC as soon as the caller drops them;
 * no manual eviction required.
 *
 * Mutation safety: the cached entry stores the operand length alongside the
 * boolean result. If `operand.length` differs from the stored length, the entry
 * is rebuilt. A same-length in-place element replacement is NOT detected; treat
 * operands as effectively immutable.
 */
export const operandAllPrimitiveCache = new WeakMap<
  unknown[],
  { value: boolean; length: number }
>();
