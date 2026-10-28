import pino from 'pino';
import { env } from '../config/env.js';

export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  'req.body.password',
  'req.body.refreshToken',
  'req.body.currentPassword',
  'req.body.newPassword',
  '*.password',
  '*.passwordHash',
  '*.password_hash',
  '*.currentPassword',
  '*.newPassword',
  '*.refreshToken',
  '*.accessToken',
  '*.token',
  '*.token_hash',
];

export function createLogger({ destination, level = env.LOG_LEVEL } = {}) {
  const options = {
    level,
    redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
  };

  if (!destination && env.NODE_ENV === 'development') {
    options.transport = {
      target: 'pino-pretty',
      options: { colorize: true, translateTime: 'SYS:HH:MM:ss' },
    };
  }

  return destination ? pino(options, destination) : pino(options);
}

export const logger = createLogger();