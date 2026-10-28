import { registerEvent } from '../registerEvent.js';
import { sendMessageEventSchema } from '../validation.js';
import { broadcastNewMessage } from '../realtime.js';
import * as messagesService from '../../modules/messages/messages.service.js';
import { toMessage } from '../../modules/messages/message.mapper.js';
import { consumeRateLimit } from '../../utils/rateLimit.js';
import { AppError } from '../../utils/AppError.js';
import { env } from '../../config/env.js';

export function registerMessageHandlers(socket) {
  registerEvent(socket, 'message:send', {
    schema: sendMessageEventSchema,
    handler: async (sock, { conversationId, clientMessageId, content, attachmentIds }) => {
      const userId = sock.data.user.id;

      const rate = await consumeRateLimit(`socket-messages:${userId}`, {
        limit: env.SOCKET_MESSAGE_LIMIT_PER_MIN,
        windowSeconds: 60,
      });
      if (!rate.allowed) {
        throw new AppError(429, 'RATE_LIMITED', 'Message rate limit exceeded, try again in a minute');
      }

      const { message, duplicate } = await messagesService.sendMessage({
        conversationId,
        userId,
        content,
        clientMessageId,
        attachmentIds,
      });

      if (!duplicate) {
        broadcastNewMessage(message, { exceptSocketId: sock.id });
      }

      return { message: toMessage(message), duplicate };
    },
  });
}