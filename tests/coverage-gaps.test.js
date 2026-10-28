import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { io as ioClient } from 'socket.io-client';
import app from '../src/app.js';
import { pool } from '../src/config/db.js';
import { runMigrations } from '../src/db/migrate.js';
import { initSocket } from '../src/sockets/index.js';
import { stopPresenceTasks } from '../src/sockets/presence/presence.service.js';
import { consumeRateLimit } from '../src/utils/rateLimit.js';
import { ISSUER } from '../src/utils/tokens.js';
import { hasTestDb, api, as, resetDb, resetChatData, createUser, createGroup, sendMessage } from './helpers.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

describe('consumeRateLimit (memory fallback)', () => {
  it('limit ke baad block karta hai, keys independent hain', async () => {
    const key = `gap-test:${randomUUID()}`;
    const results = [];
    for (let i = 0; i < 4; i += 1) {
      results.push(await consumeRateLimit(key, { limit: 3, windowSeconds: 60 }));
    }
    expect(results.map((r) => r.allowed)).toEqual([true, true, true, false]);

    const other = await consumeRateLimit(`gap-test:${randomUUID()}`, { limit: 3, windowSeconds: 60 });
    expect(other.allowed).toBe(true);
  });
});

describe.skipIf(!hasTestDb)('coverage gaps', () => {
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

  const url = () => `http://localhost:${port}`;

  async function connect(user) {
    const socket = ioClient(url(), {
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

  const handshake = (auth) =>
    new Promise((resolve) => {
      const socket = ioClient(url(), { transports: ['websocket'], forceNew: true, reconnection: false, auth });
      socket.once('connect_error', (err) => {
        socket.close();
        resolve(err.data?.code);
      });
      socket.once('connect', () => {
        socket.close();
        resolve('CONNECTED');
      });
    });

  const messageCountByClientId = async (clientMessageId) =>
    (await pool.query('SELECT count(*)::int AS c FROM messages WHERE client_message_id = $1', [clientMessageId]))
      .rows[0].c;

  it('socket handshake: missing / invalid / expired token ke codes', async () => {
    const expired = jwt.sign(
      { sub: randomUUID(), role: 'user', sid: randomUUID() },
      process.env.JWT_ACCESS_SECRET,
      { algorithm: 'HS256', expiresIn: -10, issuer: ISSUER }
    );

    expect(await handshake({})).toBe('MISSING_TOKEN');
    expect(await handshake({ token: 'garbage-token' })).toBe('INVALID_TOKEN');
    expect(await handshake({ token: expired })).toBe('TOKEN_EXPIRED');
  });

  it('group permissions: non-member 404, plain member add-members par 403', async () => {
    const group = await createGroup(alice, [bob]);

    const add = await as(bob).post(`/conversations/${group.id}/members`, { memberIds: [carol.id] });
    expect(add.status).toBe(403);

    const read = await as(carol).get(`/conversations/${group.id}`);
    expect(read.status).toBe(404);
    expect(read.body.error.code).toBe('CONVERSATION_NOT_FOUND');

    const list = await as(carol).get(`/conversations/${group.id}/messages`);
    expect(list.status).toBe(404);
    expect(list.body.error.code).toBe('CONVERSATION_NOT_FOUND');
  });

  it('group permissions: plain member remove / role change / self-promote par 403', async () => {
    const group = await createGroup(alice, [bob, carol]);

    expect((await as(bob).delete(`/conversations/${group.id}/members/${carol.id}`)).status).toBe(403);
    expect(
      (await as(bob).patch(`/conversations/${group.id}/members/${carol.id}`, { role: 'admin' })).status
    ).toBe(403);
    expect(
      (await as(bob).patch(`/conversations/${group.id}/members/${bob.id}`, { role: 'admin' })).status
    ).toBe(403);
  });

  it('message moderation: edit sirf author, delete author ya owner/admin, outsider 404', async () => {
    const group = await createGroup(alice, [bob, carol]);
    const first = (await sendMessage(bob, group.id, 'bob ka message')).body.data.message;

    const carolDelete = await as(carol).delete(`/messages/${first.id}`);
    expect(carolDelete.status).toBe(403);
    expect(carolDelete.body.error.code).toBe('NOT_ALLOWED_TO_DELETE');

    const carolEdit = await as(carol).patch(`/messages/${first.id}`, { content: 'hijack' });
    expect(carolEdit.status).toBe(403);
    expect(carolEdit.body.error.code).toBe('NOT_MESSAGE_AUTHOR');

    const ownerEdit = await as(alice).patch(`/messages/${first.id}`, { content: 'owner edit' });
    expect(ownerEdit.status).toBe(403);
    expect(ownerEdit.body.error.code).toBe('NOT_MESSAGE_AUTHOR');

    expect((await as(alice).delete(`/messages/${first.id}`)).status).toBe(204);

    await pool.query(
      "UPDATE conversation_members SET role = 'admin' WHERE conversation_id = $1 AND user_id = $2",
      [group.id, carol.id]
    );
    const second = (await sendMessage(bob, group.id, 'doosra message')).body.data.message;
    expect((await as(carol).delete(`/messages/${second.id}`)).status).toBe(204);

    const third = (await sendMessage(bob, group.id, 'teesra message')).body.data.message;
    const outsider = await as(dave).delete(`/messages/${third.id}`);
    expect(outsider.status).toBe(404);
    expect(outsider.body.error.code).toBe('MESSAGE_NOT_FOUND');
  });

  it('duplicate REST retries: ek hi row, ek hi id, 201 phir 200', async () => {
    const group = await createGroup(alice, [bob]);
    const clientMessageId = randomUUID();

    const first = await sendMessage(alice, group.id, 'retry me', { clientMessageId });
    const second = await sendMessage(alice, group.id, 'retry me', { clientMessageId });
    const third = await sendMessage(alice, group.id, 'retry me', { clientMessageId });

    expect([first.status, second.status, third.status]).toEqual([201, 200, 200]);
    expect(second.body.data.message.id).toBe(first.body.data.message.id);
    expect(third.body.data.message.id).toBe(first.body.data.message.id);
    expect(await messageCountByClientId(clientMessageId)).toBe(1);
  });

  it('concurrent duplicate sends: race mein bhi sirf ek row', async () => {
    const group = await createGroup(alice, [bob]);
    const clientMessageId = randomUUID();

    const responses = await Promise.all(
      Array.from({ length: 5 }, () => sendMessage(alice, group.id, 'race', { clientMessageId }))
    );

    const ids = new Set(responses.map((res) => res.body.data.message.id));
    expect(ids.size).toBe(1);
    expect(responses.every((res) => [200, 201].includes(res.status))).toBe(true);
    expect(responses.filter((res) => res.status === 201)).toHaveLength(1);
    expect(await messageCountByClientId(clientMessageId)).toBe(1);
  });

  it('socket duplicate send: ack duplicate=true, receiver ko ek hi message:new', async () => {
    const group = await createGroup(alice, [bob]);
    const aliceSocket = await connect(alice);
    const bobSocket = await connect(bob);
    const received = [];
    bobSocket.on('message:new', (payload) => received.push(payload));

    try {
      const payload = { conversationId: group.id, clientMessageId: randomUUID(), content: 'socket retry' };
      const first = await aliceSocket.timeout(15000).emitWithAck('message:send', payload);
      const second = await aliceSocket.timeout(15000).emitWithAck('message:send', payload);
      await sleep(300);

      expect(first.ok).toBe(true);
      expect(first.data.duplicate).toBe(false);
      expect(second.ok).toBe(true);
      expect(second.data.duplicate).toBe(true);
      expect(second.data.message.id).toBe(first.data.message.id);
      expect(received).toHaveLength(1);
    } finally {
      aliceSocket.disconnect();
      bobSocket.disconnect();
      await sleep(400);
    }
  });

  it('socket token bucket: burst par RATE_LIMITED, kuch events pass', async () => {
    const group = await createGroup(alice, [bob]);
    const aliceSocket = await connect(alice);

    try {
      const acks = await Promise.all(
        Array.from({ length: 40 }, () =>
          aliceSocket.timeout(15000).emitWithAck('typing:start', { conversationId: group.id })
        )
      );
      const limited = acks.filter((ack) => !ack.ok && ack.error.code === 'RATE_LIMITED');
      const passed = acks.filter((ack) => ack.ok);

      expect(limited.length).toBeGreaterThanOrEqual(5);
      expect(passed.length).toBeGreaterThanOrEqual(1);
    } finally {
      aliceSocket.disconnect();
      await sleep(400);
    }
  });

  it('search endpoint 60/min ke baad 429 RATE_LIMITED', async () => {
    const heavy = await createUser('Heavy');
    const statuses = [];
    let lastLimited = null;

    for (let batch = 0; batch < 7; batch += 1) {
      const size = batch === 6 ? 1 : 10;
      const results = await Promise.all(
        Array.from({ length: size }, () => as(heavy).get('/search/messages?q=ratelimitword'))
      );
      for (const res of results) {
        statuses.push(res.status);
        if (res.status === 429) lastLimited = res;
      }
    }

    expect(statuses.filter((status) => status === 200)).toHaveLength(60);
    expect(statuses.filter((status) => status === 429)).toHaveLength(1);
    expect(lastLimited.body.error.code).toBe('RATE_LIMITED');
  }, 60000);

  it('attachment routes bina token ke 401', async () => {
    const id = randomUUID();
    const responses = await Promise.all([
      request(app).post(api('/attachments/upload-url')).send({}),
      request(app).post(api(`/attachments/${id}/complete`)).send({}),
      request(app).get(api(`/attachments/${id}`)),
    ]);
    for (const res of responses) {
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('MISSING_TOKEN');
    }
  });
});