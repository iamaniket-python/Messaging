import rateLimit from 'express-rate-limit';
import { env } from '../config/env.js';
import { AppError } from '../utils/AppError.js';

const build = ({ windowMs, limit, keyGenerator }) =>
  rateLimit({
    windowMs,
    limit,
    ...(keyGenerator && { keyGenerator }),
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skip: () => env.NODE_ENV === 'test',
    handler: (_req, _res, next) =>
      next(new AppError(429, 'RATE_LIMITED', 'Too many requests, please try again later')),
  });

export const authLimiter = build({ windowMs: 15 * 60 * 1000, limit: 20 });

export const messageLimiter = build({
  windowMs: 60 * 1000,
  limit: 60,
  keyGenerator: (req) => req.user.id,
});