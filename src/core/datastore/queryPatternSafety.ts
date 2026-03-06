import { QueryValidationError } from '../errors/index.js';

const MAX_PATTERN_LENGTH = 256;

export const ensurePatternLengthBounded = (
  pattern: string,
  operator: 'like' | 'regexp',
): void => {
  if (pattern.length > MAX_PATTERN_LENGTH) {
    throw new QueryValidationError(
      `${operator} pattern exceeds maximum length of ${MAX_PATTERN_LENGTH}.`,
    );
  }
};

export const matchLikePattern = (value: string, pattern: string): boolean => {
  const textTokens = Array.from(value);
  const patternTokens = Array.from(pattern);
  const rowCount = textTokens.length + 1;
  const columnCount = patternTokens.length + 1;
  const previousRow: boolean[] = Array<boolean>(columnCount).fill(false);
  const currentRow: boolean[] = Array<boolean>(columnCount).fill(false);

  previousRow[0] = true;
  for (let column = 1; column < columnCount; column += 1) {
    if (patternTokens[column - 1] === '%') {
      previousRow[column] = previousRow[column - 1];
    }
  }

  for (let row = 1; row < rowCount; row += 1) {
    currentRow[0] = false;
    for (let column = 1; column < columnCount; column += 1) {
      const token = patternTokens[column - 1];
      if (token === '%') {
        currentRow[column] = currentRow[column - 1] || previousRow[column];
        continue;
      }

      if (token === '_') {
        currentRow[column] = previousRow[column - 1];
        continue;
      }

      currentRow[column] =
        previousRow[column - 1] && textTokens[row - 1] === token;
    }

    for (let column = 0; column < columnCount; column += 1) {
      previousRow[column] = currentRow[column];
      currentRow[column] = false;
    }
  }

  return previousRow[columnCount - 1];
};

interface GroupPatternState {
  containsQuantifier: boolean;
}

const isDigitCharacter = (value: string): boolean => {
  return value >= '0' && value <= '9';
};

const hasBackreference = (pattern: string): boolean => {
  let escaped = false;
  let inCharacterClass = false;

  for (const char of pattern) {
    if (escaped) {
      if (!inCharacterClass && isDigitCharacter(char) && char !== '0') {
        return true;
      }
      escaped = false;
      continue;
    }

    if (char === '\\') {
      escaped = true;
      continue;
    }

    if (!inCharacterClass && char === '[') {
      inCharacterClass = true;
      continue;
    }

    if (inCharacterClass && char === ']') {
      inCharacterClass = false;
    }
  }

  return false;
};

const hasLookAroundAssertion = (pattern: string): boolean => {
  let escaped = false;
  let inCharacterClass = false;

  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === '\\') {
      escaped = true;
      continue;
    }

    if (!inCharacterClass && char === '[') {
      inCharacterClass = true;
      continue;
    }

    if (inCharacterClass) {
      if (char === ']') {
        inCharacterClass = false;
      }
      continue;
    }

    if (char !== '(' || pattern[index + 1] !== '?') {
      continue;
    }

    const next = pattern[index + 2];
    const afterNext = pattern[index + 3];
    if (next === '=' || next === '!') {
      return true;
    }
    if (next === '<' && (afterNext === '=' || afterNext === '!')) {
      return true;
    }
  }

  return false;
};

const readBraceQuantifierEnd = (
  pattern: string,
  startIndex: number,
): number | null => {
  if (pattern[startIndex] !== '{') {
    return null;
  }

  let cursor = startIndex + 1;
  if (!isDigitCharacter(pattern[cursor] ?? '')) {
    return null;
  }
  while (isDigitCharacter(pattern[cursor] ?? '')) {
    cursor += 1;
  }

  if (pattern[cursor] === ',') {
    cursor += 1;
    while (isDigitCharacter(pattern[cursor] ?? '')) {
      cursor += 1;
    }
  }

  if (pattern[cursor] !== '}') {
    return null;
  }
  cursor += 1;

  if (pattern[cursor] === '?') {
    cursor += 1;
  }

  return cursor - 1;
};

const hasNestedQuantifierGroup = (pattern: string): boolean => {
  const groupStateStack: GroupPatternState[] = [];
  let escaped = false;
  let inCharacterClass = false;
  let lastToken: 'none' | 'atom' | 'group' = 'none';
  let lastClosedGroupContainsQuantifier = false;

  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];

    if (escaped) {
      escaped = false;
      lastToken = 'atom';
      continue;
    }

    if (char === '\\') {
      escaped = true;
      continue;
    }

    if (!inCharacterClass && char === '[') {
      inCharacterClass = true;
      lastToken = 'atom';
      continue;
    }

    if (inCharacterClass) {
      if (char === ']') {
        inCharacterClass = false;
      }
      lastToken = 'atom';
      continue;
    }

    if (char === '(') {
      groupStateStack.push({ containsQuantifier: false });
      lastToken = 'none';
      lastClosedGroupContainsQuantifier = false;
      continue;
    }

    if (char === ')') {
      const closedGroup = groupStateStack.pop();
      const containsQuantifier = closedGroup?.containsQuantifier ?? false;
      if (groupStateStack.length > 0 && containsQuantifier) {
        groupStateStack[groupStateStack.length - 1].containsQuantifier = true;
      }
      lastToken = 'group';
      lastClosedGroupContainsQuantifier = containsQuantifier;
      continue;
    }

    const braceQuantifierEnd = readBraceQuantifierEnd(pattern, index);
    const unaryQuantifier =
      char === '*' ||
      char === '+' ||
      (char === '?' && (lastToken === 'atom' || lastToken === 'group'));
    const isQuantifier = unaryQuantifier || braceQuantifierEnd !== null;

    if (isQuantifier) {
      if (lastToken === 'group' && lastClosedGroupContainsQuantifier) {
        return true;
      }

      if (groupStateStack.length > 0) {
        groupStateStack[groupStateStack.length - 1].containsQuantifier = true;
      }
      if (braceQuantifierEnd !== null) {
        index = braceQuantifierEnd;
      }
      lastToken = 'atom';
      continue;
    }

    lastToken = 'atom';
    lastClosedGroupContainsQuantifier = false;
  }

  return false;
};

export const validateRegexpPattern = (pattern: string): void => {
  ensurePatternLengthBounded(pattern, 'regexp');

  if (
    hasBackreference(pattern) ||
    hasLookAroundAssertion(pattern) ||
    hasNestedQuantifierGroup(pattern)
  ) {
    throw new QueryValidationError('Unsafe regexp pattern.');
  }
};
