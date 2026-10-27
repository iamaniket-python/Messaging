import http from 'node:http';
import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from 'vitest';
import { io as createClient } from 'socket.io-client';
import app from '../src/app.js';
import { pool } from '../src/config/db.js';
import { runMigrations } from '../src/db/migrate.js';
import { initSocket } from '../src/sockets/index.js';
import { hasTestDb, resetDb, resetChatData, createUser, createGroup, sendMessage, as } from './helpers.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

describe.skipIf(!hasTestDb)('Typing, presence and receipts (integration, real DB)', () => {
  let ann;
  let bob;
  let dan;
  let ioServer;
  let url;
  const clients = [];

  function connect(token) {
    return new Promise((resolve, reject) => {
      const socket = createClient(url, {
        auth: { token },
        transports: ['websocket'],
        reconnection: false,
        forceNew: true,
      });
      clients.push(socket);
      socket.once('session:ready', () => resolve(socket));
      socket.once('connect_error', reject);
    });
  }

  const send = (socket, event, payload) => socket.timeout(15000).emitWithAck(event, payload);

  function record(socket, event) {
    const events = [];
    socket.on(event, (payload) => events.push(payload));
    return events;
  }

  beforeAll(async () => {
    await runMigrations();
    await resetDb();
    ann = await createUser('Ann');
    bob = await createUser('Bob');
    dan = await createUser('Dan');

    const httpServer = http.createServer(app);
    ioServer = initSocket(httpServer);
    await new Promise((resolve) => httpServer.listen(0, resolve));
    url = `http://127.0.0.1:${httpServer.address().port}`;
  });

  beforeEach(async () => {
    await resetChatData();
  });

  afterEach(async () => {
    for (const socket of clients.splice(0)) socket.disconnect();
    await sleep(400);
  });

  afterAll(async () => {
    await new Promise((resolve) => ioServer.close(resolve));
    await pool.end();
  });

  // ---------- Typing ----------
  it('broadcasts typing start/stop to other members only and de-duplicates repeated starts', async () => {
    const group = await createGroup(ann, [bob]);
    const annSocket = await connect(ann.token);
    const bobSocket = await connect(bob.token);
    const bobTyping = record(bobSocket, 'typing:update');
    const annTyping = record(annSocket, 'typing:update');

    expect((await send(annSocket, 'typing:start', { conversationId: group.id })).ok).toBe(true);
    expect((await send(annSocket, 'typing:start', { conversationId: group.id })).ok).toBe(true);
    await sleep(150);
    expect(bobTyping).toEqual([{ conversationId: group.id, userId: ann.id, isTyping: true }]);

    await send(annSocket, 'typing:stop', { conversationId: group.id });
    await sleep(150);
    expect(bobTyping).toHaveLength(2);
    expect(bobTyping[1]).toEqual({ conversationId: group.id, userId: ann.id, isTyping: false });
    expect(annTyping).toHaveLength(0);
  });

  it('auto-expires typing when no refresh arrives', async () => {
    const group = await createGroup(ann, [bob]);
    const annSocket = await connect(ann.token);
    const bobSocket = await connect(bob.token);
    const bobTyping = record(bobSocket, 'typing:update');

    await send(annSocket, 'typing:start', { conversationId: group.id });
    await sleep(800);

    expect(bobTyping.map((event) => event.isTyping)).toEqual([true, false]);
  });

  it('clears typing when the user disconnects', async () => {
    const group = await createGroup(ann, [bob]);
    const annSocket = await connect(ann.token);
    const bobSocket = await connect(bob.token);
    const bobTyping = record(bobSocket, 'typing:update');

    await send(annSocket, 'typing:start', { conversationId: group.id });
    await sleep(100);
    annSocket.disconnect();
    await sleep(200);

    expect(bobTyping.map((event) => event.isTyping)).toEqual([true, false]);
  });

  it('denies typing for non-members and leaks nothing to them', async () => {
    const group = await createGroup(ann, [bob]);
    const annSocket = await connect(ann.token);
    const danSocket = await connect(dan.token);
    const danTyping = record(danSocket, 'typing:update');

    const denied = await send(danSocket, 'typing:start', { conversationId: group.id });
    expect(denied.ok).toBe(false);
    expect(denied.error.code).toBe('CONVERSATION_NOT_FOUND');

    await send(annSocket, 'typing:start', { conversationId: group.id });
    await sleep(150);
    expect(danTyping).toHaveLength(0);
  });

  // ---------- Presence ----------
  it('reports presence and broadcasts online/offline to subscribers', async () => {
    await createGroup(ann, [bob]);
    const annSocket = await connect(ann.token);
    const updates = record(annSocket, 'presence:update');

    const first = await send(annSocket, 'presence:subscribe', { userIds: [bob.id] });
    expect(first.ok).toBe(true);
    expect(first.data.statuses[bob.id].status).toBe('offline');

    const bobSocket = await connect(bob.token);
    await sleep(300);
    expect(updates).toEqual([{ userId: bob.id, status: 'online', lastSeenAt: null }]);

    const second = await send(annSocket, 'presence:subscribe', { userIds: [bob.id] });
    expect(second.data.statuses[bob.id].status).toBe('online');

    bobSocket.disconnect();
    await sleep(800);
    expect(updates).toHaveLength(2);
    expect(updates[1].status).toBe('offline');
    expect(updates[1].lastSeenAt).not.toBeNull();
  });

  it('keeps a user online until their last device disconnects', async () => {
    await createGroup(ann, [bob]);
    const annSocket = await connect(ann.token);
    const updates = record(annSocket, 'presence:update');
    await send(annSocket, 'presence:subscribe', { userIds: [bob.id] });

    const bobPhone = await connect(bob.token);
    const bobLaptop = await connect(bob.token);
    await sleep(300);
    expect(updates).toHaveLength(1);

    bobPhone.disconnect();
    await sleep(600);
    expect(updates).toHaveLength(1);

    bobLaptop.disconnect();
    await sleep(800);
    expect(updates).toHaveLength(2);
    expect(updates[1].status).toBe('offline');
  });

  it('only exposes presence of users who share a conversation', async () => {
    await createGroup(ann, [bob]);
    const annSocket = await connect(ann.token);
    const updates = record(annSocket, 'presence:update');

    const sub = await send(annSocket, 'presence:subscribe', { userIds: [bob.id, dan.id] });
    expect(sub.ok).toBe(true);
    expect(Object.keys(sub.data.statuses)).toEqual([bob.id]);
    expect(sub.data.ignored).toEqual([dan.id]);

    await connect(dan.token);
    await sleep(300);
    expect(updates).toHaveLength(0);
  });

  // ---------- Delivery and read receipts ----------
  it('tracks delivery watermarks monotonically and broadcasts only real advances', async () => {
    const group = await createGroup(ann, [bob]);
    const m1 = (await sendMessage(ann, group.id, 'one')).body.data.message;
    const m2 = (await sendMessage(ann, group.id, 'two')).body.data.message;

    const annSocket = await connect(ann.token);
    const bobSocket = await connect(bob.token);
    const delivered = record(annSocket, 'message:delivered');

    const ack = await send(bobSocket, 'message:delivered', { conversationId: group.id, messageId: m2.id });
    expect(ack).toMatchObject({ ok: true, data: { lastDeliveredMessageId: m2.id } });

    await sleep(300);
    expect(delivered).toEqual([{ conversationId: group.id, userId: bob.id, messageId: m2.id }]);

    await send(bobSocket, 'message:delivered', { conversationId: group.id, messageId: m2.id });
    const older = await send(bobSocket, 'message:delivered', { conversationId: group.id, messageId: m1.id });
    expect(older.data.lastDeliveredMessageId).toBe(m2.id);

    await sleep(300);
    expect(delivered).toHaveLength(1);
  });

  it('broadcasts read receipts to members and the reader’s other devices', async () => {
    const group = await createGroup(ann, [bob]);
    await sendMessage(ann, group.id, 'one');
    const m2 = (await sendMessage(ann, group.id, 'two')).body.data.message;

    const annSocket = await connect(ann.token);
    const bobPhone = await connect(bob.token);
    const bobLaptop = await connect(bob.token);
    const annRead = record(annSocket, 'message:read');
    const phoneRead = record(bobPhone, 'message:read');
    const laptopRead = record(bobLaptop, 'message:read');

    const ack = await send(bobPhone, 'message:read', { conversationId: group.id, messageId: m2.id });
    expect(ack).toMatchObject({ ok: true, data: { lastReadMessageId: m2.id } });

    await sleep(300);
    expect(annRead).toEqual([{ conversationId: group.id, userId: bob.id, messageId: m2.id }]);
    expect(laptopRead).toHaveLength(1);
    expect(phoneRead).toHaveLength(0);

    const receipts = await as(ann).get(`/conversations/${group.id}/receipts`);
    const bobReceipt = receipts.body.data.receipts.find((r) => r.userId === bob.id);
    expect(bobReceipt.lastReadMessageId).toBe(m2.id);
    expect(bobReceipt.lastDeliveredMessageId).toBe(m2.id);

    const inbox = await as(bob).get('/conversations');
    expect(inbox.body.data.conversations.find((c) => c.id === group.id).unreadCount).toBe(0);
  });

  it('broadcasts read receipts for the REST mark-read endpoint', async () => {
    const group = await createGroup(ann, [bob]);
    const m1 = (await sendMessage(ann, group.id, 'one')).body.data.message;

    const annSocket = await connect(ann.token);
    const annRead = record(annSocket, 'message:read');

    const res = await as(bob).post(`/conversations/${group.id}/read`, { messageId: m1.id });
    expect(res.status).toBe(200);

    await sleep(300);
    expect(annRead).toEqual([{ conversationId: group.id, userId: bob.id, messageId: m1.id }]);
  });

  it('keeps read receipts private in channels (only the reader’s own devices are synced)', async () => {
    const channel = (await as(ann).post('/conversations', { type: 'channel', name: 'announcements' })).body.data
      .conversation;
    await as(bob).post(`/conversations/${channel.id}/join`);
    const message = (await sendMessage(ann, channel.id, 'news')).body.data.message;

    const annSocket = await connect(ann.token);
    const bobPhone = await connect(bob.token);
    const bobLaptop = await connect(bob.token);
    const annRead = record(annSocket, 'message:read');
    const laptopRead = record(bobLaptop, 'message:read');

    const ack = await send(bobPhone, 'message:read', { conversationId: channel.id, messageId: message.id });
    expect(ack.ok).toBe(true);

    await sleep(300);
    expect(annRead).toHaveLength(0);
    expect(laptopRead).toHaveLength(1);
  });

  it('serves receipts over REST with proper access rules', async () => {
    const group = await createGroup(ann, [bob]);
    const channel = (await as(ann).post('/conversations', { type: 'channel', name: 'general' })).body.data
      .conversation;

    const ok = await as(ann).get(`/conversations/${group.id}/receipts`);
    expect(ok.status).toBe(200);
    expect(ok.body.data.receipts).toHaveLength(2);
    expect(ok.body.data.receipts[0]).toHaveProperty('lastDeliveredMessageId');
    expect(ok.body.data.receipts[0]).toHaveProperty('lastReadMessageId');

    expect((await as(dan).get(`/conversations/${group.id}/receipts`)).status).toBe(404);

    const forChannel = await as(ann).get(`/conversations/${channel.id}/receipts`);
    expect(forChannel.status).toBe(400);
    expect(forChannel.body.error.code).toBe('RECEIPTS_NOT_SUPPORTED');
  });

  it('clamps receipt ids to the conversation and rejects non-members', async () => {
    const group = await createGroup(ann, [bob]);
    const m1 = (await sendMessage(ann, group.id, 'one')).body.data.message;

    const bobSocket = await connect(bob.token);
    const danSocket = await connect(dan.token);

    const clamped = await send(bobSocket, 'message:read', { conversationId: group.id, messageId: '999999' });
    expect(clamped.ok).toBe(true);
    expect(clamped.data.lastReadMessageId).toBe(m1.id);

    const denied = await send(danSocket, 'message:read', { conversationId: group.id, messageId: m1.id });
    expect(denied.ok).toBe(false);
    expect(denied.error.code).toBe('CONVERSATION_NOT_FOUND');
  });
});