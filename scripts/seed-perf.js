import 'dotenv/config';
import pg from 'pg';

// SIRF Neon test branch par chalao. Dev/prod DATABASE_URL par refuse karta hai (TRUNCATE karta hai).
const url = process.env.PERF_DATABASE_URL ?? process.env.TEST_DATABASE_URL;
if (!url) {
  console.error('PERF_DATABASE_URL ya TEST_DATABASE_URL set karo (Neon test branch).');
  process.exit(1);
}
if (url === process.env.DATABASE_URL) {
  console.error('Refusing: seed URL DATABASE_URL ke barabar hai. Test branch use karo.');
  process.exit(1);
}

process.env.DATABASE_URL = url;
process.env.JWT_ACCESS_SECRET ??= 'perf-secret-perf-secret-perf-secret-123456';
process.env.LOG_LEVEL ??= 'warn';

const USERS = 50;
const BIG_MESSAGES = Number(process.env.PERF_BIG_MESSAGES ?? 200000);
const SMALL_GROUPS = 30;
const SMALL_MESSAGES = 200;

const words = "ARRAY['kal','deployment','meeting','bug','fix','release','chai','review','server','database']";
const contentSql = `(${words})[1 + (g % 10)] || ' ' || (${words})[1 + ((g / 10) % 10)] || ' number ' || g`;

const { runMigrations } = await import('../src/db/migrate.js');
await runMigrations();
const { pool: appPool } = await import('../src/config/db.js');
await appPool.end();

const pool = new pg.Pool({ connectionString: url, max: 2 });
const client = await pool.connect();

try {
  await client.query('BEGIN');
  await client.query('SET LOCAL statement_timeout = 0');
  await client.query(
    'TRUNCATE users, sessions, conversations, conversation_members, messages RESTART IDENTITY CASCADE'
  );

  await client.query(
    `INSERT INTO users (email, name, password_hash)
     SELECT 'perf' || g || '@example.com', 'Perf ' || g, 'x' FROM generate_series(1, $1::int) g`,
    [USERS]
  );
  const owner = (await client.query("SELECT id FROM users WHERE email = 'perf1@example.com'")).rows[0].id;

  const big = (
    await client.query(
      `INSERT INTO conversations (type, visibility, name, created_by)
       VALUES ('group', 'private', 'Perf Big Group', $1) RETURNING id`,
      [owner]
    )
  ).rows[0].id;
  await client.query(
    `INSERT INTO conversation_members (conversation_id, user_id, role)
     SELECT $1::uuid, id, CASE WHEN id = $2::uuid THEN 'owner' ELSE 'member' END FROM users`,
    [big, owner]
  );
  await client.query(
    `WITH u AS (SELECT id, row_number() OVER (ORDER BY email) AS rn FROM users)
     INSERT INTO messages (conversation_id, sender_id, content, created_at)
     SELECT $1::uuid, u.id, ${contentSql}, now() - (($2::int - g) * interval '1 second')
       FROM generate_series(1, $2::int) g
       JOIN u ON u.rn = (g % $3::int) + 1`,
    [big, BIG_MESSAGES, USERS]
  );

  await client.query(
    `INSERT INTO conversations (type, visibility, name, created_by)
     SELECT 'group', 'private', 'Perf Small ' || g, $2::uuid FROM generate_series(1, $1::int) g`,
    [SMALL_GROUPS, owner]
  );
  await client.query(
    `WITH u AS (SELECT id, row_number() OVER (ORDER BY email) AS rn FROM users),
          c AS (SELECT id, row_number() OVER (ORDER BY name) AS cn
                  FROM conversations WHERE name LIKE 'Perf Small %')
     INSERT INTO conversation_members (conversation_id, user_id, role)
     SELECT c.id, u.id, CASE WHEN k = 0 THEN 'owner' ELSE 'member' END
       FROM c CROSS JOIN generate_series(0, 4) k
       JOIN u ON u.rn = ((c.cn + k) % $1::int) + 1`,
    [USERS]
  );
  await client.query(
    `INSERT INTO messages (conversation_id, sender_id, content, created_at)
     SELECT cm.conversation_id, cm.user_id, ${contentSql}, now() - (($1::int - g) * interval '1 minute')
       FROM conversation_members cm
       JOIN conversations c ON c.id = cm.conversation_id
      CROSS JOIN generate_series(1, $1::int) g
      WHERE c.name LIKE 'Perf Small %' AND cm.role = 'owner'`,
    [SMALL_MESSAGES]
  );

  await client.query(
    `UPDATE conversations c
        SET last_message_at = (SELECT max(created_at) FROM messages m WHERE m.conversation_id = c.id)
      WHERE c.name LIKE 'Perf %'`
  );
  await client.query('COMMIT');
  await client.query('ANALYZE users, conversations, conversation_members, messages');

  const total = (await client.query('SELECT count(*)::int AS c FROM messages')).rows[0].c;
  console.log(`Seed done: ${USERS} users, 1 big group (${BIG_MESSAGES} msgs), ${SMALL_GROUPS} small groups, ${total} messages total.`);
  console.log('Ab chalao: npm run perf:explain');
} catch (err) {
  await client.query('ROLLBACK').catch(() => {});
  console.error(err);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}