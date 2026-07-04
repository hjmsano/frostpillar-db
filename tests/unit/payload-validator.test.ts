import assert from 'node:assert/strict';
import test from 'node:test';

import { ValidationError } from '../../src/errors.js';
import {
  validateInsertPayload,
  validatePayloadSecurity,
} from '../../src/internal/payloadValidator.js';

// ---------------------------------------------------------------------------
// Arrays as field values
// ---------------------------------------------------------------------------

void test('validateInsertPayload accepts a document with a top-level array field', () => {
  assert.doesNotThrow(() => {
    validateInsertPayload({ tags: ['a', 'b', 'c'] });
  });
});

void test('validateInsertPayload accepts an empty array field', () => {
  assert.doesNotThrow(() => {
    validateInsertPayload({ tags: [] });
  });
});

void test('validateInsertPayload accepts an array of numbers', () => {
  assert.doesNotThrow(() => {
    validateInsertPayload({ scores: [1, 2, 3] });
  });
});

void test('validateInsertPayload accepts an array of booleans', () => {
  assert.doesNotThrow(() => {
    validateInsertPayload({ flags: [true, false, true] });
  });
});

void test('validateInsertPayload accepts an array containing null', () => {
  assert.doesNotThrow(() => {
    validateInsertPayload({ values: [null, 'x', 1] });
  });
});

void test('validateInsertPayload accepts an array of plain objects', () => {
  assert.doesNotThrow(() => {
    validateInsertPayload({
      items: [
        { name: 'a', qty: 1 },
        { name: 'b', qty: 2 },
      ],
    });
  });
});

void test('validateInsertPayload accepts nested arrays', () => {
  assert.doesNotThrow(() => {
    validateInsertPayload({
      matrix: [
        [1, 2],
        [3, 4],
      ],
    });
  });
});

void test('validateInsertPayload accepts a mixed-type array', () => {
  assert.doesNotThrow(() => {
    validateInsertPayload({ mixed: ['text', 42, true, null, { key: 'val' }] });
  });
});

void test('validateInsertPayload accepts an array inside a nested object', () => {
  assert.doesNotThrow(() => {
    validateInsertPayload({ meta: { tags: ['featured', 'new'] } });
  });
});

// ---------------------------------------------------------------------------
// Invalid array element types
// ---------------------------------------------------------------------------

void test('validateInsertPayload rejects an array containing a bigint', () => {
  assert.throws(
    () => validateInsertPayload({ values: [BigInt(1)] }),
    ValidationError,
  );
});

void test('validateInsertPayload rejects an array containing a function', () => {
  const fn = (() => undefined) as unknown as null;
  assert.throws(() => validateInsertPayload({ fns: [fn] }), ValidationError);
});

void test('validateInsertPayload rejects an array containing a class instance', () => {
  class Foo {}
  assert.throws(
    () => validateInsertPayload({ items: [new Foo() as unknown as null] }),
    ValidationError,
  );
});

void test('validateInsertPayload rejects an array containing an infinite number', () => {
  assert.throws(
    () => validateInsertPayload({ nums: [Infinity] }),
    ValidationError,
  );
});

// ---------------------------------------------------------------------------
// Byte accounting for arrays
// ---------------------------------------------------------------------------

void test('validateInsertPayload rejects an array whose string elements exceed maxStringBytes', () => {
  const longStr = 'x'.repeat(100);
  assert.throws(
    () => validateInsertPayload({ tags: [longStr] }, { maxStringBytes: 10 }),
    ValidationError,
  );
});

void test('validateInsertPayload rejects a document with arrays that collectively exceed maxTotalBytes', () => {
  const data = 'x'.repeat(600);
  assert.throws(
    () =>
      validateInsertPayload({ a: [data], b: [data] }, { maxTotalBytes: 1_024 }),
    ValidationError,
  );
});

// ---------------------------------------------------------------------------
// Regression: previously accepted non-array types still work
// ---------------------------------------------------------------------------

void test('validateInsertPayload still accepts string, number, boolean, null, nested object', () => {
  assert.doesNotThrow(() => {
    validateInsertPayload({
      name: 'Alice',
      age: 30,
      active: true,
      note: null,
      address: { city: 'Tokyo' },
    });
  });
});

void test('validateInsertPayload still rejects bigint at top level', () => {
  assert.throws(() => validateInsertPayload({ n: BigInt(1) }), ValidationError);
});

void test('validateInsertPayload still rejects non-plain objects', () => {
  class Foo {}
  assert.throws(
    () =>
      validateInsertPayload({
        obj: new Foo() as unknown as Record<string, unknown>,
      }),
    ValidationError,
  );
});

// ---------------------------------------------------------------------------
// UTF-8 byte length accounting
// ---------------------------------------------------------------------------

void test('validateInsertPayload accepts multi-byte UTF-8 strings within byte budget', () => {
  // 3 chars * 3 bytes = 9 bytes + 2 quotes = 11 bytes — must fit in limit.
  assert.doesNotThrow(() => {
    validateInsertPayload({ name: 'あいう' }, { maxStringBytes: 9 });
  });
});

void test('validateInsertPayload rejects 3-byte chars that overflow maxStringBytes', () => {
  assert.throws(
    () => validateInsertPayload({ name: 'あいう' }, { maxStringBytes: 8 }),
    ValidationError,
  );
});

void test('validateInsertPayload counts surrogate pairs as 4 UTF-8 bytes', () => {
  // '𝄞' (U+1D11E) is one 4-byte sequence.
  assert.doesNotThrow(() => {
    validateInsertPayload({ sym: '𝄞' }, { maxStringBytes: 4 });
  });
  assert.throws(
    () => validateInsertPayload({ sym: '𝄞' }, { maxStringBytes: 3 }),
    ValidationError,
  );
});

void test('validateInsertPayload counts 2-byte chars correctly', () => {
  // 'ü' is 2 bytes in UTF-8.
  assert.doesNotThrow(() => {
    validateInsertPayload({ v: 'üü' }, { maxStringBytes: 4 });
  });
  assert.throws(
    () => validateInsertPayload({ v: 'üü' }, { maxStringBytes: 3 }),
    ValidationError,
  );
});

// ---------------------------------------------------------------------------
// Key and structural limits
// ---------------------------------------------------------------------------

void test('validateInsertPayload rejects keys whose UTF-8 byte length exceeds maxKeyBytes', () => {
  const longKey = 'k'.repeat(20);
  assert.throws(
    () => validateInsertPayload({ [longKey]: 1 }, { maxKeyBytes: 10 }),
    ValidationError,
  );
});

void test('validateInsertPayload rejects an empty / whitespace-only key', () => {
  assert.throws(() => validateInsertPayload({ '': 1 }), ValidationError);
  assert.throws(() => validateInsertPayload({ '   ': 1 }), ValidationError);
});

void test('validateInsertPayload rejects reserved keys', () => {
  assert.throws(
    () => validateInsertPayload({ constructor: 'nope' }),
    ValidationError,
  );
  assert.throws(
    () => validateInsertPayload({ prototype: 'nope' }),
    ValidationError,
  );
  // __proto__ set via object literal would mutate the prototype chain, so
  // create it as an own data property instead.
  const payload: Record<string, unknown> = {};
  Object.defineProperty(payload, '__proto__', {
    value: 'nope',
    enumerable: true,
    configurable: true,
    writable: true,
  });
  assert.throws(() => validateInsertPayload(payload), ValidationError);
});

void test('validateInsertPayload rejects nesting deeper than maxDepth', () => {
  // depth 3: { a: { a: { a: 1 } } }
  const tooDeep = { a: { a: { a: 1 } } };
  assert.throws(
    () => validateInsertPayload(tooDeep, { maxDepth: 2 }),
    ValidationError,
  );
  assert.doesNotThrow(() => {
    validateInsertPayload(tooDeep, { maxDepth: 3 });
  });
});

// ---------------------------------------------------------------------------
// Array nesting depth (Fix A)
// ---------------------------------------------------------------------------

const deepObj = (n: number): Record<string, unknown> => {
  let o: Record<string, unknown> = { v: 1 };
  for (let i = 0; i < n; i++) o = { a: o };
  return o;
};

const deepArr = (n: number): unknown[] => {
  let a: unknown[] = [1];
  for (let i = 0; i < n; i++) a = [a];
  return a;
};

void test('validateInsertPayload rejects ARRAY nesting deeper than maxDepth', () => {
  assert.throws(
    () => validateInsertPayload({ _id: 'x', a: deepArr(3) }, { maxDepth: 2 }),
    ValidationError,
  );
  assert.doesNotThrow(() => {
    validateInsertPayload({ _id: 'x', a: deepArr(3) }, { maxDepth: 10 });
  });
});

void test('validateInsertPayload does not stack-overflow on a pathologically deep array', () => {
  assert.throws(
    () => validateInsertPayload({ _id: 'x', a: deepArr(50000) }),
    ValidationError,
  );
});

// ---------------------------------------------------------------------------
// Security validator depth cap (Fix B)
// ---------------------------------------------------------------------------

void test('validatePayloadSecurity rejects deeply nested objects beyond the depth cap', () => {
  assert.throws(
    () => validatePayloadSecurity({ _id: 'x', a: deepObj(50000) }),
    ValidationError,
  );
});

void test('validatePayloadSecurity rejects deeply nested arrays beyond the depth cap', () => {
  assert.throws(
    () => validatePayloadSecurity({ _id: 'x', a: deepArr(50000) }),
    ValidationError,
  );
});

void test('validatePayloadSecurity honors a custom maxDepth argument', () => {
  assert.throws(
    () => validatePayloadSecurity({ _id: 'x', a: { b: { c: 1 } } }, 2),
    ValidationError,
  );
  assert.doesNotThrow(() => {
    validatePayloadSecurity({ _id: 'x', a: { b: 1 } }, 2);
  });
});

void test('validateInsertPayload rejects objects exceeding maxKeysPerObject', () => {
  const obj: Record<string, number> = {};
  for (let i = 0; i < 10; i++) {
    obj[`k${String(i)}`] = i;
  }
  assert.throws(
    () => validateInsertPayload(obj, { maxKeysPerObject: 5 }),
    ValidationError,
  );
});

void test('validateInsertPayload rejects documents exceeding maxTotalKeys across nested objects', () => {
  const payload = {
    a: { a1: 1, a2: 2 },
    b: { b1: 1, b2: 2 },
  };
  assert.throws(
    () => validateInsertPayload(payload, { maxTotalKeys: 3 }),
    ValidationError,
  );
});

void test('validateInsertPayload rejects circular references', () => {
  const circular: Record<string, unknown> = { name: 'loop' };
  circular.self = circular;
  assert.throws(() => validateInsertPayload(circular), ValidationError);
});

void test('validateInsertPayload rejects self-referential arrays', () => {
  const arr: unknown[] = [1];
  arr.push(arr);
  assert.throws(() => validateInsertPayload({ items: arr }), ValidationError);
});

void test('validateInsertPayload rejects mixed object/array cycles', () => {
  const arr: unknown[] = [];
  const obj: Record<string, unknown> = { arr };
  arr.push(obj);
  assert.throws(() => validateInsertPayload({ root: obj }), ValidationError);
});
