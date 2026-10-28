import 'dotenv/config';
import { z } from 'zod';

const optionalString = z
  .string()
  .optional()
  .transform((value) => (value && value.trim() ? value.trim() : undefined));

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
    ),
  TRUST_PROXY: z.coerce.number().int().min(0).default(0),

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

  // File storage (S3-compatible, optional: missing config => 503 STORAGE_NOT_CONFIGURED)
  S3_ENDPOINT: optionalString,
  S3_REGION: z.string().trim().min(1).default('us-east-1'),
  S3_BUCKET: optionalString,
  S3_ACCESS_KEY_ID: optionalString,
  S3_SECRET_ACCESS_KEY: optionalString,
  S3_FORCE_PATH_STYLE: z
    .string()
    .optional()
    .transform((value) => value?.trim().toLowerCase() === 'true'),
  UPLOAD_MAX_BYTES: z.coerce.number().int().positive().default(10 * 1024 * 1024),
  UPLOAD_URL_TTL_SECONDS: z.coerce.number().int().min(30).max(3600).default(300),
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