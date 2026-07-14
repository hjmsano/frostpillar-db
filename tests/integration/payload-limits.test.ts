import assert from 'node:assert/strict';
import test from 'node:test';

import { Database, ValidationError } from '../../src/index.js';
import type {
  FrostpillarDocument,
  PayloadLimitsConfig,
} from '../../src/index.js';

interface DocWithData extends FrostpillarDocument {
  _id?: string;
  data: string;
}

interface NestedDoc extends FrostpillarDocument {
  _id?: string;
  level: { level: { level: { value: number } } };
}

interface DocWithValue extends FrostpillarDocument {
  _id?: string;
  value: number;
}

// ---------------------------------------------------------------------------
// #1  Default limits — 1 MB payload accepted
// ---------------------------------------------------------------------------

void test('insert accepts a document within the default 1 MB limit', async () => {
  const database = new Database({});
  const col = database.collection<DocWithData>('default-limit');

  try {
    const data = 'x'.repeat(60_000); // ~60 KB, within both maxStringBytes and maxTotalBytes defaults
    const id = await col.insert({ data });

    assert.equal(typeof id, 'string');
    const doc = await col.findOne({ _id: id });
    assert.equal(doc?.data, data);
  } finally {
    await database.close();
  }
});

// ---------------------------------------------------------------------------
// #2  Custom maxTotalBytes — stricter limit rejects large document
// ---------------------------------------------------------------------------

void test('insert rejects a document exceeding custom maxTotalBytes', async () => {
  const payloadLimits: PayloadLimitsConfig = { maxTotalBytes: 1_024 };
  const database = new Database({ payloadLimits });
  const col = database.collection<DocWithData>('strict-limit');

  try {
    const data = 'x'.repeat(2_000); // ~2 KB, exceeds 1 KB limit
    await assert.rejects(() => col.insert({ data }), ValidationError);
  } finally {
    await database.close();
  }
});

// ---------------------------------------------------------------------------
// #3  Custom maxTotalBytes — document within custom limit is accepted
// ---------------------------------------------------------------------------

void test('insert accepts a document within custom maxTotalBytes', async () => {
  const payloadLimits: PayloadLimitsConfig = { maxTotalBytes: 1_024 };
  const database = new Database({ payloadLimits });
  const col = database.collection<DocWithData>('strict-limit-ok');

  try {
    const data = 'x'.repeat(100); // ~100 B, within 1 KB limit
    const id = await col.insert({ data });

    assert.equal(typeof id, 'string');
    const doc = await col.findOne({ _id: id });
    assert.equal(doc?.data, data);
  } finally {
    await database.close();
  }
});

// ---------------------------------------------------------------------------
// #4  Raised maxTotalBytes — allows larger documents (e.g. 16 MB)
// ---------------------------------------------------------------------------

void test('insert accepts a large document when maxTotalBytes and maxStringBytes are raised', async () => {
  const payloadLimits: PayloadLimitsConfig = {
    maxTotalBytes: 16 * 1_024 * 1_024,
    maxStringBytes: 4 * 1_024 * 1_024,
  };
  const database = new Database({ payloadLimits });
  const col = database.collection<DocWithData>('raised-limit');

  try {
    // ~2 MB string — would fail with default limits but passes with raised ones
    const data = 'x'.repeat(2 * 1_024 * 1_024);
    const id = await col.insert({ data });

    assert.equal(typeof id, 'string');
    const doc = await col.findOne({ _id: id });
    assert.equal(doc?.data.length, data.length);
  } finally {
    await database.close();
  }
});

// ---------------------------------------------------------------------------
// #5  Custom maxDepth — rejects overly nested documents
// ---------------------------------------------------------------------------

void test('insert rejects a document exceeding custom maxDepth', async () => {
  const payloadLimits: PayloadLimitsConfig = { maxDepth: 2 };
  const database = new Database({ payloadLimits });
  const col = database.collection<NestedDoc>('depth-limit');

  try {
    await assert.rejects(
      () => col.insert({ level: { level: { level: { value: 1 } } } }),
      ValidationError,
    );
  } finally {
    await database.close();
  }
});

// ---------------------------------------------------------------------------
// #6  Partial override — only specified fields are overridden
// ---------------------------------------------------------------------------

void test('partial payloadLimits overrides only specified fields', async () => {
  // Set very strict maxDepth but leave maxTotalBytes at default (1 MB)
  const payloadLimits: PayloadLimitsConfig = { maxDepth: 2 };
  const database = new Database({ payloadLimits });
  const col = database.collection<DocWithData>('partial-override');

  try {
    // Large-ish document but shallow — should succeed (within default limits)
    const data = 'x'.repeat(60_000);
    const id = await col.insert({ data });
    assert.equal(typeof id, 'string');
  } finally {
    await database.close();
  }
});

// ---------------------------------------------------------------------------
// #7  Limits apply across all collections in the database
// ---------------------------------------------------------------------------

void test('payloadLimits apply to all collections in the database', async () => {
  const payloadLimits: PayloadLimitsConfig = { maxTotalBytes: 1_024 };
  const database = new Database({ payloadLimits });
  const colA = database.collection<DocWithData>('col-a');
  const colB = database.collection<DocWithData>('col-b');

  try {
    const largeData = 'x'.repeat(2_000);
    await assert.rejects(
      () => colA.insert({ data: largeData }),
      ValidationError,
    );
    await assert.rejects(
      () => colB.insert({ data: largeData }),
      ValidationError,
    );
  } finally {
    await database.close();
  }
});

// ---------------------------------------------------------------------------
// #8  Update enforces payload limits on the resulting document
// ---------------------------------------------------------------------------

void test('update rejects when $set produces a document exceeding maxTotalBytes', async () => {
  const payloadLimits: PayloadLimitsConfig = { maxTotalBytes: 1_024 };
  const database = new Database({ payloadLimits });
  const col = database.collection<DocWithData>('update-limit');

  try {
    const id = await col.insert({ data: 'small' });
    // $set with a large value — resulting document exceeds maxTotalBytes
    await assert.rejects(
      () => col.update({ _id: id }, { $set: { data: 'x'.repeat(2_000) } }),
      ValidationError,
    );

    // Original document is unchanged (update was rejected before persist)
    const doc = await col.findOne({ _id: id });
    assert.equal(doc?.data, 'small');
  } finally {
    await database.close();
  }
});

// ---------------------------------------------------------------------------
// #8b  Update accepts when result stays within payload limits
// ---------------------------------------------------------------------------

void test('update accepts when $set result stays within maxTotalBytes', async () => {
  const payloadLimits: PayloadLimitsConfig = { maxTotalBytes: 1_024 };
  const database = new Database({ payloadLimits });
  const col = database.collection<DocWithData>('update-limit-ok');

  try {
    const id = await col.insert({ data: 'small' });
    const result = await col.update({ _id: id }, { $set: { data: 'updated' } });
    assert.equal(result.modifiedCount, 1);

    const doc = await col.findOne({ _id: id });
    assert.equal(doc?.data, 'updated');
  } finally {
    await database.close();
  }
});

// ---------------------------------------------------------------------------
// #8c  Update rejects when $push produces a document exceeding maxTotalBytes
// ---------------------------------------------------------------------------

interface DocWithItems extends FrostpillarDocument {
  _id?: string;
  items: string[];
}

void test('update rejects when $push produces a document exceeding maxTotalBytes', async () => {
  const payloadLimits: PayloadLimitsConfig = { maxTotalBytes: 1_024 };
  const database = new Database({ payloadLimits });
  const col = database.collection<DocWithItems>('update-push-limit');

  try {
    const id = await col.insert({ items: ['a'] });
    await assert.rejects(
      () => col.update({ _id: id }, { $push: { items: 'x'.repeat(2_000) } }),
      ValidationError,
    );

    // Original document is unchanged
    const doc = await col.findOne({ _id: id });
    assert.deepEqual(doc?.items, ['a']);
  } finally {
    await database.close();
  }
});

// ---------------------------------------------------------------------------
// #8d  Update rejects when result exceeds maxDepth
// ---------------------------------------------------------------------------

void test('update rejects when $set produces a document exceeding maxDepth', async () => {
  const payloadLimits: PayloadLimitsConfig = { maxDepth: 2 };
  const database = new Database({ payloadLimits });
  const col = database.collection<DocWithValue>('update-depth-limit');

  try {
    const id = await col.insert({ value: 1 });
    await assert.rejects(
      () =>
        col.update(
          { _id: id },
          { $set: { nested: { deep: { deeper: { value: 2 } } } } },
        ),
      ValidationError,
    );

    // Original document is unchanged
    const doc = await col.findOne({ _id: id });
    assert.equal(doc?.value, 1);
  } finally {
    await database.close();
  }
});

// ---------------------------------------------------------------------------
// #8e  skipPayloadValidation bypasses update validation too
// ---------------------------------------------------------------------------

void test('update bypasses payload limits when skipPayloadValidation is true', async () => {
  const database = new Database({
    payloadLimits: { maxTotalBytes: 1_024 },
    skipPayloadValidation: true,
  });
  const col = database.collection<DocWithData>('update-skip-validation');

  try {
    const id = await col.insert({ data: 'small' });
    const result = await col.update(
      { _id: id },
      { $set: { data: 'x'.repeat(2_000) } },
    );
    assert.equal(result.modifiedCount, 1);

    const doc = await col.findOne({ _id: id });
    assert.equal(doc?.data.length, 2_000);
  } finally {
    await database.close();
  }
});

// ---------------------------------------------------------------------------
// #9  Array payload accepted even when skipPayloadValidation is false
// ---------------------------------------------------------------------------

interface DocWithTags extends FrostpillarDocument {
  _id?: string;
  tags: string[];
}

void test('insert accepts array fields when skipPayloadValidation is false', async () => {
  const database = new Database({ skipPayloadValidation: false });
  const col = database.collection<DocWithTags>('array-payload');

  try {
    const id = await col.insert({ tags: ['a', 'b', 'c'] });
    assert.equal(typeof id, 'string');

    const doc = await col.findOne({ _id: id });
    assert.deepEqual(doc?.tags, ['a', 'b', 'c']);
  } finally {
    await database.close();
  }
});

// ---------------------------------------------------------------------------
// Generated _id / _createdAt count toward the limits on insert
// ---------------------------------------------------------------------------

const objectWithKeys = (count: number): Record<string, unknown> => {
  const doc: Record<string, unknown> = {};
  for (let i = 0; i < count; i += 1) {
    doc[`k${String(i)}`] = i;
  }
  return doc;
};

void test('insert counts the generated _id toward maxKeysPerObject', async () => {
  const database = new Database({ payloadLimits: { maxKeysPerObject: 4 } });
  const col = database.collection('gen-id-keys');

  try {
    // 4 caller keys + the generated _id = 5 keys in the stored document.
    await assert.rejects(
      () => col.insert(objectWithKeys(4) as FrostpillarDocument),
      ValidationError,
    );

    // 3 caller keys + the generated _id = exactly the limit.
    const id = await col.insert(objectWithKeys(3) as FrostpillarDocument);
    // The stored document must stay updatable under the same limit: update
    // validates the stored document, generated _id included.
    const result = await col.update({ _id: id }, { $set: { k0: 99 } });
    assert.equal(result.modifiedCount, 1);
  } finally {
    await database.close();
  }
});

void test('insert counts the generated _createdAt of a TTL collection toward maxKeysPerObject', async () => {
  const database = new Database({ payloadLimits: { maxKeysPerObject: 4 } });
  const col = database.collection('gen-ttl-keys', { ttl: 3600 });

  try {
    // 3 caller keys + generated _id + generated _createdAt = 5 keys.
    await assert.rejects(
      () => col.insert(objectWithKeys(3) as FrostpillarDocument),
      ValidationError,
    );

    const id = await col.insert(objectWithKeys(2) as FrostpillarDocument);
    const result = await col.update({ _id: id }, { $set: { k0: 99 } });
    assert.equal(result.modifiedCount, 1);
  } finally {
    await database.close();
  }
});

void test('insert counts a caller-supplied _id only once', async () => {
  const database = new Database({ payloadLimits: { maxKeysPerObject: 4 } });
  const col = database.collection('supplied-id-keys');

  try {
    const doc = { ...objectWithKeys(3), _id: 'u1' } as FrostpillarDocument;
    assert.equal(await col.insert(doc), 'u1');
  } finally {
    await database.close();
  }
});

void test('insert counts the generated _id toward maxTotalKeys', async () => {
  const database = new Database({ payloadLimits: { maxTotalKeys: 3 } });
  const col = database.collection('gen-id-total-keys');

  try {
    await assert.rejects(
      () => col.insert(objectWithKeys(3) as FrostpillarDocument),
      ValidationError,
    );
    await col.insert(objectWithKeys(2) as FrostpillarDocument);
  } finally {
    await database.close();
  }
});
