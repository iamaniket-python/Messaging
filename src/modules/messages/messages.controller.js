import * as service from './messages.service.js';
import { toMessage } from './message.mapper.js';

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
  });
  res.status(duplicate ? 200 : 201).json({ success: true, data: { message: toMessage(message) } });
}

export async function edit(req, res) {
  const message = await service.editMessage({
    messageId: req.validated.params.messageId,
    userId: req.user.id,
    content: req.validated.body.content,
  });
  res.json({ success: true, data: { message: toMessage(message) } });
}

export async function remove(req, res) {
  await service.deleteMessage({ messageId: req.validated.params.messageId, userId: req.user.id });
  res.status(204).end();
}