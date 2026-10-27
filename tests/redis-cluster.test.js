import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from 'vitest';

vi.hoisted(() => {
  process.env.REDIS_URL = process.env.TEST_REDIS_URL ?? '';
});

import { io as createClient } from 'socket.io-client';
import request from 'supertest';
import app from '../src/app.js';
import { pool } from '../src/config/db.js';
import { closeRedis } from '../src/config/redis.js';
import { runMigrations } from '../src/db/migrate.js';
import { initSocket } from '../src/sockets/index.js';
import { presenceStore } from '../src/sockets/presence/presenceStore.js';
import { stopPresenceTasks } from '../src/sockets/presence/presence.service.js';
import { consumeRateLimit } from '../src/utils/rateLimit.js';
import { hasTestDb, resetDb, resetChatData, createUser, createGroup, sendMessage, as } from './helpers.js';

const hasRedis = Boolean(process.env.TEST_REDIS_URL);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitUntil(predicate, timeoutMs = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return true;
    await sleep(100);
  }
  return false;
}

describe.skipIf(!hasTestDb || !hasRedis)('Multi-instance with Redis (integration)', () => {
  let ann;
  let bob;
  let dan;
  let serverA;
  let serverB;
  const servers = [];
  const clients = [];

  async function startServer() {
    const httpServer = http.createServer(app);
    const io = initSocket(httpServer);
    await new Promise((resolve) => httpServer.listen(0, resolve));
    const entry = { io, url: `http://127.0.0.1:${httpServer.address().port}` };
    servers.push(entry);
    return entry;
  }

  function connect(server, token) {
    return new Promise((resolve, reject) => {
      const socket = createClient(server.url, {
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
    dan = await createUser('Dan');
    serverA = await startServer();
    serverB = await startServer();
  });

  beforeEach(async () => {
    await resetChatData();
  });

  afterEach(async () => {
    for (const socket of clients.splice(0)) socket.disconnect();
    await sleep(600);
  });

  afterAll(async () => {
    stopPresenceTasks();
    await Promise.all(servers.map((server) => new Promise((resolve) => server.io.close(resolve))));
    await closeRedis();
    await pool.end();
  });

  it('delivers socket messages across instances', async () => {
    const group = await createGroup(ann, [bob]);
    const annA = await connect(serverA, ann.token);
    const bobB = await connect(serverB, bob.token);
    const bobEvents = record(bobB, 'message:new');

    const ack = await send(annA, 'message:send', messagePayload(group.id, 'cross instance'));
    expect(ack.ok).toBe(true);

    await sleep(500);
    expect(bobEvents).toHaveLength(1);
    expect(bobEvents[0].message.content).toBe('cross instance');
  });

  it('delivers typing indicators across instances', async () => {
    const group = await createGroup(ann, [bob]);
    const annA = await connect(serverA, ann.token);
    const bobB = await connect(serverB, bob.token);
    const typing = record(bobB, 'typing:update');

    await send(annA, 'typing:start', { conversationId: group.id });
    await send(annA, 'typing:stop', { conversationId: group.id });
    await sleep(500);

    expect(typing.map((event) => event.isTyping)).toEqual([true, false]);
  });

  it('broadcasts REST-sent messages to sockets on every instance', async () => {
    const group = await createGroup(ann, [bob]);
    const annA = await connect(serverA, ann.token);
    const bobB = await connect(serverB, bob.token);
    const annEvents = record(annA, 'message:new');
    const bobEvents = record(bobB, 'message:new');

    const res = await sendMessage(ann, group.id, 'via rest');
    expect(res.status).toBe(201);

    await sleep(500);
    expect(annEvents).toHaveLength(1);
    expect(bobEvents).toHaveLength(1);
  });

  it('syncs socket rooms across instances when members are added and removed', async () => {
    const group = await createGroup(ann, [bob]);
    const danB = await connect(serverB, dan.token);
    const danMessages = record(danB, 'message:new');
    const danConversations = record(danB, 'conversation:new');

    await as(ann).post(`/conversations/${group.id}/members`, { userIds: [dan.id] });
    await sendMessage(ann, group.id, 'welcome');
    await sleep(700);
    expect(danConversations).toHaveLength(1);
    expect(danMessages).toHaveLength(1);

    await as(ann).delete(`/conversations/${group.id}/members/${dan.id}`);
    await sendMessage(ann, group.id, 'bye');
    await sleep(700);
    expect(danMessages).toHaveLength(1);
  });

  it('keeps a user online across instances until the last device disconnects', async () => {
    await createGroup(ann, [bob]);
    const annA = await connect(serverA, ann.token);
    const updates = record(annA, 'presence:update');
    await send(annA, 'presence:subscribe', { userIds: [bob.id] });

    const bobB = await connect(serverB, bob.token);
    const bobA = await connect(serverA, bob.token);
    await sleep(700);
    expect(updates.map((update) => update.status)).toEqual(['online']);

    bobB.disconnect();
    await sleep(1200);
    expect(updates).toHaveLength(1);

    bobA.disconnect();
    expect(await waitUntil(() => updates.some((update) => update.status === 'offline'))).toBe(true);
  });

  it('marks a user offline when their instance crashed without a clean disconnect', async () => {
    await createGroup(ann, [dan]);
    const annA = await connect(serverA, ann.token);
    const updates = record(annA, 'presence:update');

    await presenceStore.add(dan.id, `ghost-${randomUUID()}`);
    await presenceStore.markOnline(dan.id);

    const sub = await send(annA, 'presence:subscribe', { userIds: [dan.id] });
    expect(sub.data.statuses[dan.id].status).toBe('online');

    const offline = await waitUntil(
      () => updates.some((update) => update.userId === dan.id && update.status === 'offline'),
      12000
    );
    expect(offline).toBe(true);
  });

  it('shares rate limit counters through Redis', async () => {
    const key = `test:${randomUUID()}`;
    const results = [];
    for (let i = 0; i < 5; i += 1) {
      results.push((await consumeRateLimit(key, { limit: 3, windowSeconds: 5 })).allowed);
    }
    expect(results).toEqual([true, true, true, false, false]);
  });

  it('reports Redis in the readiness check', async () => {
    const res = await request(app).get('/ready');
    expect(res.status).toBe(200);
    expect(res.body.data.checks.redis).toBe('up');
  });
});