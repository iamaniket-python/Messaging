import { createTokenBucket } from '../middleware/rateLimit.js';
import { registerAuthHandlers } from './auth.handlers.js';
import { registerConversationHandlers } from './conversation.handlers.js';
import { registerMessageHandlers } from './message.handlers.js';
import { registerTypingHandlers } from './typing.handlers.js';
import { registerPresenceHandlers } from './presence.handlers.js';
import { registerReceiptHandlers } from './receipt.handlers.js';
import { userRoom, conversationRoom } from '../rooms.js';
import * as presenceService from '../presence/presence.service.js';
import { logger } from '../../utils/logger.js';

export async function onConnection(socket) {
  const { id: userId } = socket.data.user;

  socket.data.bucket = createTokenBucket({ capacity: 20, refillPerSecond: 5 });

  registerAuthHandlers(socket);
  registerConversationHandlers(socket);
  registerMessageHandlers(socket);
  registerTypingHandlers(socket);
  registerPresenceHandlers(socket);
  registerReceiptHandlers(socket);

  socket.on('disconnect', (reason) => {
    logger.debug({ socketId: socket.id, userId, reason }, 'Socket disconnected');
    presenceService
      .userDisconnected(userId, socket.id)
      .catch((err) => logger.error({ err, userId }, 'Presence disconnect failed'));
  });

  try {
    await socket.join([userRoom(userId), ...socket.data.conversationIds.map(conversationRoom)]);

    if (socket.disconnected) return;

    await presenceService.userConnected(userId, socket.id);
    socket.emit('session:ready', { userId });
    logger.debug({ socketId: socket.id, userId }, 'Socket connected');
  } catch (err) {
    logger.error({ err, userId }, 'Failed to initialise socket session');
    socket.disconnect(true);
  }
}