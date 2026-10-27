import { pool, query, withTransaction } from '../../config/db.js';
import { AppError } from '../../utils/AppError.js';
import { requireMembership } from '../conversations/conversations.service.js';

const MODERATOR_ROLES = ['owner', 'admin'];

const messageNotFound = () => AppError.notFound('Message not found', 'MESSAGE_NOT_FOUND');

async function loadMessageForMember(db, messageId, userId) {
  const { rows } = await db.query(
    `SELECT m.*, cm.role AS my_role
       FROM messages m
       JOIN conversation_members cm
         ON cm.conversation_id = m.conversation_id AND cm.user_id = $2
      WHERE m.id = $1`,
    [messageId, userId]
  );
  if (!rows[0]) throw messageNotFound();
  return rows[0];
}

export async function sendMessage({ conversationId, userId, content, clientMessageId }) {
  return withTransaction(async (client) => {
    await requireMembership(client, conversationId, userId);

    const { rows } = await client.query(
      `INSERT INTO messages (conversation_id, sender_id, client_message_id, content)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (conversation_id, sender_id, client_message_id) DO NOTHING
       RETURNING *`,
      [conversationId, userId, clientMessageId ?? null, content]
    );

    if (rows[0]) {
      const message = rows[0];
      await client.query('UPDATE conversations SET last_message_at = $2 WHERE id = $1', [
        conversationId,
        message.created_at,
      ]);
      await client.query(
        `UPDATE conversation_members
            SET last_read_message_id = GREATEST(last_read_message_id, $3::bigint)
          WHERE conversation_id = $1 AND user_id = $2`,
        [conversationId, userId, message.id]
      );
      return { message, duplicate: false };
    }

    const existing = await client.query(
      `SELECT * FROM messages
        WHERE conversation_id = $1 AND sender_id = $2 AND client_message_id = $3`,
      [conversationId, userId, clientMessageId]
    );
    return { message: existing.rows[0], duplicate: true };
  });
}

export async function listMessages({ conversationId, userId, limit, before, after }) {
  await requireMembership(pool, conversationId, userId);

  const params = [conversationId];
  let cursorSql = '';
  let order = 'DESC';

  if (before) {
    params.push(before);
    cursorSql = `AND m.id < $${params.length}::bigint`;
  } else if (after) {
    params.push(after);
    cursorSql = `AND m.id > $${params.length}::bigint`;
    order = 'ASC';
  }

  params.push(limit + 1);

  const { rows } = await query(
    `SELECT m.*
       FROM messages m
      WHERE m.conversation_id = $1 ${cursorSql}
      ORDER BY m.id ${order}
      LIMIT $${params.length}`,
    params
  );

  const hasMore = rows.length > limit;
  const messages = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore ? messages[messages.length - 1].id : null;

  return { messages, hasMore, nextCursor };
}

export async function editMessage({ messageId, userId, content }) {
  const message = await loadMessageForMember(pool, messageId, userId);

  if (message.deleted_at) throw messageNotFound();
  if (message.sender_id !== userId) {
    throw AppError.forbidden('You can only edit your own messages', 'NOT_MESSAGE_AUTHOR');
  }
  if (message.type !== 'text') {
    throw AppError.badRequest('Only text messages can be edited', undefined, 'MESSAGE_NOT_EDITABLE');
  }

  const { rows } = await query(
    'UPDATE messages SET content = $2, edited_at = now() WHERE id = $1 RETURNING *',
    [messageId, content]
  );
  return rows[0];
}

export async function deleteMessage({ messageId, userId }) {
  const message = await loadMessageForMember(pool, messageId, userId);

  const isAuthor = message.sender_id === userId;
  const isModerator = MODERATOR_ROLES.includes(message.my_role);
  if (!isAuthor && !isModerator) {
    throw AppError.forbidden('You cannot delete this message', 'NOT_ALLOWED_TO_DELETE');
  }

  if (message.deleted_at) {
    return { conversationId: message.conversation_id, alreadyDeleted: true };
  }

  await query("UPDATE messages SET deleted_at = now(), content = '' WHERE id = $1", [messageId]);
  return { conversationId: message.conversation_id, alreadyDeleted: false };
}