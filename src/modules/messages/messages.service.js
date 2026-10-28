import { pool, query, withTransaction } from '../../config/db.js';
import { AppError } from '../../utils/AppError.js';
import { requireMembership } from '../conversations/conversations.service.js';

const MODERATOR_ROLES = ['owner', 'admin'];

const messageNotFound = () => AppError.notFound('Message not found', 'MESSAGE_NOT_FOUND');

const invalidAttachments = () =>
  AppError.badRequest(
    'One or more attachments are invalid, not ready, or already used',
    undefined,
    'INVALID_ATTACHMENTS'
  );

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

// Rows ko attachments array ke saath return karta hai (ek hi query, N+1 nahi)
async function withAttachments(db, rows) {
  const fileMessageIds = rows
    .filter((row) => row.type === 'file' && !row.deleted_at)
    .map((row) => row.id);

  const byMessage = new Map();
  if (fileMessageIds.length > 0) {
    const { rows: files } = await db.query(
      `SELECT * FROM attachments
        WHERE message_id = ANY($1::bigint[]) AND status = 'ready'
        ORDER BY created_at, id`,
      [fileMessageIds]
    );
    for (const file of files) {
      const list = byMessage.get(file.message_id) ?? [];
      list.push(file);
      byMessage.set(file.message_id, list);
    }
  }

  return rows.map((row) => ({ ...row, attachments: byMessage.get(row.id) ?? [] }));
}

async function linkAttachments(client, { messageId, conversationId, userId, attachmentIds }) {
  // FOR UPDATE: do messages ek hi attachment claim karein to doosra fail ho
  const { rows: claimable } = await client.query(
    `SELECT id FROM attachments
      WHERE id = ANY($1::uuid[])
        AND conversation_id = $2
        AND uploader_id = $3
        AND status = 'ready'
        AND message_id IS NULL
      ORDER BY id
      FOR UPDATE`,
    [attachmentIds, conversationId, userId]
  );
  if (claimable.length !== attachmentIds.length) throw invalidAttachments();

  await client.query('UPDATE attachments SET message_id = $1 WHERE id = ANY($2::uuid[])', [
    messageId,
    attachmentIds,
  ]);
}

export async function sendMessage({
  conversationId,
  userId,
  content = '',
  clientMessageId,
  attachmentIds = [],
}) {
  const uniqueAttachmentIds = [...new Set(attachmentIds)];

  if (!content && uniqueAttachmentIds.length === 0) {
    throw AppError.badRequest('Message cannot be empty', undefined, 'MESSAGE_EMPTY');
  }

  const type = uniqueAttachmentIds.length > 0 ? 'file' : 'text';

  return withTransaction(async (client) => {
    await requireMembership(client, conversationId, userId);

    const { rows } = await client.query(
      `INSERT INTO messages (conversation_id, sender_id, client_message_id, type, content)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (conversation_id, sender_id, client_message_id) DO NOTHING
       RETURNING *`,
      [conversationId, userId, clientMessageId ?? null, type, content]
    );

    if (rows[0]) {
      const message = rows[0];

      // Insert ke baad link: duplicate retry mein attachments dobara validate nahi hote.
      // Koi bhi throw poori transaction (insert bhi) rollback kar deta hai.
      if (uniqueAttachmentIds.length > 0) {
        await linkAttachments(client, {
          messageId: message.id,
          conversationId,
          userId,
          attachmentIds: uniqueAttachmentIds,
        });
      }

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

      const [full] = await withAttachments(client, [message]);
      return { message: full, duplicate: false };
    }

    const existing = await client.query(
      `SELECT * FROM messages
        WHERE conversation_id = $1 AND sender_id = $2 AND client_message_id = $3`,
      [conversationId, userId, clientMessageId]
    );
    const [full] = await withAttachments(client, [existing.rows[0]]);
    return { message: full, duplicate: true };
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
  const page = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore ? page[page.length - 1].id : null;
  const messages = await withAttachments(pool, page);

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
  // Sirf text messages edit hote hain, unke attachments nahi hote
  return { ...rows[0], attachments: [] };
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

  // Attachment rows/objects rehte hain (download 404 ho jata hai); purge job baad mein.
  await query("UPDATE messages SET deleted_at = now(), content = '' WHERE id = $1", [messageId]);
  return { conversationId: message.conversation_id, alreadyDeleted: false };
}