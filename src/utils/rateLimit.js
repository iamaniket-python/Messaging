import { redis } from '../config/redis.js';
import { logger } from './logger.js';

const memory = new Map();

const INCREMENT_SCRIPT = `
local current = redis.call('INCR', KEYS[1])
if current == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return current
`;

function incrementInMemory(key, windowSeconds) {
  const now = Date.now();
  let entry = memory.get(key);

  if (!entry || entry.resetAt <= now) {
    entry = { count: 0, resetAt: now + windowSeconds * 1000 };
    memory.set(key, entry);
  }
  entry.count += 1;

  if (memory.size > 10_000) {
    for (const [storedKey, value] of memory) {
      if (value.resetAt <= now) memory.delete(storedKey);
    }
  }
  return entry.count;
}

export async function consumeRateLimit(key, { limit, windowSeconds }) {
  let count;

  if (redis) {
    try {
      count = Number(await redis.eval(INCREMENT_SCRIPT, 1, `chat:rl:${key}`, windowSeconds));
    } catch (err) {
      logger.error({ err: err.message }, 'Redis rate limit failed, falling back to memory');
    }
  }

  if (count === undefined) count = incrementInMemory(key, windowSeconds);

  return { allowed: count <= limit, remaining: Math.max(0, limit - count) };
}