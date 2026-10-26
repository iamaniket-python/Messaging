// Har test file se pehle chalta hai, isliye src/config/env.js ko valid env milta hai.
// ??= ka matlab: sirf tab set karo jab pehle se set na ho.
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';
process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5433/test';
process.env.CORS_ORIGINS ??= 'http://localhost:5173';
