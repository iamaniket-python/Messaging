import { registerEvent } from '../registerEvent.js';
import { conversationEventSchema } from '../validation.js';
import { conversationRoom } from '../rooms.js';
import { pool } from '../../config/db.js';
import { requireMembership } from '../../modules/conversations/conversations.service.js';

export function registerConversationHandlers(socket) {
  registerEvent(socket, 'conversation:join', {
    schema: conversationEventSchema,
    handler: async (sock, { conversationId }) => {
      await requireMembership(pool, conversationId, sock.data.user.id);
      await sock.join(conversationRoom(conversationId));
      return { conversationId };
    },
  });

  registerEvent(socket, 'conversation:leave', {
    schema: conversationEventSchema,
    handler: async (sock, { conversationId }) => {
      await sock.leave(conversationRoom(conversationId));
      return { conversationId };
    },
  });
}