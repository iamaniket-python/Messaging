import { createTokenBucket } from '../middleware/rateLimit.js';
import { registerAuthHandlers } from './auth.handlers.js';
import { registerConversationHandlers } from './conversation.handlers.js';
import { registerMessageHandlers } from './message.handlers.js';
import { userRoom, conversationRoom } from '../rooms.js';
import { logger } from '../../utils/logger.js';

export async function onConnection(socket) {
  const { id: userId } = socket.data.user;

  socket.data.bucket = createTokenBucket({ capacity: 20, refillPerSecond: 5 });

  registerAuthHandlers(socket);
  registerConversationHandlers(socket);
  registerMessageHandlers(socket);

  socket.on('disconnect', (reason) => {
    logger.debug({ socketId: socket.id, userId, reason }, 'Socket disconnected');
  });

  try {
    await socket.join([userRoom(userId), ...socket.data.conversationIds.map(conversationRoom)]);
    socket.emit('session:ready', { userId });
    logger.debug({ socketId: socket.id, userId }, 'Socket connected');
  } catch (err) {
    logger.error({ err, userId }, 'Failed to join rooms');
    socket.disconnect(true);
  }
}