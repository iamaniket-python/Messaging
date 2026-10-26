export const toConversation = (row) => ({
  id: row.id,
  type: row.type,
  visibility: row.visibility,
  name: row.name,
  description: row.description,
  createdBy: row.created_by,
  lastMessageAt: row.last_message_at,
  createdAt: row.created_at,
});

export const toMember = (row) => ({
  userId: row.user_id,
  name: row.name,
  avatarUrl: row.avatar_url,
  role: row.role,
  joinedAt: row.joined_at,
});

export const toPublicChannel = (row) => ({
  ...toConversation(row),
  memberCount: row.member_count,
  isMember: row.is_member,
});

export const toInboxItem = (row) => ({
  ...toConversation(row),
  myRole: row.my_role,
  mutedUntil: row.muted_until,
  unreadCount: row.unread_count,
  otherUser: row.other_user_id
    ? { id: row.other_user_id, name: row.other_user_name, avatarUrl: row.other_user_avatar_url }
    : null,
  lastMessage: row.lm_id
    ? {
        id: row.lm_id,
        senderId: row.lm_sender_id,
        content: row.lm_deleted_at ? null : row.lm_content,
        deleted: Boolean(row.lm_deleted_at),
        createdAt: row.lm_created_at,
      }
    : null,
});