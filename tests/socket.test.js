import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from 'vitest';
import { io as createClient } from 'socket.io-client';
import jwt from 'jsonwebtoken';
import app from '../src/app.js';
import { pool } from '../src/config/db.js';
import { runMigrations } from '../src/db/migrate.js';
import { initSocket } from '../src/sockets/index.js';
import { ISSUER } from '../src/utils/tokens.js';
import { hasTestDb, resetDb, resetChatData, createUser, createGroup, sendMessage, as } from './helpers.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

describe.skipIf(!hasTestDb)('Socket.IO realtime (integration, real DB)', () => {
  let ann;
  let bob;
  let cat;
  let dan;
  let ioServer;
  let url;
  const clients = [];

  function connect(token, options = {}) {
    return new Promise((resolve, reject) => {
      const socket = createClient(url, {
        auth: token ? { token } : {},
        transports: ['websocket'],
        reconnection: false,
        forceNew: true,
        ...options,
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

  const messagePayload = (conversationId, content = 'hello') => ({
    conversationId,
    clientMessageId: randomUUID(),
    content,
  });

  beforeAll(async () => {
    await runMigrations();
    await resetDb();
    ann = await createUser('Ann');
    bob = await createUser('Bob');
    cat = await createUser('Cat');
    dan = await createUser('Dan');

    const httpServer = http.createServer(app);
    ioServer = initSocket(httpServer);
    await new Promise((resolve) => httpServer.listen(0, resolve));
    url = `http://127.0.0.1:${httpServer.address().port}`;
  });

  beforeEach(async () => {
    await resetChatData();
  });

  afterEach(() => {
    for (const socket of clients.splice(0)) socket.disconnect();
  });

  afterAll(async () => {
    await new Promise((resolve) => ioServer.close(resolve));
    await pool.end();
  });

  it('rejects connections without a valid token', async () => {
    await expect(connect(null)).rejects.toMatchObject({ data: { code: 'MISSING_TOKEN' } });
    await expect(connect('not.a.jwt')).rejects.toMatchObject({ data: { code: 'INVALID_TOKEN' } });

    const expired = jwt.sign({ role: 'user', sid: 'x' }, process.env.JWT_ACCESS_SECRET, {
      algorithm: 'HS256',
      issuer: ISSUER,
      subject: ann.id,
      expiresIn: -10,
    });
    await expect(connect(expired)).rejects.toMatchObject({ data: { code: 'TOKEN_EXPIRED' } });
  });

  it('accepts a token from the Authorization header', async () => {
    const socket = await connect(null, { extraHeaders: { Authorization: `Bearer ${ann.token}` } });
    expect(socket.connected).toBe(true);
  });

  it('persists a socket message, acks the sender and delivers to other members and devices', async () => {
    const group = await createGroup(ann, [bob]);
    const annA = await connect(ann.token);
    const annB = await connect(ann.token);
    const bobSocket = await connect(bob.token);

    const annAEvents = record(annA, 'message:new');
    const annBEvents = record(annB, 'message:new');
    const bobEvents = record(bobSocket, 'message:new');

    const ack = await send(annA, 'message:send', messagePayload(group.id, 'hello realtime'));
    expect(ack.ok).toBe(true);
    expect(ack.data.duplicate).toBe(false);
    expect(ack.data.message.content).toBe('hello realtime');
    expect(ack.data.message.senderId).toBe(ann.id);

    await sleep(300);
    expect(bobEvents).toHaveLength(1);
    expect(bobEvents[0].message.id).toBe(ack.data.message.id);
    expect(annBEvents).toHaveLength(1);
    expect(annAEvents).toHaveLength(0);

    const { rows } = await pool.query('SELECT count(*)::int AS n FROM messages WHERE conversation_id = $1', [
      group.id,
    ]);
    expect(rows[0].n).toBe(1);
  });

  it('treats a retried clientMessageId as a duplicate and broadcasts only once', async () => {
    const group = await createGroup(ann, [bob]);
    const annSocket = await connect(ann.token);
    const bobSocket = await connect(bob.token);
    const bobEvents = record(bobSocket, 'message:new');

    const payload = messagePayload(group.id, 'only once');
    const first = await send(annSocket, 'message:send', payload);
    const retry = await send(annSocket, 'message:send', payload);

    expect(first.ok).toBe(true);
    expect(first.data.duplicate).toBe(false);
    expect(retry.ok).toBe(true);
    expect(retry.data.duplicate).toBe(true);
    expect(retry.data.message.id).toBe(first.data.message.id);

    await sleep(300);
    expect(bobEvents).toHaveLength(1);
  });

  it('blocks non-members from sending and from receiving', async () => {
    const group = await createGroup(ann, [bob]);
    const annSocket = await connect(ann.token);
    const danSocket = await connect(dan.token);
    const danEvents = record(danSocket, 'message:new');

    const denied = await send(danSocket, 'message:send', messagePayload(group.id, 'let me in'));
    expect(denied.ok).toBe(false);
    expect(denied.error.code).toBe('CONVERSATION_NOT_FOUND');

    await send(annSocket, 'message:send', messagePayload(group.id, 'private'));
    await sleep(300);
    expect(danEvents).toHaveLength(0);
  });

  it('rejects invalid event payloads with VALIDATION_ERROR', async () => {
    const group = await createGroup(ann, [bob]);
    const annSocket = await connect(ann.token);

    const badId = await send(annSocket, 'message:send', { ...messagePayload(group.id), conversationId: 'nope' });
    expect(badId.ok).toBe(false);
    expect(badId.error.code).toBe('VALIDATION_ERROR');

    const missingKey = await send(annSocket, 'message:send', { conversationId: group.id, content: 'hi' });
    expect(missingKey.error.code).toBe('VALIDATION_ERROR');

    const spoofed = await send(annSocket, 'message:send', { ...messagePayload(group.id), senderId: bob.id });
    expect(spoofed.error.code).toBe('VALIDATION_ERROR');
  });

  it('broadcasts REST-sent messages to connected sockets', async () => {
    const group = await createGroup(ann, [bob]);
    const bobSocket = await connect(bob.token);
    const events = record(bobSocket, 'message:new');

    const res = await sendMessage(ann, group.id, 'via rest');
    expect(res.status).toBe(201);

    await sleep(300);
    expect(events).toHaveLength(1);
    expect(events[0].message.content).toBe('via rest');
  });

  it('broadcasts message edits and deletes', async () => {
    const group = await createGroup(ann, [bob]);
    const bobSocket = await connect(bob.token);
    const updated = record(bobSocket, 'message:updated');
    const deleted = record(bobSocket, 'message:deleted');

    const sent = (await sendMessage(ann, group.id, 'original')).body.data.message;
    await as(ann).patch(`/messages/${sent.id}`, { content: 'changed' });
    await as(ann).delete(`/messages/${sent.id}`);

    await sleep(300);
    expect(updated).toHaveLength(1);
    expect(updated[0].message.content).toBe('changed');
    expect(deleted).toEqual([{ conversationId: group.id, messageId: sent.id }]);
  });

  it('keeps socket rooms in sync when members are added and removed', async () => {
    const group = await createGroup(ann, [bob]);
    const danSocket = await connect(dan.token);
    const newMessages = record(danSocket, 'message:new');
    const newConversations = record(danSocket, 'conversation:new');
    const removed = record(danSocket, 'conversation:member_removed');

    await as(ann).post(`/conversations/${group.id}/members`, { userIds: [dan.id] });
    await sendMessage(ann, group.id, 'welcome dan');
    await sleep(300);

    expect(newConversations).toHaveLength(1);
    expect(newConversations[0].conversation.id).toBe(group.id);
    expect(newMessages).toHaveLength(1);

    await as(ann).delete(`/conversations/${group.id}/members/${dan.id}`);
    await sendMessage(ann, group.id, 'dan is gone');
    await sleep(300);

    expect(removed).toHaveLength(1);
    expect(removed[0]).toMatchObject({ conversationId: group.id, userId: dan.id, reason: 'removed' });
    expect(newMessages).toHaveLength(1);
  });

  it('auto-joins new conversations for already connected users', async () => {
    const bobSocket = await connect(bob.token);
    const annSocket = await connect(ann.token);
    const newConversations = record(bobSocket, 'conversation:new');
    const newMessages = record(bobSocket, 'message:new');

    const group = await createGroup(ann, [bob]);
    const ack = await send(annSocket, 'message:send', messagePayload(group.id, 'first'));
    expect(ack.ok).toBe(true);

    await sleep(300);
    expect(newConversations).toHaveLength(1);
    expect(newMessages).toHaveLength(1);
  });

  it('supports conversation:join and conversation:leave with membership checks', async () => {
    const group = await createGroup(ann, [bob]);
    const danSocket = await connect(dan.token);
    const bobSocket = await connect(bob.token);
    const bobMessages = record(bobSocket, 'message:new');

    const denied = await send(danSocket, 'conversation:join', { conversationId: group.id });
    expect(denied.ok).toBe(false);
    expect(denied.error.code).toBe('CONVERSATION_NOT_FOUND');

    const joined = await send(bobSocket, 'conversation:join', { conversationId: group.id });
    expect(joined.ok).toBe(true);

    const left = await send(bobSocket, 'conversation:leave', { conversationId: group.id });
    expect(left.ok).toBe(true);

    await sendMessage(ann, group.id, 'after unsubscribe');
    await sleep(300);
    expect(bobMessages).toHaveLength(0);
  });

  it('enforces token expiry on live sockets and supports auth:refresh', async () => {
    const group = await createGroup(ann, [bob]);
    const shortToken = jwt.sign({ role: 'user', sid: randomUUID() }, process.env.JWT_ACCESS_SECRET, {
      algorithm: 'HS256',
      issuer: ISSUER,
      subject: ann.id,
      expiresIn: 2,
    });
    const socket = await connect(shortToken);

    await sleep(2500);
    const expired = await send(socket, 'message:send', messagePayload(group.id));
    expect(expired.ok).toBe(false);
    expect(expired.error.code).toBe('TOKEN_EXPIRED');

    const mismatch = await send(socket, 'auth:refresh', { accessToken: bob.token });
    expect(mismatch.ok).toBe(false);
    expect(mismatch.error.code).toBe('TOKEN_USER_MISMATCH');

    const refreshed = await send(socket, 'auth:refresh', { accessToken: ann.token });
    expect(refreshed.ok).toBe(true);

    const sent = await send(socket, 'message:send', messagePayload(group.id, 'back online'));
    expect(sent.ok).toBe(true);
  });

  it('rate limits event bursts per socket', async () => {
    const group = await createGroup(ann, [bob]);
    const socket = await connect(ann.token);

    const results = await Promise.all(
      Array.from({ length: 40 }, (_, i) => send(socket, 'message:send', messagePayload(group.id, `burst ${i}`)))
    );

    const limited = results.filter((result) => !result.ok && result.error.code === 'RATE_LIMITED');
    expect(limited.length).toBeGreaterThan(0);
    expect(results.some((result) => result.ok)).toBe(true);
  });
});