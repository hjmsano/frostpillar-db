import assert from 'node:assert/strict';
import test from 'node:test';

import { ValidationError } from '../../src/errors.js';
import { createDatabaseCaches } from '../../src/internal/databaseCaches.js';
import { validateFilter } from '../../src/internal/filterValidator.js';
import type { Filter } from '../../src/types.js';

// Structural filter validation must be exhaustive and independent of any
// document: evaluation short-circuits on the first false predicate, so a
// validator that merely evaluates the filter against `{}` never reaches the
// invalid parts of the filter (bug: `{ a: 1, b: { $nope: 2 } }` was accepted).

const validate = (filter: unknown): void => {
  validateFilter(filter as Filter, createDatabaseCaches());
};

void test('rejects an unknown operator that follows a non-matching condition', () => {
  assert.throws(
    () => {
      validate({ a: 1, b: { $nope: 2 } });
    },
    (error: unknown) =>
      error instanceof ValidationError &&
      error.message.includes('Unknown filter operator "$nope"'),
  );
});

void test('rejects an unknown operator in any $and branch', () => {
  assert.throws(() => {
    validate({ $and: [{ a: 1 }, { b: { $nope: 2 } }] });
  }, ValidationError);
});

void test('rejects an unknown operator in any $or branch', () => {
  assert.throws(() => {
    validate({ $or: [{ a: { $eq: 1 } }, { b: { $nope: 2 } }] });
  }, ValidationError);
});

void test('rejects a reserved key inside a logical branch', () => {
  assert.throws(() => {
    validate({ $and: [{ a: 1 }, { constructor: 1 }] });
  }, ValidationError);
});

void test('rejects an unknown operator nested under $not', () => {
  assert.throws(() => {
    validate({ a: 1, b: { $not: { $nope: 1 } } });
  }, ValidationError);
});

void test('rejects an unknown operator nested under $elemMatch', () => {
  assert.throws(() => {
    validate({ a: 1, items: { $elemMatch: { $nope: 1 } } });
  }, ValidationError);
  assert.throws(() => {
    validate({ a: 1, items: { $elemMatch: { sku: { $nope: 1 } } } });
  }, ValidationError);
});

void test('rejects malformed operands regardless of evaluation order', () => {
  assert.throws(() => {
    validate({ a: 1, b: { $in: 'x' } });
  }, ValidationError);
  assert.throws(() => {
    validate({ a: 1, b: { $nin: 3 } });
  }, ValidationError);
  assert.throws(() => {
    validate({ a: 1, b: { $all: 'x' } });
  }, ValidationError);
  assert.throws(() => {
    validate({ a: 1, b: { $size: -1 } });
  }, ValidationError);
  assert.throws(() => {
    validate({ a: 1, b: { $size: 1.5 } });
  }, ValidationError);
  assert.throws(() => {
    validate({ a: 1, b: { $exists: 'yes' } });
  }, ValidationError);
  assert.throws(() => {
    validate({ a: 1, b: { $regex: 42 } });
  }, ValidationError);
});

void test('rejects an unsafe $regex pattern that evaluation would never reach', () => {
  assert.throws(() => {
    validate({ a: 1, b: { $regex: '(a+)+$' } });
  }, ValidationError);
});

void test('rejects a field condition mixing operators and regular keys', () => {
  assert.throws(() => {
    validate({ a: 1, b: { $eq: 1, c: 2 } });
  }, ValidationError);
});

void test('rejects a non-plain sub-filter in a logical operand', () => {
  assert.throws(() => {
    validate({ a: 1, $or: [{ b: 1 }, new Date()] });
  }, ValidationError);
});

void test('rejects an invalid field path that evaluation would never reach', () => {
  assert.throws(() => {
    validate({ a: 1, 'b..c': 2 });
  }, ValidationError);
});

void test('rejects filters nested beyond the maximum depth', () => {
  let filter: Record<string, unknown> = { a: 1 };
  for (let i = 0; i < 40; i += 1) {
    filter = { $and: [filter] };
  }
  assert.throws(() => {
    validate(filter);
  }, ValidationError);
});

void test('accepts a structurally valid filter', () => {
  assert.doesNotThrow(() => {
    validate({
      name: 'Alice',
      age: { $gte: 18, $lt: 65 },
      tags: { $all: ['a', 'b'], $size: 2 },
      email: { $regex: '^[a-z]+@example\\.com$' },
      deleted: { $exists: false },
      items: { $elemMatch: { sku: { $in: ['x', 'y'] } } },
      score: { $not: { $lt: 10 } },
      'address.city': 'Tokyo',
      $or: [{ role: 'admin' }, { $and: [{ active: true }, { level: 3 }] }],
    });
  });
});

void test('accepts undefined and empty filters', () => {
  assert.doesNotThrow(() => {
    validateFilter(undefined, createDatabaseCaches());
  });
  assert.doesNotThrow(() => {
    validate({});
  });
});
