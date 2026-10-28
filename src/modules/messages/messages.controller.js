import * as service from './messages.service.js';
import { toMessage } from './message.mapper.js';
import { broadcastNewMessage, emitToConversation } from '../../sockets/realtime.js';
import { enqueueMessageNotifications } from '../notifications/notifications.queue.js';

export async function list(req, res) {
  const { conversationId } = req.validated.params;
  const { limit, before, after } = req.validated.query;

  const result = await service.listMessages({
    conversationId,
    userId: req.user.id,
    limit,
    before,
    after,
  });

  res.json({
    success: true,
    data: {
      messages: result.messages.map(toMessage),
      pageInfo: { hasMore: result.hasMore, nextCursor: result.nextCursor },
    },
  });
}

export async function send(req, res) {
  const { message, duplicate } = await service.sendMessage({
    conversationId: req.validated.params.conversationId,
    userId: req.user.id,
    content: req.validated.body.content,
    clientMessageId: req.validated.body.clientMessageId,
    mentions: req.validated.body.mentions,
  });

  if (!duplicate) {
    broadcastNewMessage(message);
    enqueueMessageNotifications(message);
  }

  res.status(duplicate ? 200 : 201).json({ success: true, data: { message: toMessage(message) } });
}

export async function edit(req, res) {
  const message = await service.editMessage({
    messageId: req.validated.params.messageId,
    userId: req.user.id,
    content: req.validated.body.content,
  });

  emitToConversation(message.conversation_id, 'message:updated', { message: toMessage(message) });

  res.json({ success: true, data: { message: toMessage(message) } });
}

export async function remove(req, res) {
  const { messageId } = req.validated.params;
  const { conversationId, alreadyDeleted } = await service.deleteMessage({
    messageId,
    userId: req.user.id,
  });

  if (!alreadyDeleted) {
    emitToConversation(conversationId, 'message:deleted', { conversationId, messageId });
  }

  res.status(204).end();
}