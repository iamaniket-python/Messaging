import { registerEvent } from '../registerEvent.js';
import { conversationEventSchema } from '../validation.js';
import { conversationRoom } from '../rooms.js';
import { emitToConversation } from '../realtime.js';
import { AppError } from '../../utils/AppError.js';
import { env } from '../../config/env.js';

export function registerTypingHandlers(socket) {
  const userId = socket.data.user.id;
  const timers = new Map();

  const stopTyping = (conversationId) => {
    const timer = timers.get(conversationId);
    if (!timer) return;

    clearTimeout(timer);
    timers.delete(conversationId);
    emitToConversation(
      conversationId,
      'typing:update',
      { conversationId, userId, isTyping: false },
      { exceptSocketId: socket.id }
    );
  };

  registerEvent(socket, 'typing:start', {
    schema: conversationEventSchema,
    handler: async (sock, { conversationId }) => {
      if (!sock.rooms.has(conversationRoom(conversationId))) {
        throw AppError.notFound('Conversation not found', 'CONVERSATION_NOT_FOUND');
      }

      const existing = timers.get(conversationId);
      if (existing) {
        clearTimeout(existing);
      } else {
        emitToConversation(
          conversationId,
          'typing:update',
          { conversationId, userId, isTyping: true },
          { exceptSocketId: sock.id }
        );
      }

      const timer = setTimeout(() => stopTyping(conversationId), env.TYPING_TTL_MS);
      timer.unref();
      timers.set(conversationId, timer);
    },
  });

  registerEvent(socket, 'typing:stop', {
    schema: conversationEventSchema,
    handler: async (_sock, { conversationId }) => {
      stopTyping(conversationId);
    },
  });

  socket.on('disconnect', () => {
    for (const conversationId of [...timers.keys()]) stopTyping(conversationId);
  });
}