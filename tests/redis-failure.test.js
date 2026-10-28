import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';

// Redis configured par unreachable. env import se PEHLE set karna zaroori hai, isliye dynamic imports.
process.env.REDIS_URL = 'redis://127.0.0.1:1';

const hasDb = Boolean(process.env.TEST_DATABASE_URL);

describe('redis down (REDIS_URL set, server unreachable)', () => {
  let app;
  let pool;
  let closeRedis;
  let helpers;
  let alice;

  beforeAll(async () => {
    ({ default: app } = await import('../src/app.js'));
    ({ pool } = await import('../src/config/db.js'));
    ({ closeRedis } = await import('../src/config/redis.js'));
    helpers = await import('./helpers.js');

    if (hasDb) {
      const { runMigrations } = await import('../src/db/migrate.js');
      await runMigrations();
      await helpers.resetDb();
      alice = await helpers.createUser('Alice');
    }
  });

  afterAll(async () => {
    await closeRedis();
    await pool.end();
  });

  it('liveness /health Redis ke bina bhi 200', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
  });

  it('readiness /ready 503 deta hai jab Redis down ho', async () => {
    const res = await request(app).get('/ready');
    expect(res.status).toBe(503);
  });

  it.skipIf(!hasDb)('core REST flow (group, send, list) Redis down hone par bhi chalta hai', async () => {
    const group = await helpers.createGroup(alice, []);
    const sent = await helpers.sendMessage(alice, group.id, 'redis down but working');
    expect(sent.status).toBe(201);

    const list = await helpers.as(alice).get(`/conversations/${group.id}/messages`);
    expect(list.status).toBe(200);
    expect(list.body.data.messages.some((m) => m.content === 'redis down but working')).toBe(true);
  });
});