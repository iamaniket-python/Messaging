import { registerEvent } from '../registerEvent.js';
import { sendMessageEventSchema } from '../validation.js';
import { broadcastNewMessage } from '../realtime.js';
import * as messagesService from '../../modules/messages/messages.service.js';
import { toMessage } from '../../modules/messages/message.mapper.js';

export function registerMessageHandlers(socket) {
  registerEvent(socket, 'message:send', {
    schema: sendMessageEventSchema,
    handler: async (sock, { conversationId, clientMessageId, content }) => {
      const { message, duplicate } = await messagesService.sendMessage({
        conversationId,
        userId: sock.data.user.id,
        content,
        clientMessageId,
      });

      if (!duplicate) {
        broadcastNewMessage(message, { exceptSocketId: sock.id });
      }

      return { message: toMessage(message), duplicate };
    },
  });
}