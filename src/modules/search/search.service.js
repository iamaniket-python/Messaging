import { pool, query } from '../../config/db.js';
import { requireMembership } from '../conversations/conversations.service.js';

const HEADLINE_OPTIONS = 'StartSel=[[, StopSel=]], MaxWords=25, MinWords=8, MaxFragments=1';

export async function searchMessages({ userId, q, conversationId, senderId, from, to, limit, cursor }) {
  // Non-member conversationId => 404 CONVERSATION_NOT_FOUND (no leak)
  if (conversationId) await requireMembership(pool, conversationId, userId);

  const params = [userId, q, HEADLINE_OPTIONS];
  const filters = [];

  const addFilter = (sql, value) => {
    params.push(value);
    filters.push(sql.replace('?', `$${params.length}`));
  };

  if (conversationId) addFilter('m.conversation_id = ?::uuid', conversationId);
  if (senderId) addFilter('m.sender_id = ?::uuid', senderId);
  if (from) addFilter('m.created_at >= ?::timestamptz', from);
  if (to) addFilter('m.created_at <= ?::timestamptz', to);
  if (cursor) addFilter('m.id < ?::bigint', cursor);

  params.push(limit + 1);
  const limitParam = `$${params.length}`;

  const { rows } = await query(
    `SELECT m.id, m.conversation_id, m.sender_id, m.client_message_id, m.type,
            m.content, m.edited_at, m.deleted_at, m.created_at,
            ts_headline('simple', m.content, tsq.q, $3) AS snippet
       FROM messages m
       JOIN conversation_members cm
         ON cm.conversation_id = m.conversation_id AND cm.user_id = $1
      CROSS JOIN (SELECT websearch_to_tsquery('simple', $2) AS q) tsq
      WHERE m.search_vector @@ tsq.q
        AND m.deleted_at IS NULL
        ${filters.length ? `AND ${filters.join(' AND ')}` : ''}
      ORDER BY m.id DESC
      LIMIT ${limitParam}`,
    params
  );

  const hasMore = rows.length > limit;
  const results = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore ? results[results.length - 1].id : null;

  return { results, hasMore, nextCursor };
}