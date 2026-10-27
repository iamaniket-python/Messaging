import 'dotenv/config';

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';
process.env.BCRYPT_ROUNDS = '4';
process.env.JWT_ACCESS_SECRET = 'test-secret-test-secret-test-secret-123456';
process.env.CORS_ORIGINS = 'http://localhost:5173';
process.env.PRESENCE_OFFLINE_GRACE_MS = '200';
process.env.TYPING_TTL_MS = '300';

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgresql://test:test@localhost:5433/test';