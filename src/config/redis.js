import Redis from 'ioredis';
import { env } from './env.js';
import { logger } from '../utils/logger.js';

const connections = new Set();

function connect(url) {
  const client = new Redis(url, {
    maxRetriesPerRequest: 2,
    connectTimeout: 10_000,
    retryStrategy: (attempt) => Math.min(attempt * 200, 3_000),
  });

  client.on('error', (err) => logger.error({ err: err.message }, 'Redis error'));
  client.on('reconnecting', () => logger.warn('Redis reconnecting'));
  client.on('ready', () => logger.info('Redis ready'));

  connections.add(client);
  return client;
}

export const redis = env.REDIS_URL ? connect(env.REDIS_URL) : null;
export const isRedisEnabled = redis !== null;

// Alag connection chahiye (jaise Socket.IO adapter ka pub/sub)
export function createRedisConnection() {
  if (!env.REDIS_URL) throw new Error('REDIS_URL is not configured');
  return connect(env.REDIS_URL);
}

export async function checkRedis() {
  if (!redis) return;
  const reply = await redis.ping();
  if (reply !== 'PONG') throw new Error('Unexpected Redis reply');
}

export async function closeRedis() {
  await Promise.all(
    [...connections].map(async (client) => {
      try {
        await client.quit();
      } catch {
        client.disconnect();
      }
    })
  );
  connections.clear();
}