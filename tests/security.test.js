import { Writable } from 'node:stream';
import { randomUUID } from 'node:crypto';
import { describe, it, expect, afterAll } from 'vitest';
import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import app from '../src/app.js';
import { pool } from '../src/config/db.js';
import { createLogger } from '../src/utils/logger.js';
import { requestTimeout } from '../src/middlewares/requestTimeout.js';
import { ISSUER } from '../src/utils/tokens.js';
import { api } from './helpers.js';

const UUID = '00000000-0000-4000-8000-000000000001';

// Har protected route yahan listed hai. Naya route add ho to isi list mein daalo.
const PROTECTED_ROUTES = [
  ['get', '/users/me'],
  ['patch', '/users/me'],
  ['post', '/users/me/change-password'],
  ['get', `/users/${UUID}`],
  ['patch', `/users/${UUID}/role`],
  ['get', '/users/me/notification-preferences'],
  ['patch', '/users/me/notification-preferences'],
  ['post', '/auth/logout-all'],
  ['post', '/conversations'],
  ['get', '/conversations'],
  ['get', '/conversations/public-channels'],
  ['get', `/conversations/${UUID}`],
  ['patch', `/conversations/${UUID}`],
  ['post', `/conversations/${UUID}/join`],
  ['post', `/conversations/${UUID}/leave`],
  ['post', `/conversations/${UUID}/read`],
  ['get', `/conversations/${UUID}/receipts`],
  ['post', `/conversations/${UUID}/members`],
  ['delete', `/conversations/${UUID}/members/${UUID}`],
  ['patch', `/conversations/${UUID}/members/${UUID}`],
  ['get', `/conversations/${UUID}/messages`],
  ['post', `/conversations/${UUID}/messages`],
  ['patch', '/messages/1'],
  ['delete', '/messages/1'],
  ['get', '/search/messages?q=hello'],
  ['get', '/notifications'],
  ['get', '/notifications/unread-count'],
  ['post', '/notifications/read'],
];

const b64url = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
const claims = () => ({ sub: randomUUID(), role: 'user', sid: randomUUID() });
const me = (token) => request(app).get(api('/users/me')).set('Authorization', `Bearer ${token}`);

describe('security hardening', () => {
  afterAll(async () => {
    await pool.end();
  });

  it('har protected route bina token ke 401 deta hai', async () => {
    const failures = [];
    for (const [method, path] of PROTECTED_ROUTES) {
      const req = request(app)[method](api(path));
      const res = method === 'get' ? await req : await req.send({});
      if (res.status !== 401) failures.push(`${method.toUpperCase()} ${path} -> ${res.status}`);
    }
    expect(failures).toEqual([]);
  });

  it('garbage / tampered token INVALID_TOKEN', async () => {
    const real = jwt.sign(claims(), process.env.JWT_ACCESS_SECRET, {
      algorithm: 'HS256',
      expiresIn: 60,
      issuer: ISSUER,
    });
    const [header, payload] = real.split('.');

    const garbage = await me('not-a-jwt');
    expect(garbage.status).toBe(401);
    expect(garbage.body.error.code).toBe('INVALID_TOKEN');

    const tampered = await me(`${header}.${payload}.${'A'.repeat(43)}`);
    expect(tampered.status).toBe(401);
    expect(tampered.body.error.code).toBe('INVALID_TOKEN');
  });

  it('galat secret se signed token reject hota hai', async () => {
    const token = jwt.sign(claims(), 'another-secret-another-secret-another-123', {
      algorithm: 'HS256',
      expiresIn: 60,
      issuer: ISSUER,
    });
    const res = await me(token);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_TOKEN');
  });

  it('alg=none token reject hota hai', async () => {
    const token = `${b64url({ alg: 'none', typ: 'JWT' })}.${b64url({
      ...claims(),
      iss: ISSUER,
      exp: Math.floor(Date.now() / 1000) + 600,
    })}.`;
    const res = await me(token);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_TOKEN');
  });

  it('expired token TOKEN_EXPIRED deta hai', async () => {
    const token = jwt.sign(claims(), process.env.JWT_ACCESS_SECRET, {
      algorithm: 'HS256',
      expiresIn: -10,
      issuer: ISSUER,
    });
    const res = await me(token);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('TOKEN_EXPIRED');
  });

  it('Bearer ke bajaye Basic scheme 401 deta hai', async () => {
    const res = await request(app).get(api('/users/me')).set('Authorization', 'Basic abc123');
    expect(res.status).toBe(401);
  });

  it('security headers set hain, x-powered-by nahi', async () => {
    const res = await request(app).get('/health');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
    expect(res.headers['referrer-policy']).toBe('no-referrer');
  });

  it('CORS: disallowed origin 403 CORS_ORIGIN_DENIED', async () => {
    const res = await request(app).get('/health').set('Origin', 'http://evil.example');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CORS_ORIGIN_DENIED');
  });

  it('CORS: allowed origin ko credentials ke saath headers milte hain', async () => {
    const res = await request(app).get('/health').set('Origin', 'http://localhost:5173');
    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(res.headers['access-control-allow-credentials']).toBe('true');
  });

  it('CORS preflight: 204, methods aur max-age', async () => {
    const res = await request(app)
      .options(api('/auth/login'))
      .set('Origin', 'http://localhost:5173')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'content-type,authorization');
    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-methods']).toContain('PATCH');
    expect(res.headers['access-control-max-age']).toBe('600');
  });

  it('100kb se bada body 413 PAYLOAD_TOO_LARGE', async () => {
    const res = await request(app)
      .post(api('/auth/login'))
      .send({ email: 'a'.repeat(200_000), password: 'x' });
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('NUL byte wala input 400 INVALID_INPUT (500 nahi)', async () => {
    const res = await request(app)
      .post(api('/auth/login'))
      .send({ email: 'a\u0000b@example.com', password: 'x' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_INPUT');
  });

  it('request timeout: slow handler 503 REQUEST_TIMEOUT, fast handler 200', async () => {
    const mini = express();
    mini.get('/slow', requestTimeout(50), (_req, res) => {
      setTimeout(() => {
        if (!res.headersSent) res.json({ ok: true });
      }, 300);
    });
    mini.get('/fast', requestTimeout(50), (_req, res) => res.json({ ok: true }));

    const slow = await request(mini).get('/slow');
    expect(slow.status).toBe(503);
    expect(slow.body.error.code).toBe('REQUEST_TIMEOUT');

    const fast = await request(mini).get('/fast');
    expect(fast.status).toBe(200);
  });

  it('logger secrets redact karta hai', () => {
    const lines = [];
    const destination = new Writable({
      write(chunk, _encoding, callback) {
        lines.push(chunk.toString());
        callback();
      },
    });
    const log = createLogger({ destination, level: 'info' });

    log.info(
      {
        req: {
          headers: { authorization: 'Bearer SECRET1', cookie: 'sid=SECRET2' },
          body: { password: 'SECRET3' },
        },
        user: { password: 'SECRET4', refreshToken: 'SECRET5' },
      },
      'redaction check'
    );

    const output = lines.join('');
    for (const secret of ['SECRET1', 'SECRET2', 'SECRET3', 'SECRET4', 'SECRET5']) {
      expect(output).not.toContain(secret);
    }
    expect(output).toContain('[REDACTED]');
  });
});