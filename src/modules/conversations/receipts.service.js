import { pool, query } from '../../config/db.js';
import { AppError } from '../../utils/AppError.js';
import { requireMembership } from './conversations.service.js';

const notFound = () => AppError.notFound('Conversation not found', 'CONVERSATION_NOT_FOUND');

const toResult = (row) => ({
  messageId: row.value,
  advanced: BigInt(row.value) > BigInt(row.old_value),
  conversationType: row.type,
});

export async function markDelivered(conversationId, userId, messageId) {
  const { rows } = await query(
    `WITH prev AS (
       SELECT last_delivered_message_id AS old_value
         FROM conversation_members
        WHERE conversation_id = $1 AND user_id = $2
     )
     UPDATE conversation_members cm
        SET last_delivered_message_id = GREATEST(
              cm.last_delivered_message_id,
              LEAST($3::bigint, COALESCE((SELECT max(id) FROM messages WHERE conversation_id = $1), 0))
            )
       FROM prev, conversations c
      WHERE cm.conversation_id = $1 AND cm.user_id = $2 AND c.id = cm.conversation_id
      RETURNING cm.last_delivered_message_id AS value, prev.old_value AS old_value, c.type AS type`,
    [conversationId, userId, messageId]
  );
  if (!rows[0]) throw notFound();
  return toResult(rows[0]);
}

export async function markRead(conversationId, userId, messageId) {
  const { rows } = await query(
    `WITH prev AS (
       SELECT last_read_message_id AS old_value
         FROM conversation_members
        WHERE conversation_id = $1 AND user_id = $2
     )
     UPDATE conversation_members cm
        SET last_read_message_id = GREATEST(
              cm.last_read_message_id,
              LEAST($3::bigint, COALESCE((SELECT max(id) FROM messages WHERE conversation_id = $1), 0))
            ),
            last_delivered_message_id = GREATEST(
              cm.last_delivered_message_id,
              LEAST($3::bigint, COALESCE((SELECT max(id) FROM messages WHERE conversation_id = $1), 0))
            )
       FROM prev, conversations c
      WHERE cm.conversation_id = $1 AND cm.user_id = $2 AND c.id = cm.conversation_id
      RETURNING cm.last_read_message_id AS value, prev.old_value AS old_value, c.type AS type`,
    [conversationId, userId, messageId]
  );
  if (!rows[0]) throw notFound();
  return toResult(rows[0]);
}

export async function getReceipts(conversationId, userId) {
  const membership = await requireMembership(pool, conversationId, userId);
  if (membership.type === 'channel') {
    throw AppError.badRequest('Receipts are not available for channels', undefined, 'RECEIPTS_NOT_SUPPORTED');
  }

  const { rows } = await query(
    `SELECT user_id, last_delivered_message_id, last_read_message_id
       FROM conversation_members
      WHERE conversation_id = $1
      ORDER BY joined_at ASC, user_id ASC`,
    [conversationId]
  );
  return rows;
}