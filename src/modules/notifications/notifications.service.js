import { pool, query } from '../../config/db.js';

const DEFAULT_PREFERENCES = { messages_mode: 'all', mentions_enabled: true };

/**
 * Message ke liye recipients decide karta hai (sender skip, muted skip, preferences apply).
 * Mention > message: mentioned user ko sirf 'mention' milta hai (duplicate nahi).
 * Mention tab milta hai jab mentions_enabled ho (messages_mode se independent).
 */
export async function planRecipients(message) {
  const { rows } = await pool.query(
    `SELECT cm.user_id,
            COALESCE(np.messages_mode, 'all')     AS messages_mode,
            COALESCE(np.mentions_enabled, true)   AS mentions_enabled
       FROM conversation_members cm
       LEFT JOIN notification_preferences np ON np.user_id = cm.user_id
      WHERE cm.conversation_id = $1
        AND cm.user_id IS DISTINCT FROM $2
        AND (cm.muted_until IS NULL OR cm.muted_until <= now())`,
    [message.conversation_id, message.sender_id]
  );

  const mentioned = new Set(message.mentions ?? []);
  const jobs = [];

  for (const row of rows) {
    let type = null;
    if (mentioned.has(row.user_id) && row.mentions_enabled) type = 'mention';
    else if (row.messages_mode === 'all') type = 'message';
    if (!type) continue;

    jobs.push({
      type,
      userId: row.user_id,
      conversationId: message.conversation_id,
      messageId: String(message.id),
    });
  }

  return jobs;
}

// Dedupe: retry par ON CONFLICT DO NOTHING => null return (dobara emit nahi hota)
export async function insertNotification({ type, userId, conversationId, messageId }) {
  const { rows } = await pool.query(
    `INSERT INTO notifications (user_id, type, conversation_id, message_id)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, message_id, type) DO NOTHING
     RETURNING *`,
    [userId, type, conversationId, messageId]
  );
  return rows[0] ?? null;
}

export async function listNotifications({ userId, limit, cursor, unreadOnly }) {
  const params = [userId];
  const filters = [];

  if (unreadOnly) filters.push('n.read_at IS NULL');
  if (cursor) {
    params.push(cursor);
    filters.push(`n.id < $${params.length}::bigint`);
  }
  params.push(limit + 1);

  const { rows } = await query(
    `SELECT n.*
       FROM notifications n
       JOIN conversation_members cm
         ON cm.conversation_id = n.conversation_id AND cm.user_id = n.user_id
      WHERE n.user_id = $1 ${filters.length ? `AND ${filters.join(' AND ')}` : ''}
      ORDER BY n.id DESC
      LIMIT $${params.length}`,
    params
  );

  const hasMore = rows.length > limit;
  const notifications = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore ? notifications[notifications.length - 1].id : null;

  return { notifications, hasMore, nextCursor };
}

export async function unreadCount(userId) {
  const { rows } = await query(
    `SELECT count(*)::int AS count
       FROM notifications n
       JOIN conversation_members cm
         ON cm.conversation_id = n.conversation_id AND cm.user_id = n.user_id
      WHERE n.user_id = $1 AND n.read_at IS NULL`,
    [userId]
  );
  return rows[0].count;
}

export async function markRead({ userId, ids, all }) {
  if (all) {
    const res = await query(
      'UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL',
      [userId]
    );
    return res.rowCount;
  }

  const res = await query(
    `UPDATE notifications SET read_at = now()
      WHERE user_id = $1 AND read_at IS NULL AND id = ANY($2::bigint[])`,
    [userId, ids]
  );
  return res.rowCount;
}

export async function getPreferences(userId) {
  const { rows } = await query('SELECT * FROM notification_preferences WHERE user_id = $1', [userId]);
  return rows[0] ?? DEFAULT_PREFERENCES;
}

export async function updatePreferences({ userId, messagesMode, mentionsEnabled }) {
  const { rows } = await query(
    `INSERT INTO notification_preferences (user_id, messages_mode, mentions_enabled)
     VALUES ($1, COALESCE($2::varchar, 'all'), COALESCE($3::boolean, true))
     ON CONFLICT (user_id) DO UPDATE SET
       messages_mode    = COALESCE($2::varchar, notification_preferences.messages_mode),
       mentions_enabled = COALESCE($3::boolean, notification_preferences.mentions_enabled),
       updated_at       = now()
     RETURNING *`,
    [userId, messagesMode ?? null, mentionsEnabled ?? null]
  );
  return rows[0];
}