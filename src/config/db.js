import pg from 'pg';
import { env } from './env.js';
import { logger } from '../utils/logger.js';

const { Pool } = pg;

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: env.DB_POOL_MAX,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 15_000, // Neon cold start (compute wake-up) ke liye
  statement_timeout: 10_000, // koi bhi query 10s se zyada nahi chalegi
});

// Idle client par network error aaye (Neon idle connections band kar deta hai) to process crash na ho
pool.on('error', (err) => {
  logger.error({ err }, 'Unexpected error on idle PostgreSQL client');
});

export const query = (text, params) => pool.query(text, params);

// Multi-step writes ke liye (Phase 4 mein group create, etc.)
export async function withTransaction(callback) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function checkDb() {
  await pool.query('SELECT 1');
}

export async function closeDb() {
  await pool.end();
}