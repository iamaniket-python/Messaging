import * as service from './conversations.service.js';
import { toConversation, toMember, toInboxItem, toPublicChannel } from './conversation.mapper.js';

export async function create(req, res) {
  const { conversation, created } = await service.createConversation(req.user.id, req.validated.body);
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
  const conversation = await service.updateConversation(
    req.validated.params.conversationId,
    req.user.id,
    req.validated.body
  );
  res.json({ success: true, data: { conversation: toConversation(conversation) } });
}

export async function join(req, res) {
  const result = await service.joinChannel(req.validated.params.conversationId, req.user.id);
  res.json({ success: true, data: result });
}

export async function leave(req, res) {
  await service.leaveConversation(req.validated.params.conversationId, req.user.id);
  res.status(204).end();
}

export async function markRead(req, res) {
  const lastReadMessageId = await service.markRead(
    req.validated.params.conversationId,
    req.user.id,
    req.validated.body.messageId
  );
  res.json({ success: true, data: { lastReadMessageId } });
}

export async function addMembers(req, res) {
  const result = await service.addMembers(
    req.validated.params.conversationId,
    req.user.id,
    req.validated.body.userIds
  );
  res.json({ success: true, data: result });
}

export async function removeMember(req, res) {
  const { conversationId, userId } = req.validated.params;
  await service.removeMember(conversationId, req.user.id, userId);
  res.status(204).end();
}

export async function updateMemberRole(req, res) {
  const { conversationId, userId } = req.validated.params;
  const member = await service.updateMemberRole(conversationId, req.user.id, userId, req.validated.body.role);
  res.json({ success: true, data: { member: { userId: member.user_id, role: member.role } } });
}