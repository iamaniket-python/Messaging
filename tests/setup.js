import 'dotenv/config';

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';
process.env.BCRYPT_ROUNDS = '4';
process.env.JWT_ACCESS_SECRET = 'test-secret-test-secret-test-secret-123456';
process.env.CORS_ORIGINS = 'http://localhost:5173';
process.env.PRESENCE_OFFLINE_GRACE_MS = '200';
process.env.TYPING_TTL_MS = '300';
process.env.PRESENCE_SOCKET_TTL_MS = '2500';
process.env.PRESENCE_HEARTBEAT_MS = '500';
process.env.PRESENCE_SWEEP_INTERVAL_MS = '500';

// Redis sirf tests/redis-cluster.test.js mein enable hota hai
process.env.REDIS_URL = '';

// Tests kabhi real S3 use nahi karte (fake storage inject hota hai)
process.env.S3_ENDPOINT = '';
process.env.S3_BUCKET = '';
process.env.S3_ACCESS_KEY_ID = '';
process.env.S3_SECRET_ACCESS_KEY = '';
process.env.S3_FORCE_PATH_STYLE = 'false';
process.env.UPLOAD_MAX_BYTES = String(5 * 1024 * 1024);
process.env.UPLOAD_URL_TTL_SECONDS = '300';

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgresql://test:test@localhost:5433/test';