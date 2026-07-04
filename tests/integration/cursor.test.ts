import assert from 'node:assert/strict';
import test from 'node:test';

import { Database } from '../../src/index.js';
import type { Collection } from '../../src/index.js';

interface UserDocument {
  _id?: string;
  age?: number;
  city?: string | null;
  dept?: string;
  name: string;
  profile?: {
    city?: string;
    score?: number | string;
  };
  salary?: number | string;
  status?: string;
}

const seedUsers = async (users: Collection<UserDocument>): Promise<void> => {
  await users.insertMany([
    {
      _id: 'u1',
      age: 30,
      dept: 'eng',
      name: 'Alice',
      profile: { city: 'Tokyo', score: 2 },
      salary: 100,
      status: 'active',
    },
    {
      _id: 'u2',
      age: 24,
      dept: 'eng',
      name: 'Bob',
      profile: { city: 'Osaka', score: 5 },
      salary: 80,
      status: 'inactive',
    },
    {
      _id: 'u3',
      age: 28,
      dept: 'eng',
      name: 'Carol',
      profile: { city: 'Tokyo', score: 'high' },
      salary: '90',
      status: 'active',
    },
    {
      _id: 'u4',
      age: 28,
      dept: 'design',
      name: 'Dave',
      profile: { city: 'Nagoya' },
      status: 'active',
    },
    {
      _id: 'u5',
      age: 35,
      dept: 'eng',
      name: 'Erin',
      profile: { city: 'Tokyo', score: 1 },
      salary: 200,
      status: 'active',
    },
  ]);
};

// --- cursor tests ---

void test('cursor yields all documents matching toArray', async () => {
  const database = new Database({});
  const users = database.collection<UserDocument>('users');

  try {
    await seedUsers(users);

    const expected = await users.find({ status: 'active' }).toArray();
    const collected: UserDocument[] = [];

    for await (const document of users.find({ status: 'active' }).cursor()) {
      collected.push(document as UserDocument);
    }

    assert.equal(collected.length, expected.length);
    assert.deepEqual(
      collected.map((document) => document._id),
      expected.map((document) => document._id),
    );
  } finally {
    await database.close();
  }
});

void test('cursor applies sort, skip, and limit', async () => {
  const database = new Database({});
  const users = database.collection<UserDocument>('users');

  try {
    await seedUsers(users);

    const chain = users
      .find({ status: 'active' })
      .sort({ age: -1, name: 1 })
      .skip(1)
      .limit(2);
    const expected = await chain.toArray();
    const collected: UserDocument[] = [];

    for await (const document of chain.cursor()) {
      collected.push(document as UserDocument);
    }

    assert.equal(collected.length, expected.length);
    assert.deepEqual(
      collected.map((document) => document._id),
      expected.map((document) => document._id),
    );
  } finally {
    await database.close();
  }
});

void test('cursor applies projection', async () => {
  const database = new Database({});
  const users = database.collection<UserDocument>('users');

  try {
    await seedUsers(users);

    const chain = users.find({ _id: 'u1' }).project({ name: 1 });
    const expected = await chain.toArray();
    const collected: UserDocument[] = [];

    for await (const document of chain.cursor()) {
      collected.push(document as UserDocument);
    }

    assert.equal(collected.length, 1);
    assert.deepEqual(collected[0], expected[0]);
    assert.equal(collected[0]._id, 'u1');
    assert.equal(collected[0].name, 'Alice');
    assert.equal(collected[0].age, undefined);
  } finally {
    await database.close();
  }
});

void test('cursor yields empty for no matches', async () => {
  const database = new Database({});
  const users = database.collection<UserDocument>('users');

  try {
    await seedUsers(users);

    const collected: UserDocument[] = [];

    for await (const document of users.find({ status: 'suspended' }).cursor()) {
      collected.push(document as UserDocument);
    }

    assert.equal(collected.length, 0);
  } finally {
    await database.close();
  }
});

void test('cursor yields defensive clones', async () => {
  const database = new Database({});
  const users = database.collection<UserDocument>('users');

  try {
    await seedUsers(users);

    const documents: UserDocument[] = [];

    for await (const document of users
      .find({ status: 'active' })
      .sort({ name: 1 })
      .cursor()) {
      documents.push(document as UserDocument);
    }

    documents[0].name = 'MUTATED';

    const documents2: UserDocument[] = [];

    for await (const document of users
      .find({ status: 'active' })
      .sort({ name: 1 })
      .cursor()) {
      documents2.push(document as UserDocument);
    }

    assert.notEqual(documents2[0].name, 'MUTATED');
    assert.equal(documents2[0].name, 'Alice');
  } finally {
    await database.close();
  }
});
