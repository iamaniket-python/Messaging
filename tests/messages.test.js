import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import { pool } from '../src/config/db.js';
import { runMigrations } from '../src/db/migrate.js';
import {
  hasTestDb,
  api,
  resetDb,
  resetChatData,
  createUser,
  createGroup,
  sendMessage,
  as,
} from './helpers.js';

describe.skipIf(!hasTestDb)('Messages (integration, real DB)', () => {
  let ann;
  let bob;
  let cat;
  let dan;

  beforeAll(async () => {
    await runMigrations();
    await resetDb();
    ann = await createUser('Ann');
    bob = await createUser('Bob');
    cat = await createUser('Cat');
    dan = await createUser('Dan');
  });

  beforeEach(async () => {
    await resetChatData();
  });

  afterAll(async () => {
    await pool.end();
  });

  it('lets members send messages and blocks non-members', async () => {
    const group = await createGroup(ann, [bob]);

    const sent = await sendMessage(bob, group.id, 'hello team');
    expect(sent.status).toBe(201);
    expect(sent.body.data.message.content).toBe('hello team');
    expect(sent.body.data.message.senderId).toBe(bob.id);

    const outsider = await sendMessage(dan, group.id, 'let me in');
    expect(outsider.status).toBe(404);
    expect(outsider.body.error.code).toBe('CONVERSATION_NOT_FOUND');
  });

  it('is idempotent for retried sends with the same clientMessageId', async () => {
    const group = await createGroup(ann, [bob]);
    const clientMessageId = '22222222-2222-4222-8222-222222222222';

    const first = await sendMessage(ann, group.id, 'hi', { clientMessageId });
    const retry = await sendMessage(ann, group.id, 'hi', { clientMessageId });

    expect(first.status).toBe(201);
    expect(retry.status).toBe(200);
    expect(retry.body.data.message.id).toBe(first.body.data.message.id);

    const { rows } = await pool.query('SELECT count(*)::int AS n FROM messages');
    expect(rows[0].n).toBe(1);
  });

  it('validates message payloads and rejects client-supplied sender ids', async () => {
    const group = await createGroup(ann, [bob]);

    const empty = await sendMessage(ann, group.id, '   ');
    expect(empty.status).toBe(400);
    expect(empty.body.error.code).toBe('VALIDATION_ERROR');

    const tooLong = await sendMessage(ann, group.id, 'x'.repeat(4001));
    expect(tooLong.status).toBe(400);

    const spoofed = await as(ann).post(`/conversations/${group.id}/messages`, {
      content: 'hi',
      senderId: bob.id,
    });
    expect(spoofed.status).toBe(400);
  });

  it('paginates history newest-first with a cursor', async () => {
    const group = await createGroup(ann, [bob]);
    for (let i = 1; i <= 5; i += 1) {
      await sendMessage(ann, group.id, `msg ${i}`);
    }

    const page1 = await as(bob).get(`/conversations/${group.id}/messages?limit=2`);
    expect(page1.body.data.messages.map((m) => m.content)).toEqual(['msg 5', 'msg 4']);
    expect(page1.body.data.pageInfo.hasMore).toBe(true);

    const page2 = await as(bob).get(
      `/conversations/${group.id}/messages?limit=2&before=${page1.body.data.pageInfo.nextCursor}`
    );
    expect(page2.body.data.messages.map((m) => m.content)).toEqual(['msg 3', 'msg 2']);
    expect(page2.body.data.pageInfo.hasMore).toBe(true);

    const page3 = await as(bob).get(
      `/conversations/${group.id}/messages?limit=2&before=${page2.body.data.pageInfo.nextCursor}`
    );
    expect(page3.body.data.messages.map((m) => m.content)).toEqual(['msg 1']);
    expect(page3.body.data.pageInfo.hasMore).toBe(false);
    expect(page3.body.data.pageInfo.nextCursor).toBeNull();
  });

  it('returns missed messages oldest-first with the "after" cursor', async () => {
    const group = await createGroup(ann, [bob]);
    const first = await sendMessage(ann, group.id, 'msg 1');
    await sendMessage(ann, group.id, 'msg 2');
    await sendMessage(ann, group.id, 'msg 3');

    const res = await as(bob).get(
      `/conversations/${group.id}/messages?after=${first.body.data.message.id}&limit=10`
    );
    expect(res.status).toBe(200);
    expect(res.body.data.messages.map((m) => m.content)).toEqual(['msg 2', 'msg 3']);

    const both = await as(bob).get(`/conversations/${group.id}/messages?before=5&after=1`);
    expect(both.status).toBe(400);
  });

  it('blocks history access for non-members and anonymous users', async () => {
    const group = await createGroup(ann, [bob]);
    await sendMessage(ann, group.id, 'secret');

    const outsider = await as(dan).get(`/conversations/${group.id}/messages`);
    expect(outsider.status).toBe(404);

    const anonymous = await request(app).get(api(`/conversations/${group.id}/messages`));
    expect(anonymous.status).toBe(401);
  });

  it('lets only the author edit a message', async () => {
    const group = await createGroup(ann, [bob]);
    const sent = (await sendMessage(ann, group.id, 'original')).body.data.message;

    const edited = await as(ann).patch(`/messages/${sent.id}`, { content: 'edited' });
    expect(edited.status).toBe(200);
    expect(edited.body.data.message.content).toBe('edited');
    expect(edited.body.data.message.editedAt).not.toBeNull();

    const byOther = await as(bob).patch(`/messages/${sent.id}`, { content: 'hijack' });
    expect(byOther.status).toBe(403);
    expect(byOther.body.error.code).toBe('NOT_MESSAGE_AUTHOR');

    const byOutsider = await as(dan).patch(`/messages/${sent.id}`, { content: 'hijack' });
    expect(byOutsider.status).toBe(404);
    expect(byOutsider.body.error.code).toBe('MESSAGE_NOT_FOUND');
  });

  it('soft-deletes messages with author and moderator rules', async () => {
    const group = await createGroup(ann, [bob, cat]);
    const bobMessage = (await sendMessage(bob, group.id, 'from bob')).body.data.message;
    const catMessage = (await sendMessage(cat, group.id, 'from cat')).body.data.message;

    expect((await as(cat).delete(`/messages/${bobMessage.id}`)).status).toBe(403);
    expect((await as(bob).delete(`/messages/${bobMessage.id}`)).status).toBe(204);
    expect((await as(ann).delete(`/messages/${catMessage.id}`)).status).toBe(204);

    const list = await as(bob).get(`/conversations/${group.id}/messages`);
    expect(list.body.data.messages).toHaveLength(2);
    for (const message of list.body.data.messages) {
      expect(message.deleted).toBe(true);
      expect(message.content).toBeNull();
    }

    const editDeleted = await as(bob).patch(`/messages/${bobMessage.id}`, { content: 'again' });
    expect(editDeleted.status).toBe(404);
  });

  it('tracks unread counts in the inbox and resets them on mark-read', async () => {
    const group = await createGroup(ann, [bob]);
    await sendMessage(ann, group.id, 'm1');
    await sendMessage(ann, group.id, 'm2');
    const last = (await sendMessage(ann, group.id, 'm3')).body.data.message;

    const bobInbox = await as(bob).get('/conversations');
    const bobItem = bobInbox.body.data.conversations.find((c) => c.id === group.id);
    expect(bobItem.unreadCount).toBe(3);
    expect(bobItem.lastMessage.content).toBe('m3');

    const annInbox = await as(ann).get('/conversations');
    const annItem = annInbox.body.data.conversations.find((c) => c.id === group.id);
    expect(annItem.unreadCount).toBe(0);

    const read = await as(bob).post(`/conversations/${group.id}/read`, { messageId: last.id });
    expect(read.status).toBe(200);
    expect(read.body.data.lastReadMessageId).toBe(last.id);

    const after = await as(bob).get('/conversations');
    expect(after.body.data.conversations.find((c) => c.id === group.id).unreadCount).toBe(0);
  });

  it('shows the other user for DMs in the inbox', async () => {
    const dm = (await as(ann).post('/conversations', { type: 'dm', userId: bob.id })).body.data.conversation;
    await sendMessage(ann, dm.id, 'hey bob');

    const inbox = await as(ann).get('/conversations');
    const item = inbox.body.data.conversations.find((c) => c.id === dm.id);
    expect(item.otherUser.id).toBe(bob.id);
    expect(item.otherUser.name).toBe('Bob');

    const bobInbox = await as(bob).get('/conversations');
    const bobItem = bobInbox.body.data.conversations.find((c) => c.id === dm.id);
    expect(bobItem.otherUser.id).toBe(ann.id);
    expect(bobItem.unreadCount).toBe(1);
  });
});