import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import { pool } from '../src/config/db.js';
import { runMigrations } from '../src/db/migrate.js';
import {
  hasTestDb,
  api,
  as,
  resetDb,
  resetChatData,
  createUser,
  createGroup,
  sendMessage,
} from './helpers.js';

describe.skipIf(!hasTestDb)('message search', () => {
  let alice;
  let bob;
  let carol;

  beforeAll(async () => {
    await runMigrations();
    await resetDb();
    alice = await createUser('Alice');
    bob = await createUser('Bob');
    carol = await createUser('Carol');
  });

  beforeEach(async () => {
    await resetChatData();
  });

  afterAll(async () => {
    await pool.end();
  });

  const search = (user, qs) => as(user).get(`/search/messages?${qs}`);

  it('401 deta hai bina token ke', async () => {
    const res = await request(app).get(api('/search/messages?q=hello'));
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('MISSING_TOKEN');
  });

  it('validation: q missing, unknown param, from > to', async () => {
    const missing = await search(alice, 'limit=5');
    expect(missing.status).toBe(400);
    expect(missing.body.error.code).toBe('VALIDATION_ERROR');

    const unknown = await search(alice, 'q=hello&foo=bar');
    expect(unknown.status).toBe(400);

    const range = await search(alice, 'q=hello&from=2030-01-02T00:00:00Z&to=2030-01-01T00:00:00Z');
    expect(range.status).toBe(400);
  });

  it('member ko apna message mil jata hai, snippet ke saath', async () => {
    const group = await createGroup(alice, [bob]);
    await sendMessage(alice, group.id, 'kal deployment karenge zebraword');

    const res = await search(bob, 'q=zebraword');
    expect(res.status).toBe(200);
    expect(res.body.data.results).toHaveLength(1);
    const hit = res.body.data.results[0];
    expect(hit.conversationId).toBe(group.id);
    expect(hit.content).toContain('zebraword');
    expect(hit.snippet).toContain('[[zebraword]]');
    expect(res.body.data.pageInfo).toEqual({ hasMore: false, nextCursor: null });
  });

  it('user kabhi dusre ke private messages nahi dekh sakta', async () => {
    const group = await createGroup(alice, [bob]);
    const dm = await as(alice).post('/conversations', { type: 'dm', userId: bob.id });
    await sendMessage(alice, group.id, 'secretword group message');
    if (dm.status === 201 || dm.status === 200) {
      await sendMessage(alice, dm.body.data.conversation.id, 'secretword dm message');
    }

    const outsider = await search(carol, 'q=secretword');
    expect(outsider.status).toBe(200);
    expect(outsider.body.data.results).toEqual([]);

    const member = await search(bob, 'q=secretword');
    expect(member.body.data.results.length).toBeGreaterThanOrEqual(1);
  });

  it('non-member conversationId filter par 404 CONVERSATION_NOT_FOUND', async () => {
    const group = await createGroup(alice, [bob]);
    await sendMessage(alice, group.id, 'hiddenword');

    const res = await search(carol, `q=hiddenword&conversationId=${group.id}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('CONVERSATION_NOT_FOUND');
  });

  it('soft-deleted message search mein nahi aata', async () => {
    const group = await createGroup(alice, [bob]);
    const sent = await sendMessage(alice, group.id, 'deleteme uniqueword');
    expect((await search(bob, 'q=uniqueword')).body.data.results).toHaveLength(1);

    const del = await as(alice).delete(`/messages/${sent.body.data.message.id}`);
    expect(del.status).toBe(204);

    const after = await search(bob, 'q=uniqueword');
    expect(after.body.data.results).toEqual([]);
  });

  it('edit ke baad naya content searchable, purana nahi', async () => {
    const group = await createGroup(alice, [bob]);
    const sent = await sendMessage(alice, group.id, 'oldtoken here');
    const edit = await as(alice).patch(`/messages/${sent.body.data.message.id}`, {
      content: 'newtoken here',
    });
    expect(edit.status).toBe(200);

    expect((await search(bob, 'q=oldtoken')).body.data.results).toEqual([]);
    expect((await search(bob, 'q=newtoken')).body.data.results).toHaveLength(1);
  });

  it('senderId filter sirf us sender ke messages deta hai', async () => {
    const group = await createGroup(alice, [bob]);
    await sendMessage(alice, group.id, 'filterword from alice');
    await sendMessage(bob, group.id, 'filterword from bob');

    const res = await search(alice, `q=filterword&senderId=${bob.id}`);
    expect(res.status).toBe(200);
    expect(res.body.data.results).toHaveLength(1);
    expect(res.body.data.results[0].senderId).toBe(bob.id);
  });

  it('cursor pagination newest-first, no duplicates', async () => {
    const group = await createGroup(alice, [bob]);
    for (let i = 1; i <= 5; i += 1) {
      await sendMessage(alice, group.id, `pageword number ${i}`);
    }

    const seen = [];
    let cursor = null;
    let pages = 0;
    do {
      const qs = `q=pageword&limit=2${cursor ? `&cursor=${cursor}` : ''}`;
      const res = await search(bob, qs);
      expect(res.status).toBe(200);
      seen.push(...res.body.data.results.map((r) => r.id));
      cursor = res.body.data.pageInfo.nextCursor;
      pages += 1;
    } while (cursor && pages < 10);

    expect(pages).toBe(3);
    expect(seen).toHaveLength(5);
    expect(new Set(seen).size).toBe(5);
    const numeric = seen.map(Number);
    expect(numeric).toEqual([...numeric].sort((a, b) => b - a));
  });

  it('websearch syntax: exclusion (-word) kaam karta hai', async () => {
    const group = await createGroup(alice, [bob]);
    await sendMessage(alice, group.id, 'kal milte hain office mein');
    await sendMessage(alice, group.id, 'kal cancel ho gaya meeting');

    const res = await search(bob, `q=${encodeURIComponent('kal -cancel')}`);
    expect(res.status).toBe(200);
    expect(res.body.data.results).toHaveLength(1);
    expect(res.body.data.results[0].content).toContain('milte');
  });

  it('date filters: future from / past to dono empty dete hain', async () => {
    const group = await createGroup(alice, [bob]);
    await sendMessage(alice, group.id, 'dateword message');

    const future = await search(bob, 'q=dateword&from=2999-01-01T00:00:00Z');
    expect(future.body.data.results).toEqual([]);

    const past = await search(bob, 'q=dateword&to=2000-01-01T00:00:00Z');
    expect(past.body.data.results).toEqual([]);

    const ok = await search(bob, 'q=dateword&from=2000-01-01T00:00:00Z&to=2999-01-01T00:00:00Z');
    expect(ok.body.data.results).toHaveLength(1);
  });

  it('group leave karne ke baad purane messages search mein nahi dikhte', async () => {
    const group = await createGroup(alice, [bob]);
    await sendMessage(alice, group.id, 'leaveword message');
    expect((await search(bob, 'q=leaveword')).body.data.results).toHaveLength(1);

    const leave = await as(bob).post(`/conversations/${group.id}/leave`);
    expect(leave.status).toBe(204);

    expect((await search(bob, 'q=leaveword')).body.data.results).toEqual([]);
  });
});