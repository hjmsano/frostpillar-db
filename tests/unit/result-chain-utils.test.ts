import assert from 'node:assert/strict';
import test from 'node:test';

import { ValidationError } from '../../src/errors.js';
import {
  applyProjection,
  applySort,
  cloneProjectionSpec,
  cloneSortSpec,
} from '../../src/internal/resultChainUtils.js';
import type {
  FrostpillarDocument,
  FrostpillarStoredDocument,
} from '../../src/types.js';

const pathCache = new Map<string, string[]>();

// ---------------------------------------------------------------------------
// cloneSortSpec
// ---------------------------------------------------------------------------

void test('cloneSortSpec throws when spec is not an object or array', () => {
  assert.throws(
    () => cloneSortSpec(null as unknown as Record<string, 1 | -1>),
    ValidationError,
  );
  assert.throws(
    () => cloneSortSpec('bad' as unknown as Record<string, 1 | -1>),
    ValidationError,
  );
  assert.throws(
    () => cloneSortSpec(42 as unknown as Record<string, 1 | -1>),
    ValidationError,
  );
});

void test('cloneSortSpec throws when direction is not 1 or -1', () => {
  assert.throws(
    () => cloneSortSpec({ age: 2 as unknown as 1 }),
    ValidationError,
  );
  assert.throws(
    () => cloneSortSpec({ age: 0 as unknown as 1 }),
    ValidationError,
  );
});

void test('cloneSortSpec throws when the field path is invalid', () => {
  assert.throws(() => cloneSortSpec({ '': 1 }), ValidationError);
  assert.throws(() => cloneSortSpec({ 'a..b': 1 }), ValidationError);
});

void test('cloneSortSpec returns a detached copy of a valid spec', () => {
  const input = { age: 1 as const, name: -1 as const };
  const cloned = cloneSortSpec(input);

  assert.deepEqual(cloned, [
    ['age', 1],
    ['name', -1],
  ]);
  assert.notEqual(cloned, input);
});

void test('cloneSortSpec accepts an ordered array and preserves integer-like key order', () => {
  assert.deepEqual(
    cloneSortSpec([
      ['2', 1],
      ['1', 1],
    ]),
    [
      ['2', 1],
      ['1', 1],
    ],
  );
});

void test('cloneSortSpec rejects duplicate fields in array form', () => {
  assert.throws(
    () =>
      cloneSortSpec([
        ['a', 1],
        ['a', -1],
      ] as unknown as Record<string, 1 | -1>),
    ValidationError,
  );
});

void test('cloneSortSpec rejects malformed array entries', () => {
  assert.throws(
    () => cloneSortSpec([['a']] as unknown as Record<string, 1 | -1>),
    ValidationError,
  );
  assert.throws(
    () => cloneSortSpec([['a', 2]] as unknown as Record<string, 1 | -1>),
    ValidationError,
  );
});

// ---------------------------------------------------------------------------
// cloneProjectionSpec
// ---------------------------------------------------------------------------

void test('cloneProjectionSpec throws when spec is not a plain object', () => {
  assert.throws(
    () => cloneProjectionSpec(null as unknown as Record<string, 0 | 1>),
    ValidationError,
  );
});

void test('cloneProjectionSpec throws when value is not 0 or 1', () => {
  assert.throws(
    () => cloneProjectionSpec({ name: 2 as unknown as 1 }),
    ValidationError,
  );
});

void test('cloneProjectionSpec throws when mixing inclusion and exclusion', () => {
  assert.throws(
    () => cloneProjectionSpec({ name: 1, age: 0 }),
    ValidationError,
  );
});

void test('cloneProjectionSpec allows "_id: 0" alongside inclusion', () => {
  const cloned = cloneProjectionSpec({ _id: 0, name: 1 });
  assert.deepEqual(cloned, { _id: 0, name: 1 });
});

void test('cloneProjectionSpec allows pure exclusion', () => {
  const cloned = cloneProjectionSpec({ secret: 0, internal: 0 });
  assert.deepEqual(cloned, { secret: 0, internal: 0 });
});

// ---------------------------------------------------------------------------
// applySort — cross-type ranking
// ---------------------------------------------------------------------------

interface RankDoc extends FrostpillarDocument {
  value: unknown;
}

const makeDoc = (
  id: string,
  value: unknown,
): FrostpillarStoredDocument<RankDoc> =>
  ({ _id: id, value }) as FrostpillarStoredDocument<RankDoc>;

void test('applySort orders values across heterogeneous types by rank', () => {
  // valueRank: undefined=0, null=1, number=2, string=3, boolean=4, object=5
  const docs: FrostpillarStoredDocument<RankDoc>[] = [
    makeDoc('bool', true),
    makeDoc('str', 'hello'),
    makeDoc('num', 42),
    makeDoc('null', null),
    makeDoc('obj', { nested: 1 }),
    makeDoc('undef', undefined),
  ];

  const sorted = applySort(docs, [['value', 1]], pathCache);
  assert.deepEqual(
    sorted.map((doc) => doc._id),
    ['undef', 'null', 'num', 'str', 'bool', 'obj'],
  );
});

void test('applySort descending reverses the ranking order', () => {
  const docs: FrostpillarStoredDocument<RankDoc>[] = [
    makeDoc('num', 1),
    makeDoc('str', 'a'),
    makeDoc('null', null),
  ];

  const sorted = applySort(docs, [['value', -1]], pathCache);
  assert.deepEqual(
    sorted.map((doc) => doc._id),
    ['str', 'num', 'null'],
  );
});

void test('applySort sorts NaN before normal numbers in ascending order', () => {
  const docs: FrostpillarStoredDocument<RankDoc>[] = [
    makeDoc('a', 3),
    makeDoc('nan', Number.NaN),
    makeDoc('b', 1),
  ];

  const sorted = applySort(docs, [['value', 1]], pathCache);
  assert.deepEqual(
    sorted.map((doc) => doc._id),
    ['nan', 'b', 'a'],
  );
});

void test('applySort sorts NaN after normal numbers in descending order', () => {
  const docs: FrostpillarStoredDocument<RankDoc>[] = [
    makeDoc('a', 3),
    makeDoc('nan1', Number.NaN),
    makeDoc('b', 1),
    makeDoc('nan2', Number.NaN),
  ];

  const sorted = applySort(docs, [['value', -1]], pathCache);
  assert.deepEqual(
    sorted.map((doc) => doc._id),
    ['a', 'b', 'nan1', 'nan2'],
  );
});

void test('applySort compares strings by codepoint order, not locale', () => {
  // In some locales, 'ä' sorts near 'a'. By codepoint, 'ä' (U+00E4) > 'z' (U+007A).
  const docs: FrostpillarStoredDocument<RankDoc>[] = [
    makeDoc('ae', 'ä'),
    makeDoc('z', 'z'),
    makeDoc('a', 'a'),
  ];

  const sorted = applySort(docs, [['value', 1]], pathCache);
  assert.deepEqual(
    sorted.map((doc) => doc._id),
    ['a', 'z', 'ae'],
  );
});

void test('applySort compares objects deterministically via JSON', () => {
  const docs: FrostpillarStoredDocument<RankDoc>[] = [
    makeDoc('b', { x: 2 }),
    makeDoc('a', { x: 1 }),
    makeDoc('c', { x: 1 }),
  ];

  const sorted = applySort(docs, [['value', 1]], pathCache);
  // {"x":1} < {"x":2} by JSON.stringify comparison
  assert.deepEqual(
    sorted.map((doc) => doc._id),
    ['a', 'c', 'b'],
  );
});

void test('applySort treats missing fields as smallest', () => {
  const docs: FrostpillarStoredDocument<RankDoc>[] = [
    { _id: 'full', value: 10 } as FrostpillarStoredDocument<RankDoc>,
    { _id: 'missing' } as FrostpillarStoredDocument<RankDoc>,
  ];

  const sorted = applySort(docs, [['value', 1]], pathCache);
  assert.deepEqual(
    sorted.map((doc) => doc._id),
    ['missing', 'full'],
  );
});

void test('applySort falls through to secondary sort key on tie', () => {
  interface TwoFieldDoc extends FrostpillarDocument {
    group: string;
    order: number;
  }
  const docs: FrostpillarStoredDocument<TwoFieldDoc>[] = [
    { _id: '1', group: 'a', order: 2 },
    { _id: '2', group: 'a', order: 1 },
    { _id: '3', group: 'b', order: 1 },
  ] as FrostpillarStoredDocument<TwoFieldDoc>[];

  const sorted = applySort(
    docs,
    [
      ['group', 1],
      ['order', 1],
    ],
    pathCache,
  );
  assert.deepEqual(
    sorted.map((doc) => doc._id),
    ['2', '1', '3'],
  );
});

// ---------------------------------------------------------------------------
// applySort — topK heap path (limit < documents.length)
// ---------------------------------------------------------------------------

void test('applySort with limit exercises the topK heap path', () => {
  interface NumDoc extends FrostpillarDocument {
    n: number;
  }
  const docs: FrostpillarStoredDocument<NumDoc>[] = Array.from(
    { length: 20 },
    (_, index) =>
      ({
        _id: `d${String(index)}`,
        n: (index * 7) % 20, // scrambled
      }) as FrostpillarStoredDocument<NumDoc>,
  );

  const sorted = applySort(docs, [['n', 1]], pathCache, 5);
  assert.equal(sorted.length, 5);
  assert.deepEqual(
    sorted.map((doc) => doc.n),
    [0, 1, 2, 3, 4],
  );
});

void test('applySort with limit >= document count falls back to full sort', () => {
  interface NumDoc extends FrostpillarDocument {
    n: number;
  }
  const docs: FrostpillarStoredDocument<NumDoc>[] = [
    { _id: 'a', n: 3 },
    { _id: 'b', n: 1 },
    { _id: 'c', n: 2 },
  ] as FrostpillarStoredDocument<NumDoc>[];

  const sorted = applySort(docs, [['n', 1]], pathCache, 10);
  assert.deepEqual(
    sorted.map((doc) => doc.n),
    [1, 2, 3],
  );
});

void test('applySort topK is stable on tied keys (matches full sort then slice)', () => {
  interface ValueDoc extends FrostpillarDocument {
    value: number;
  }
  const docs: FrostpillarStoredDocument<ValueDoc>[] = [
    { _id: 'a', value: 1 },
    { _id: 'b', value: 1 },
    { _id: 'c', value: 1 },
    { _id: 'd', value: 2 },
    { _id: 'e', value: 2 },
    { _id: 'f', value: 2 },
  ] as FrostpillarStoredDocument<ValueDoc>[];

  assert.deepEqual(
    applySort(docs, [['value', 1]], pathCache, 2).map((doc) => doc._id),
    ['a', 'b'],
  );
  assert.deepEqual(
    applySort(docs, [['value', 1]], pathCache, 4).map((doc) => doc._id),
    ['a', 'b', 'c', 'd'],
  );
});

void test('applySort topK result equals full sort sliced for the same data', () => {
  interface ValueDoc extends FrostpillarDocument {
    value: number;
  }
  const docs: FrostpillarStoredDocument<ValueDoc>[] = [
    { _id: 'a', value: 1 },
    { _id: 'b', value: 1 },
    { _id: 'c', value: 1 },
    { _id: 'd', value: 2 },
    { _id: 'e', value: 2 },
    { _id: 'f', value: 2 },
  ] as FrostpillarStoredDocument<ValueDoc>[];

  const spec: [string, 1 | -1][] = [['value', 1]];
  const fullSorted = applySort(docs, spec, pathCache);

  for (const k of [1, 2, 3, 4, 5]) {
    assert.deepEqual(
      applySort(docs, spec, pathCache, k).map((doc) => doc._id),
      fullSorted.slice(0, k).map((doc) => doc._id),
      `k=${String(k)}`,
    );
  }

  // Scrambled storage order with all-tied values
  const scrambled: FrostpillarStoredDocument<ValueDoc>[] = [
    { _id: 'f', value: 1 },
    { _id: 'd', value: 1 },
    { _id: 'b', value: 1 },
    { _id: 'e', value: 1 },
    { _id: 'a', value: 1 },
    { _id: 'c', value: 1 },
  ] as FrostpillarStoredDocument<ValueDoc>[];

  const fullScrambled = applySort(scrambled, spec, pathCache);
  for (const k of [1, 2, 3, 4, 5]) {
    assert.deepEqual(
      applySort(scrambled, spec, pathCache, k).map((doc) => doc._id),
      fullScrambled.slice(0, k).map((doc) => doc._id),
      `scrambled k=${String(k)}`,
    );
  }
});

void test('applySort returns input unchanged for empty sort spec', () => {
  const docs: FrostpillarStoredDocument<RankDoc>[] = [
    makeDoc('a', 1),
    makeDoc('b', 2),
  ];
  const sorted = applySort(docs, [], pathCache);
  assert.equal(sorted, docs);
});

void test('applySort orders array-valued fields deterministically (cached JSON key)', () => {
  // JSON.stringify lexicographic order: "[1,1]" < "[1]" < "[2]"
  // because at index 3, ',' (U+002C) < ']' (U+005D)
  const docs: FrostpillarStoredDocument<RankDoc>[] = [
    makeDoc('two', [2]),
    makeDoc('one-one', [1, 1]),
    makeDoc('one', [1]),
  ];

  const sorted1 = applySort(docs, [['value', 1]], pathCache);
  assert.deepEqual(
    sorted1.map((doc) => doc._id),
    ['one-one', 'one', 'two'],
  );

  // Run again with the same doc objects to exercise the WeakMap cache path
  const sorted2 = applySort(docs, [['value', 1]], pathCache);
  assert.deepEqual(
    sorted2.map((doc) => doc._id),
    ['one-one', 'one', 'two'],
  );
});

void test('applySort orders object-valued fields deterministically and equal serializations tie', () => {
  // Two docs whose sort-field objects serialize identically compare equal (tie).
  // Array.prototype.sort is stable in ES2019+, so they keep their original order.
  const sharedValue = { x: 1 };
  const distinctEqualValue = { x: 1 }; // deeply equal but a distinct object identity
  const docs: FrostpillarStoredDocument<RankDoc>[] = [
    makeDoc('high', { x: 2 }),
    makeDoc('first', sharedValue),
    makeDoc('second', distinctEqualValue),
  ];

  // Ascending: {x:1} < {x:2}, and the two {x:1} docs tie (stable order: first, second)
  const sorted = applySort(docs, [['value', 1]], pathCache);
  assert.deepEqual(
    sorted.map((doc) => doc._id),
    ['first', 'second', 'high'],
  );
});

void test('applySort honors array-form precedence for integer-like field names', () => {
  interface IntKeyDoc extends FrostpillarDocument {
    [key: string]: unknown;
  }
  // docA: '2'=1, '1'=3 → sorted by '2' asc first, docA is first
  // docB: '2'=2, '1'=2 → middle
  // docC: '2'=3, '1'=1 → last
  // If '1' were primary, order would be c, b, a. By '2' primary, order is a, b, c.
  const docs: FrostpillarStoredDocument<IntKeyDoc>[] = [
    { _id: 'a', '2': 1, '1': 3 },
    { _id: 'b', '2': 2, '1': 2 },
    { _id: 'c', '2': 3, '1': 1 },
  ] as FrostpillarStoredDocument<IntKeyDoc>[];

  const sorted = applySort(
    docs,
    [
      ['2', 1],
      ['1', 1],
    ],
    pathCache,
  );
  assert.deepEqual(
    sorted.map((doc) => doc._id),
    ['a', 'b', 'c'],
  );
});

// ---------------------------------------------------------------------------
// applyProjection
// ---------------------------------------------------------------------------

void test('applyProjection include mode returns only selected fields', () => {
  interface UserDoc extends FrostpillarDocument {
    name: string;
    age: number;
    email: string;
  }
  const doc: FrostpillarStoredDocument<UserDoc> = {
    _id: 'u1',
    name: 'Alice',
    age: 30,
    email: 'a@example.com',
  };

  const projected = applyProjection(doc, { name: 1 }, pathCache);
  assert.deepEqual(projected, { _id: 'u1', name: 'Alice' });
});

void test('applyProjection include mode with "_id: 0" drops _id', () => {
  interface UserDoc extends FrostpillarDocument {
    name: string;
  }
  const doc: FrostpillarStoredDocument<UserDoc> = { _id: 'u1', name: 'Alice' };
  const projected = applyProjection(doc, { _id: 0, name: 1 }, pathCache);
  assert.deepEqual(projected, { name: 'Alice' });
});

void test('applyProjection exclude mode removes only listed fields', () => {
  interface UserDoc extends FrostpillarDocument {
    name: string;
    secret: string;
  }
  const doc: FrostpillarStoredDocument<UserDoc> = {
    _id: 'u1',
    name: 'Alice',
    secret: 'shh',
  };
  const projected = applyProjection(doc, { secret: 0 }, pathCache);
  assert.deepEqual(projected, { _id: 'u1', name: 'Alice' });
});

void test('applyProjection { _id: 1 } returns only _id (regression for info leak)', () => {
  interface SecretDoc extends FrostpillarDocument {
    name: string;
    secret: string;
    internal: number;
  }
  const doc: FrostpillarStoredDocument<SecretDoc> = {
    _id: 'a',
    name: 'Alice',
    secret: 'TOP',
    internal: 42,
  };
  const projected = applyProjection(doc, { _id: 1 }, pathCache);
  assert.deepEqual(projected, { _id: 'a' });
});

void test('applyProjection { _id: 1, name: 1 } returns only _id and name', () => {
  interface SecretDoc extends FrostpillarDocument {
    name: string;
    secret: string;
  }
  const doc: FrostpillarStoredDocument<SecretDoc> = {
    _id: 'a',
    name: 'Alice',
    secret: 'TOP',
  };
  const projected = applyProjection(doc, { _id: 1, name: 1 }, pathCache);
  assert.deepEqual(projected, { _id: 'a', name: 'Alice' });
});

void test('applyProjection { _id: 0 } returns all fields except _id (exclude mode preserved)', () => {
  interface SecretDoc extends FrostpillarDocument {
    name: string;
    secret: string;
  }
  const doc: FrostpillarStoredDocument<SecretDoc> = {
    _id: 'a',
    name: 'Alice',
    secret: 'TOP',
  };
  const projected = applyProjection(doc, { _id: 0 }, pathCache);
  assert.deepEqual(projected, { name: 'Alice', secret: 'TOP' });
});
