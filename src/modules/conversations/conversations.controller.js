import * as service from './conversations.service.js';
import * as receiptsService from './receipts.service.js';
import { toConversation, toMember, toInboxItem, toPublicChannel } from './conversation.mapper.js';
import {
  emitToConversation,
  emitToUser,
  joinConversationRoom,
  leaveConversationRoom,
  broadcastReceipt,
} from '../../sockets/realtime.js';

export async function create(req, res) {
  const body = req.validated.body;
  const { conversation, created } = await service.createConversation(req.user.id, body);

  if (created) {
    const memberIds =
      body.type === 'dm'
        ? [req.user.id, body.userId.toLowerCase()]
        : [...new Set([req.user.id, ...body.memberIds.map((id) => id.toLowerCase())])];

    const payload = { conversation: toConversation(conversation) };
    for (const memberId of memberIds) {
      joinConversationRoom(memberId, conversation.id);
      emitToUser(memberId, 'conversation:new', payload);
    }
  }

  res.status(created ? 201 : 200).json({ success: true, data: { conversation: toConversation(conversation) } });
}

export async function listMine(req, res) {
  const rows = await service.listMyConversations(req.user.id, req.validated.query.limit);
  res.json({ success: true, data: { conversations: rows.map(toInboxItem) } });
}

export async function listPublicChannels(req, res) {
  const rows = await service.listPublicChannels(req.user.id, req.validated.query);
  res.json({ success: true, data: { channels: rows.map(toPublicChannel) } });
}

export async function getOne(req, res) {
  const result = await service.getConversation(req.validated.params.conversationId, req.user.id);
  res.json({
    success: true,
    data: {
      conversation: {
        ...toConversation(result.conversation),
        myRole: result.myRole,
        memberCount: result.memberCount,
        members: result.members.map(toMember),
      },
    },
  });
}

export async function update(req, res) {
  const { conversationId } = req.validated.params;
  const conversation = await service.updateConversation(conversationId, req.user.id, req.validated.body);

  emitToConversation(conversationId, 'conversation:updated', { conversation: toConversation(conversation) });

  res.json({ success: true, data: { conversation: toConversation(conversation) } });
}

export async function join(req, res) {
  const { conversationId } = req.validated.params;
  const result = await service.joinChannel(conversationId, req.user.id);

  if (result.joined) {
    joinConversationRoom(req.user.id, conversationId);
    emitToConversation(conversationId, 'conversation:member_added', {
      conversationId,
      userIds: [req.user.id],
    });
  }

  res.json({ success: true, data: result });
}

export async function leave(req, res) {
  const { conversationId } = req.validated.params;
  await service.leaveConversation(conversationId, req.user.id);

  emitToConversation(conversationId, 'conversation:member_removed', {
    conversationId,
    userId: req.user.id,
    reason: 'left',
  });
  leaveConversationRoom(req.user.id, conversationId);

  res.status(204).end();
}

export async function markRead(req, res) {
  const { conversationId } = req.validated.params;
  const result = await receiptsService.markRead(conversationId, req.user.id, req.validated.body.messageId);

  if (result.advanced) {
    broadcastReceipt('message:read', {
      conversationId,
      userId: req.user.id,
      messageId: result.messageId,
      conversationType: result.conversationType,
    });
  }

  res.json({ success: true, data: { lastReadMessageId: result.messageId } });
}

export async function getReceipts(req, res) {
  const rows = await receiptsService.getReceipts(req.validated.params.conversationId, req.user.id);
  res.json({
    success: true,
    data: {
      receipts: rows.map((row) => ({
        userId: row.user_id,
        lastDeliveredMessageId: row.last_delivered_message_id,
        lastReadMessageId: row.last_read_message_id,
      })),
    },
  });
}

export async function addMembers(req, res) {
  const { conversationId } = req.validated.params;
  const result = await service.addMembers(conversationId, req.user.id, req.validated.body.userIds);

  if (result.addedUserIds.length > 0) {
    const { conversation } = await service.getConversation(conversationId, req.user.id);
    const payload = { conversation: toConversation(conversation) };

    for (const userId of result.addedUserIds) {
      joinConversationRoom(userId, conversationId);
      emitToUser(userId, 'conversation:new', payload);
    }
    emitToConversation(conversationId, 'conversation:member_added', {
      conversationId,
      userIds: result.addedUserIds,
    });
  }

  res.json({ success: true, data: result });
}

export async function removeMember(req, res) {
  const { conversationId, userId } = req.validated.params;
  const targetId = userId.toLowerCase();

  await service.removeMember(conversationId, req.user.id, targetId);

  emitToConversation(conversationId, 'conversation:member_removed', {
    conversationId,
    userId: targetId,
    reason: 'removed',
  });
  leaveConversationRoom(targetId, conversationId);

  res.status(204).end();
}

export async function updateMemberRole(req, res) {
  const { conversationId, userId } = req.validated.params;
  const member = await service.updateMemberRole(conversationId, req.user.id, userId, req.validated.body.role);

  emitToConversation(conversationId, 'conversation:member_role_changed', {
    conversationId,
    userId: member.user_id,
    role: member.role,
  });

  res.json({ success: true, data: { member: { userId: member.user_id, role: member.role } } });
}