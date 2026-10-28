import 'dotenv/config';
import pg from 'pg';

const url = process.env.PERF_DATABASE_URL ?? process.env.TEST_DATABASE_URL;
if (!url) {
  console.error('PERF_DATABASE_URL ya TEST_DATABASE_URL set karo (seed wali DB).');
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: url, max: 1 });

try {
  const user = (await pool.query("SELECT id FROM users WHERE email = 'perf1@example.com'")).rows[0];
  const conv = (await pool.query("SELECT id FROM conversations WHERE name = 'Perf Big Group'")).rows[0];
  if (!user || !conv) throw new Error('Pehle npm run perf:seed chalao');

  const maxId = (await pool.query('SELECT max(id) AS m FROM messages WHERE conversation_id = $1', [conv.id])).rows[0].m;
  const cursor = String(Number(maxId) - 1000);

  const queries = [
    {
      name: 'HISTORY (listMessages, before cursor, limit 31)',
      sql: `SELECT m.* FROM messages m
             WHERE m.conversation_id = $1::uuid AND m.id < $2::bigint
             ORDER BY m.id DESC LIMIT 31`,
      params: [conv.id, cursor],
    },
    {
      name: 'SEARCH (member-scoped, websearch_to_tsquery, limit 21)',
      sql: `SELECT m.id, ts_headline('simple', m.content, tsq.q, 'StartSel=[[, StopSel=]], MaxWords=25, MinWords=8, MaxFragments=1') AS snippet
              FROM messages m
              JOIN conversation_members cm ON cm.conversation_id = m.conversation_id AND cm.user_id = $1::uuid
             CROSS JOIN (SELECT websearch_to_tsquery('simple', $2) AS q) tsq
             WHERE m.search_vector @@ tsq.q AND m.deleted_at IS NULL
             ORDER BY m.id DESC LIMIT 21`,
      params: [user.id, 'deployment meeting'],
    },
    {
      // APPROXIMATE: asli inbox SQL conversations.service.js mein dekh kar compare karo.
      name: 'INBOX (approx: last_message_at order + unread count)',
      sql: `SELECT c.id, c.type, c.last_message_at,
                   (SELECT count(*) FROM messages m
                     WHERE m.conversation_id = c.id
                       AND m.id > cm.last_read_message_id
                       AND m.deleted_at IS NULL
                       AND m.sender_id IS DISTINCT FROM $1::uuid) AS unread
              FROM conversation_members cm
              JOIN conversations c ON c.id = cm.conversation_id
             WHERE cm.user_id = $1::uuid
             ORDER BY c.last_message_at DESC LIMIT 30`,
      params: [user.id],
    },
    {
      name: 'NOTIFICATIONS unread-count',
      sql: `SELECT count(*)::int FROM notifications n
              JOIN conversation_members cm ON cm.conversation_id = n.conversation_id AND cm.user_id = n.user_id
             WHERE n.user_id = $1::uuid AND n.read_at IS NULL`,
      params: [user.id],
    },
  ];

  for (const { name, sql, params } of queries) {
    await pool.query(sql, params); // warm-up
    const { rows } = await pool.query(`EXPLAIN (ANALYZE, BUFFERS) ${sql}`, params);
    console.log(`\n=== ${name} ===`);
    for (const row of rows) console.log(row['QUERY PLAN']);
  }
} catch (err) {
  console.error(err);
  process.exitCode = 1;
} finally {
  await pool.end();
}