import { toAttachment } from '../attachments/attachments.mapper.js';

export const toMessage = (row) => ({
  id: row.id,
  conversationId: row.conversation_id,
  senderId: row.sender_id,
  clientMessageId: row.client_message_id,
  type: row.type,
  content: row.deleted_at ? null : row.content,
  deleted: Boolean(row.deleted_at),
  attachments: row.deleted_at ? [] : (row.attachments ?? []).map(toAttachment),
  editedAt: row.edited_at,
  createdAt: row.created_at,
});