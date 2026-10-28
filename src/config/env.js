import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(5000),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  DB_POOL_MAX: z.coerce.number().int().positive().default(10),
  CORS_ORIGINS: z
    .string()
    .default('')
    .transform((value) =>
      value
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean)
    )
    .refine((origins) => !origins.includes('*'), {
      message: 'CORS_ORIGINS must list explicit origins (wildcard "*" is not allowed with credentials)',
    }),
  TRUST_PROXY: z.coerce.number().int().min(0).default(0),

  // HTTP hardening
  REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1000).default(30000),
  SERVER_KEEP_ALIVE_MS: z.coerce.number().int().min(1000).default(65000),

  // Auth
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  ACCESS_TOKEN_TTL_MIN: z.coerce.number().int().positive().default(15),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(7),
  BCRYPT_ROUNDS: z.coerce.number().int().min(4).max(15).default(12),

  // Realtime
  PRESENCE_OFFLINE_GRACE_MS: z.coerce.number().int().min(0).default(5000),
  TYPING_TTL_MS: z.coerce.number().int().positive().default(5000),

  // Redis (optional: khali ho to in-memory fallback)
  REDIS_URL: z
    .string()
    .optional()
    .transform((value) => (value && value.trim() ? value.trim() : undefined)),
  PRESENCE_SOCKET_TTL_MS: z.coerce.number().int().positive().default(60000),
  PRESENCE_HEARTBEAT_MS: z.coerce.number().int().positive().default(20000),
  PRESENCE_SWEEP_INTERVAL_MS: z.coerce.number().int().positive().default(30000),
  SOCKET_MESSAGE_LIMIT_PER_MIN: z.coerce.number().int().positive().default(120),

  // Notifications (BullMQ worker, sirf Redis mode mein)
  NOTIFICATION_WORKER_CONCURRENCY: z.coerce.number().int().positive().default(10),
  NOTIFICATION_JOB_ATTEMPTS: z.coerce.number().int().positive().default(5),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment variables:');
  for (const issue of parsed.error.issues) {
    console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
  }
  process.exit(1);
}

export const env = Object.freeze(parsed.data);