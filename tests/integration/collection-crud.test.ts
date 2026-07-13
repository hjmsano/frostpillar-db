import assert from 'node:assert/strict';
import test from 'node:test';

import type { Datastore } from '@frostpillar/frostpillar-storage-engine';

import {
  Database,
  DuplicateIdError,
  ValidationError,
} from '../../src/index.js';

interface UserDocument {
  _id?: string;
  name: string;
  age?: number;
  role?: string;
  visits?: number;
  status?: string;
  profile?: {
    city?: string;
    town?: string;
  };
  temporaryFlag?: boolean;
}

void test('insert generates _id when omitted and stores payload with _id', async () => {
  const database = new Database({});
  const users = database.collection<UserDocument>('users');

  try {
    const id = await users.insert({ name: 'Alice' });

    assert.equal(typeof id, 'string');
    assert.notEqual(id.length, 0);

    const doc = await users.findOne({ _id: id });
    assert.notEqual(doc, null);
    assert.equal(doc?._id, id);
    assert.equal(doc?.name, 'Alice');
  } finally {
    await database.close();
  }
});

void test('insert rejects duplicate _id when policy is reject', async () => {
  const database = new Database({});
  const users = database.collection<UserDocument>('users', {
    duplicateKeys: 'reject',
  });

  try {
    await users.insert({ _id: 'u1', name: 'Alice' });
    await assert.rejects(
      () => users.insert({ _id: 'u1', name: 'Bob' }),
      DuplicateIdError,
    );
  } finally {
    await database.close();
  }
});

void test('insert replaces existing record when policy is replace', async () => {
  const database = new Database({});
  const settings = database.collection<UserDocument>('settings', {
    duplicateKeys: 'replace',
  });

  try {
    await settings.insert({ _id: 'theme', name: 'dark' });
    await settings.insert({ _id: 'theme', name: 'light' });

    const docs = await settings.find({ _id: 'theme' }).toArray();
    assert.equal(docs.length, 1);
    assert.equal(docs[0]?.name, 'light');
  } finally {
    await database.close();
  }
});

void test('insert allows duplicate _id when policy is allow', async () => {
  const database = new Database({});
  const logs = database.collection<UserDocument>('logs', {
    duplicateKeys: 'allow',
  });

  try {
    await logs.insert({ _id: 'session-1', name: 'login' });
    await logs.insert({ _id: 'session-1', name: 'logout' });

    const docs = await logs.find({ _id: 'session-1' }).toArray();
    assert.equal(docs.length, 2);
    assert.equal(docs[0]?.name, 'login');
    assert.equal(docs[1]?.name, 'logout');
  } finally {
    await database.close();
  }
});

void test('insertMany writes nothing when the batch contains a duplicate _id', async () => {
  const database = new Database({});
  const users = database.collection<UserDocument>('users');

  try {
    const events: string[] = [];
    users.watch((event) => events.push(event.documentId));

    await assert.rejects(
      () =>
        users.insertMany([
          { _id: 'u1', name: 'Alice' },
          { _id: 'u1', name: 'Bob' },
          { _id: 'u2', name: 'Carol' },
        ]),
      DuplicateIdError,
    );

    // The duplicate is detected before any write, so no prefix is persisted —
    // and therefore no stored document goes unannounced on watch().
    assert.equal(await users.count(), 0);
    assert.deepEqual(events, []);
  } finally {
    await database.close();
  }
});

void test('insertMany writes nothing when a document duplicates a stored _id', async () => {
  const database = new Database({});
  const users = database.collection<UserDocument>('users');

  try {
    await users.insert({ _id: 'u1', name: 'Alice' });

    const events: string[] = [];
    users.watch((event) => events.push(event.documentId));

    await assert.rejects(
      () =>
        users.insertMany([
          { _id: 'u2', name: 'Bob' },
          { _id: 'u1', name: 'Duplicate' },
          { _id: 'u3', name: 'Carol' },
        ]),
      DuplicateIdError,
    );

    assert.equal(await users.count(), 1);
    assert.equal((await users.findOne({ _id: 'u1' }))?.name, 'Alice');
    assert.equal(await users.find({ _id: 'u2' }).count(), 0);
    assert.deepEqual(events, []);
  } finally {
    await database.close();
  }
});

void test("insertMany still accepts duplicate _ids under duplicateKeys: 'allow'", async () => {
  const database = new Database({});
  const users = database.collection<UserDocument>('users-allow', {
    duplicateKeys: 'allow',
  });

  try {
    const ids = await users.insertMany([
      { _id: 'u1', name: 'Alice' },
      { _id: 'u1', name: 'Bob' },
    ]);
    assert.deepEqual(ids, ['u1', 'u1']);
    assert.equal(await users.count(), 2);
  } finally {
    await database.close();
  }
});

void test("insertMany replaces a stored _id under duplicateKeys: 'replace'", async () => {
  const database = new Database({});
  const users = database.collection<UserDocument>('users-replace', {
    duplicateKeys: 'replace',
  });

  try {
    await users.insert({ _id: 'u1', name: 'Alice' });
    await users.insertMany([{ _id: 'u1', name: 'Bob' }]);
    assert.equal(await users.count(), 1);
    assert.equal((await users.findOne({ _id: 'u1' }))?.name, 'Bob');
  } finally {
    await database.close();
  }
});

void test('find/findOne/count apply filter operators and dot notation', async () => {
  const database = new Database({});
  const users = database.collection<UserDocument>('users');

  try {
    await users.insertMany([
      {
        _id: 'u1',
        age: 30,
        name: 'Alice',
        profile: { city: 'Tokyo' },
        role: 'admin',
        status: 'active',
      },
      {
        _id: 'u2',
        age: 24,
        name: 'Bob',
        profile: { city: 'Osaka' },
        role: 'member',
        status: 'inactive',
      },
      {
        _id: 'u3',
        age: 28,
        name: 'Carol',
        role: 'member',
        status: 'active',
      },
    ]);

    const active = await users.find({ status: 'active' }).toArray();
    assert.equal(active.length, 2);

    const tokyo = await users.findOne({ 'profile.city': 'Tokyo' });
    assert.equal(tokyo?._id, 'u1');

    const regex = await users.find({ name: { $regex: '^A' } }).count();
    assert.equal(regex, 1);

    const withProfileCity = await users.count({
      'profile.city': { $exists: true },
    });
    assert.equal(withProfileCity, 2);

    const inRoles = await users.find({ role: { $in: ['admin'] } }).count();
    assert.equal(inRoles, 1);
  } finally {
    await database.close();
  }
});

void test('update applies operators to all matches and enforces _id constraints', async () => {
  const database = new Database({});
  const users = database.collection<UserDocument>('users');

  try {
    await users.insertMany([
      {
        _id: 'u1',
        name: 'Alice',
        profile: { city: 'Tokyo' },
        status: 'active',
        temporaryFlag: true,
        visits: 1,
      },
      {
        _id: 'u2',
        name: 'Bob',
        profile: { city: 'Tokyo' },
        status: 'active',
        temporaryFlag: true,
        visits: 4,
      },
    ]);

    const updateResult = await users.update(
      { 'profile.city': 'Tokyo' },
      {
        $inc: { visits: 1 },
        $rename: { 'profile.city': 'profile.town' },
        $set: { status: 'verified' },
        $unset: { temporaryFlag: true },
      },
    );
    assert.equal(updateResult.modifiedCount, 2);
    assert.equal(updateResult.upsertedId, null);

    const docs = await users.find().toArray();
    assert.equal(docs.length, 2);
    for (const doc of docs) {
      assert.equal(doc.status, 'verified');
      assert.equal(doc.temporaryFlag, undefined);
      assert.equal(doc.profile?.city, undefined);
      assert.equal(doc.profile?.town, 'Tokyo');
    }

    await assert.rejects(
      () => users.update({ _id: 'u1' }, { $set: { _id: 'u3' } }),
      ValidationError,
    );
  } finally {
    await database.close();
  }
});

void test('remove deletes matched records and remove without filter deletes all records', async () => {
  const database = new Database({});
  const users = database.collection<UserDocument>('users');

  try {
    await users.insertMany([
      { _id: 'u1', name: 'Alice', status: 'active' },
      { _id: 'u2', name: 'Bob', status: 'inactive' },
      { _id: 'u3', name: 'Carol', status: 'active' },
    ]);

    const removedInactive = await users.remove({ status: 'inactive' });
    assert.equal(removedInactive, 1);
    assert.equal(await users.count(), 2);

    const removedAll = await users.remove({});
    assert.equal(removedAll, 2);
    assert.equal(await users.count(), 0);
  } finally {
    await database.close();
  }
});

void test('remove with _id $in filter uses batch deleteMany path', async () => {
  const database = new Database({});
  const users = database.collection<UserDocument>('users');

  try {
    await users.insertMany([
      { _id: 'u1', name: 'Alice' },
      { _id: 'u2', name: 'Bob' },
      { _id: 'u3', name: 'Carol' },
      { _id: 'u4', name: 'Dave' },
    ]);

    const removed = await users.remove({ _id: { $in: ['u1', 'u3'] } });
    assert.equal(removed, 2);
    assert.equal(await users.count(), 2);

    const remaining = await users.find().toArray();
    assert.deepEqual(remaining.map((d) => d._id).sort(), ['u2', 'u4']);
  } finally {
    await database.close();
  }
});

void test('remove with _id $in including non-existent keys deletes only existing documents', async () => {
  const database = new Database({});
  const users = database.collection<UserDocument>('users');

  try {
    await users.insertMany([
      { _id: 'u1', name: 'Alice' },
      { _id: 'u2', name: 'Bob' },
    ]);

    const removed = await users.remove({ _id: { $in: ['u1', 'u99', 'u100'] } });
    assert.equal(removed, 1);
    assert.equal(await users.count(), 1);

    const remaining = await users.find().toArray();
    assert.equal(remaining[0]._id, 'u2');
  } finally {
    await database.close();
  }
});

void test('insertMany emits insert events for the records persisted before a mid-batch failure', async () => {
  const database = new Database({});
  const users = database.collection<UserDocument>('users-partial');

  try {
    const events: string[] = [];
    users.watch((event) => events.push(event.documentId));

    // Make the datastore fail after the first record of the batch is written,
    // standing in for a quota/backend failure the duplicate pre-check cannot
    // anticipate. The persisted record must still reach watch().
    const datastore = (
      database as unknown as { datastores: Map<string, Datastore> }
    ).datastores.get('users-partial')!;
    const put = datastore.put.bind(datastore);
    datastore.putMany = async (records): Promise<void> => {
      await put(records[0]);
      throw new Error('simulated storage failure');
    };

    await assert.rejects(
      () =>
        users.insertMany([
          { _id: 'u1', name: 'Alice' },
          { _id: 'u2', name: 'Bob' },
        ]),
      { message: 'simulated storage failure' },
    );

    assert.equal(await users.count(), 1);
    assert.deepEqual(events, ['u1']);
  } finally {
    await database.close();
  }
});
