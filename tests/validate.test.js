import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { z } from 'zod';
import { validate } from '../src/middlewares/validate.js';
import { errorHandler } from '../src/middlewares/errorHandler.js';

const app = express();
app.use(express.json());
app.post(
  '/echo/:id',
  validate({
    params: z.object({ id: z.coerce.number().int().positive() }),
    body: z.object({ name: z.string().min(2) }),
  }),
  (req, res) => res.json({ validated: req.validated })
);
app.use(errorHandler);

describe('validate middleware', () => {
  it('passes valid input and coerces types', async () => {
    const res = await request(app).post('/echo/5').send({ name: 'Aniket' });
    expect(res.status).toBe(200);
    expect(res.body.validated.params.id).toBe(5);
    expect(res.body.validated.body.name).toBe('Aniket');
  });

  it('returns 400 with details for invalid params and body', async () => {
    const res = await request(app).post('/echo/abc').send({ name: 'a' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details).toHaveLength(2);
    const parts = res.body.error.details.map((d) => d.in).sort();
    expect(parts).toEqual(['body', 'params']);
  });
});