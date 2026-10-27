import rateLimit from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import { env } from '../config/env.js';
import { redis } from '../config/redis.js';
import { AppError } from '../utils/AppError.js';

const storeFor = (name) =>
  redis
    ? new RedisStore({
        sendCommand: (...args) => redis.call(...args),
        prefix: `chat:rl:http:${name}:`,
      })
    : undefined;

const build = ({ name, windowMs, limit, keyGenerator }) => {
  const store = storeFor(name);

  return rateLimit({
    windowMs,
    limit,
    ...(keyGenerator && { keyGenerator }),
    ...(store && { store }),
    passOnStoreError: true,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skip: () => env.NODE_ENV === 'test',
    handler: (_req, _res, next) =>
      next(new AppError(429, 'RATE_LIMITED', 'Too many requests, please try again later')),
  });
};

export const authLimiter = build({ name: 'auth', windowMs: 15 * 60 * 1000, limit: 20 });

export const messageLimiter = build({
  name: 'messages',
  windowMs: 60 * 1000,
  limit: 60,
  keyGenerator: (req) => req.user.id,
});