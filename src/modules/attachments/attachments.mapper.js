export const toAttachment = (row) => ({
  id: row.id,
  name: row.original_name,
  mimeType: row.mime_type,
  sizeBytes: Number(row.size_bytes),
});

export const toAttachmentDetail = (row) => ({
  ...toAttachment(row),
  status: row.status,
  conversationId: row.conversation_id,
  messageId: row.message_id,
  uploaderId: row.uploader_id,
  createdAt: row.created_at,
});