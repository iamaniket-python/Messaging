import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

vi.mock('../src/config/db.js', () => ({
  checkDb: vi.fn(),
  closeDb: vi.fn(),
  pool: {},
}));

import { checkDb } from '../src/config/db.js';
import app from '../src/app.js';

describe('Health and base behaviour', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('GET /health returns 200 and a request id header', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('ok');
    expect(res.headers['x-request-id']).toBeTruthy();
  });

  it('GET /ready returns 200 when database is up', async () => {
    checkDb.mockResolvedValue();
    const res = await request(app).get('/ready');
    expect(res.status).toBe(200);
    expect(res.body.data.checks.database).toBe('up');
  });

  it('GET /ready returns 503 when database is down', async () => {
    checkDb.mockRejectedValue(new Error('connection refused'));
    const res = await request(app).get('/ready');
    expect(res.status).toBe(503);
    expect(res.body.data.checks.database).toBe('down');
  });

  it('unknown route returns standard 404 error', async () => {
    const res = await request(app).get('/api/v1/nope');
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('ROUTE_NOT_FOUND');
  });

  it('malformed JSON returns 400 INVALID_JSON', async () => {
    const res = await request(app)
      .post('/api/v1')
      .set('Content-Type', 'application/json')
      .send('{bad json');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_JSON');
  });

  it('sets security headers via helmet', async () => {
    const res = await request(app).get('/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});