export const toNotification = (row) => ({
  id: row.id,
  type: row.type,
  conversationId: row.conversation_id,
  messageId: row.message_id,
  createdAt: row.created_at,
  readAt: row.read_at,
});

export const toPreferences = (row) => ({
  messagesMode: row.messages_mode,
  mentionsEnabled: row.mentions_enabled,
});