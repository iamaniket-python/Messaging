import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { io as ioClient } from 'socket.io-client';
import app from '../src/app.js';
import { pool } from '../src/config/db.js';
import { runMigrations } from '../src/db/migrate.js';
import { initSocket } from '../src/sockets/index.js';
import { stopPresenceTasks } from '../src/sockets/presence/presence.service.js';
import {
  flushNotificationJobs,
  processNotificationJob,
} from '../src/modules/notifications/notifications.queue.js';
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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

describe.skipIf(!hasTestDb)('notifications', () => {
  let alice;
  let bob;
  let carol;
  let dave;
  let httpServer;
  let sockets;
  let port;

  beforeAll(async () => {
    await runMigrations();
    await resetDb();
    alice = await createUser('Alice');
    bob = await createUser('Bob');
    carol = await createUser('Carol');
    dave = await createUser('Dave');

    httpServer = http.createServer(app);
    sockets = initSocket(httpServer);
    await new Promise((resolve) => httpServer.listen(0, resolve));
    port = httpServer.address().port;
  });

  beforeEach(async () => {
    await resetChatData();
  });

  afterAll(async () => {
    stopPresenceTasks();
    sockets.close();
    await pool.end();
  });

  const list = (user, qs = '') => as(user).get(`/notifications${qs}`);
  const types = async (user) =>
    (await list(user)).body.data.notifications.map((n) => n.type);

  async function connect(user) {
    const socket = ioClient(`http://localhost:${port}`, {
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
      auth: { token: user.token },
    });
    await new Promise((resolve, reject) => {
      socket.once('session:ready', resolve);
      socket.once('connect_error', reject);
    });
    return socket;
  }

  it('saare notification routes bina token ke 401 dete hain', async () => {
    const calls = [
      request(app).get(api('/notifications')),
      request(app).get(api('/notifications/unread-count')),
      request(app).post(api('/notifications/read')).send({ all: true }),
      request(app).get(api('/users/me/notification-preferences')),
      request(app).patch(api('/users/me/notification-preferences')).send({ messagesMode: 'all' }),
    ];
    for (const res of await Promise.all(calls)) {
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('MISSING_TOKEN');
    }
  });

  it('message par members ko notification milti hai, sender ko nahi', async () => {
    const group = await createGroup(alice, [bob, carol]);
    await sendMessage(alice, group.id, 'hello team');
    await flushNotificationJobs();

    expect(await types(bob)).toEqual(['message']);
    expect(await types(carol)).toEqual(['message']);
    expect(await types(alice)).toEqual([]);

    const count = await as(bob).get('/notifications/unread-count');
    expect(count.body.data.unreadCount).toBe(1);
  });

  it('mention user ko sirf mention milta hai, baaki ko message', async () => {
    const group = await createGroup(alice, [bob, carol]);
    await sendMessage(alice, group.id, 'bob dekho', { mentions: [bob.id] });
    await flushNotificationJobs();

    expect(await types(bob)).toEqual(['mention']);
    expect(await types(carol)).toEqual(['message']);
  });

  it('non-member aur self mention ignore hote hain', async () => {
    const group = await createGroup(alice, [bob]);
    await sendMessage(alice, group.id, 'test mentions', { mentions: [dave.id, alice.id, bob.id] });
    await flushNotificationJobs();

    expect(await types(dave)).toEqual([]);
    expect(await types(alice)).toEqual([]);
    expect(await types(bob)).toEqual(['mention']);

    const stored = await pool.query('SELECT mentions FROM messages ORDER BY id DESC LIMIT 1');
    expect(stored.rows[0].mentions).toEqual([bob.id]);
  });

  it('muted member ko notification nahi milti', async () => {
    const group = await createGroup(alice, [bob, carol]);
    await pool.query(
      `UPDATE conversation_members SET muted_until = now() + interval '1 hour'
        WHERE conversation_id = $1 AND user_id = $2`,
      [group.id, carol.id]
    );
    await sendMessage(alice, group.id, 'mute test', { mentions: [carol.id] });
    await flushNotificationJobs();

    expect(await types(carol)).toEqual([]);
    expect(await types(bob)).toEqual(['message']);
  });

  it('preferences: mentions mode, none mode, mentions disabled', async () => {
    const group = await createGroup(alice, [bob, carol]);
    await as(bob).patch('/users/me/notification-preferences', { messagesMode: 'mentions' });
    await as(carol).patch('/users/me/notification-preferences', {
      messagesMode: 'none',
      mentionsEnabled: false,
    });

    await sendMessage(alice, group.id, 'plain message');
    await flushNotificationJobs();
    expect(await types(bob)).toEqual([]);
    expect(await types(carol)).toEqual([]);

    await sendMessage(alice, group.id, 'mentioning both', { mentions: [bob.id, carol.id] });
    await flushNotificationJobs();
    expect(await types(bob)).toEqual(['mention']);
    expect(await types(carol)).toEqual([]);
  });

  it('preferences endpoints: defaults, update, validation', async () => {
    const initial = await as(bob).get('/users/me/notification-preferences');
    expect(initial.status).toBe(200);
    expect(initial.body.data.preferences).toEqual({ messagesMode: 'all', mentionsEnabled: true });

    const updated = await as(bob).patch('/users/me/notification-preferences', {
      messagesMode: 'mentions',
    });
    expect(updated.status).toBe(200);
    expect(updated.body.data.preferences).toEqual({ messagesMode: 'mentions', mentionsEnabled: true });

    const second = await as(bob).patch('/users/me/notification-preferences', { mentionsEnabled: false });
    expect(second.body.data.preferences).toEqual({ messagesMode: 'mentions', mentionsEnabled: false });

    expect((await as(bob).patch('/users/me/notification-preferences', {})).status).toBe(400);
    expect(
      (await as(bob).patch('/users/me/notification-preferences', { messagesMode: 'weird' })).status
    ).toBe(400);
    expect((await as(bob).patch('/users/me/notification-preferences', { foo: 1 })).status).toBe(400);
  });

  it('mark read: ids, all, aur dusre user ke ids affect nahi hote', async () => {
    const group = await createGroup(alice, [bob]);
    for (let i = 0; i < 3; i += 1) await sendMessage(alice, group.id, `msg ${i}`);
    await flushNotificationJobs();

    const bobList = (await list(bob)).body.data.notifications;
    expect(bobList).toHaveLength(3);

    const one = await as(bob).post('/notifications/read', { ids: [bobList[0].id] });
    expect(one.status).toBe(200);
    expect(one.body.data.updated).toBe(1);
    expect((await as(bob).get('/notifications/unread-count')).body.data.unreadCount).toBe(2);

    const foreign = await as(alice).post('/notifications/read', { ids: [bobList[1].id] });
    expect(foreign.body.data.updated).toBe(0);
    expect((await as(bob).get('/notifications/unread-count')).body.data.unreadCount).toBe(2);

    const all = await as(bob).post('/notifications/read', { all: true });
    expect(all.body.data.updated).toBe(2);
    expect((await as(bob).get('/notifications/unread-count')).body.data.unreadCount).toBe(0);
    expect((await list(bob, '?unread=true')).body.data.notifications).toEqual([]);

    expect((await as(bob).post('/notifications/read', {})).status).toBe(400);
    expect(
      (await as(bob).post('/notifications/read', { ids: [bobList[0].id], all: true })).status
    ).toBe(400);
  });

  it('cursor pagination newest-first, no duplicates', async () => {
    const group = await createGroup(alice, [bob]);
    for (let i = 0; i < 5; i += 1) await sendMessage(alice, group.id, `page ${i}`);
    await flushNotificationJobs();

    const seen = [];
    let cursor = null;
    let pages = 0;
    do {
      const res = await list(bob, `?limit=2${cursor ? `&cursor=${cursor}` : ''}`);
      expect(res.status).toBe(200);
      seen.push(...res.body.data.notifications.map((n) => n.id));
      cursor = res.body.data.pageInfo.nextCursor;
      pages += 1;
    } while (cursor && pages < 10);

    expect(pages).toBe(3);
    expect(new Set(seen).size).toBe(5);
    const numeric = seen.map(Number);
    expect(numeric).toEqual([...numeric].sort((a, b) => b - a));
  });

  it('retry/duplicate job par sirf ek notification banta hai', async () => {
    const group = await createGroup(alice, [bob]);
    const sent = await sendMessage(alice, group.id, 'dedupe me');
    await flushNotificationJobs();

    const job = {
      type: 'message',
      userId: bob.id,
      conversationId: group.id,
      messageId: sent.body.data.message.id,
    };
    expect(await processNotificationJob(job)).toBeNull();
    expect(await processNotificationJob(job)).toBeNull();

    const rows = await pool.query('SELECT count(*)::int AS c FROM notifications WHERE user_id = $1', [bob.id]);
    expect(rows.rows[0].c).toBe(1);
  });

  it('duplicate clientMessageId send par dusri notification nahi banti', async () => {
    const group = await createGroup(alice, [bob]);
    const clientMessageId = randomUUID();
    const first = await sendMessage(alice, group.id, 'idempotent', { clientMessageId });
    const second = await sendMessage(alice, group.id, 'idempotent', { clientMessageId });
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    await flushNotificationJobs();

    expect(await types(bob)).toEqual(['message']);
  });

  it('notification:new sirf recipient ke socket ko jata hai', async () => {
    const group = await createGroup(alice, [bob]);
    const bobSocket = await connect(bob);
    const aliceSocket = await connect(alice);
    const bobEvents = [];
    const aliceEvents = [];
    bobSocket.on('notification:new', (payload) => bobEvents.push(payload));
    aliceSocket.on('notification:new', (payload) => aliceEvents.push(payload));

    try {
      await sendMessage(alice, group.id, 'realtime ping', { mentions: [bob.id] });
      await flushNotificationJobs();
      await sleep(300);

      expect(bobEvents).toHaveLength(1);
      expect(bobEvents[0].notification.type).toBe('mention');
      expect(bobEvents[0].notification.conversationId).toBe(group.id);
      expect(aliceEvents).toHaveLength(0);
    } finally {
      bobSocket.disconnect();
      aliceSocket.disconnect();
      await sleep(400);
    }
  });

  it('socket message:send mentions ke saath notification banata hai', async () => {
    const group = await createGroup(alice, [bob]);
    const aliceSocket = await connect(alice);

    try {
      const ack = await aliceSocket.timeout(15000).emitWithAck('message:send', {
        conversationId: group.id,
        clientMessageId: randomUUID(),
        content: 'socket mention',
        mentions: [bob.id],
      });
      expect(ack.ok).toBe(true);
      await flushNotificationJobs();

      expect(await types(bob)).toEqual(['mention']);
    } finally {
      aliceSocket.disconnect();
      await sleep(400);
    }
  });

  it('conversation leave karne ke baad uski notifications list/count mein nahi aati', async () => {
    const group = await createGroup(alice, [bob]);
    await sendMessage(alice, group.id, 'before leave');
    await flushNotificationJobs();
    expect((await as(bob).get('/notifications/unread-count')).body.data.unreadCount).toBe(1);

    const leave = await as(bob).post(`/conversations/${group.id}/leave`);
    expect(leave.status).toBe(204);

    expect(await types(bob)).toEqual([]);
    expect((await as(bob).get('/notifications/unread-count')).body.data.unreadCount).toBe(0);
  });
});