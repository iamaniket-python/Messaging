import rateLimit from 'express-rate-limit';
import { env } from '../config/env.js';
import { AppError } from '../utils/AppError.js';

const build = ({ windowMs, limit }) =>
  rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skip: () => env.NODE_ENV === 'test',
    handler: (_req, _res, next) =>
      next(new AppError(429, 'RATE_LIMITED', 'Too many requests, please try again later')),
  });

// Abhi in-memory hai. Phase 7 mein Redis store lagayenge, taaki multi-instance mein bhi limit shared rahe.
export const authLimiter = build({ windowMs: 15 * 60 * 1000, limit: 20 });