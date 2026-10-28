import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import { openApiDocument } from '../src/docs/openapi.js';

const METHODS = ['get', 'post', 'patch', 'delete'];
const PUBLIC_PATHS = new Set(['/auth/register', '/auth/login', '/auth/refresh', '/auth/logout']);

describe('api docs', () => {
  it('/api/docs/openapi.json valid OpenAPI 3 document deta hai', async () => {
    const res = await request(app).get('/api/docs/openapi.json');
    expect(res.status).toBe(200);
    expect(res.body.openapi.startsWith('3.')).toBe(true);
    for (const path of [
      '/auth/login',
      '/conversations/{conversationId}/messages',
      '/search/messages',
      '/notifications',
      '/attachments/upload-url',
    ]) {
      expect(res.body.paths[path]).toBeDefined();
    }
  });

  it('/api/docs redirect + swagger UI html, relaxed CSP sirf docs par', async () => {
    const redirect = await request(app).get('/api/docs');
    expect(redirect.status).toBe(302);
    expect(redirect.headers.location).toBe('/api/docs/');

    const ui = await request(app).get('/api/docs/');
    expect(ui.status).toBe(200);
    expect(ui.headers['content-type']).toContain('text/html');
    expect(ui.headers['content-security-policy']).toContain("style-src 'self' 'unsafe-inline'");
  });

  it('API routes par CSP strict hi rehti hai', async () => {
    const res = await request(app).get('/health');
    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
  });

  it('docs mein har non-public operation bearerAuth declare karta hai', () => {
    const failures = [];
    for (const [path, item] of Object.entries(openApiDocument.paths)) {
      for (const method of METHODS) {
        const op = item[method];
        if (!op) continue;
        if (!op.responses || Object.keys(op.responses).length === 0) {
          failures.push(`${method.toUpperCase()} ${path}: responses missing`);
        }
        if (PUBLIC_PATHS.has(path)) continue;
        if (JSON.stringify(op.security) !== JSON.stringify([{ bearerAuth: [] }])) {
          failures.push(`${method.toUpperCase()} ${path}: bearerAuth missing`);
        }
      }
    }
    expect(failures).toEqual([]);
  });
});