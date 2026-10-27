import { getIO } from './io.js';
import { userRoom, conversationRoom, presenceRoom } from './rooms.js';
import { logger } from '../utils/logger.js';
import { toMessage } from '../modules/messages/message.mapper.js';

function safely(label, fn) {
  try {
    fn();
  } catch (err) {
    logger.error({ err, label }, 'Realtime operation failed');
  }
}

function emitToRoom(room, event, payload, exceptSocketId) {
  safely(event, () => {
    const io = getIO();
    if (!io) return;
    let target = io.to(room);
    if (exceptSocketId) target = target.except(exceptSocketId);
    target.emit(event, payload);
  });
}

export const emitToConversation = (conversationId, event, payload, { exceptSocketId } = {}) =>
  emitToRoom(conversationRoom(conversationId), event, payload, exceptSocketId);

export const emitToUser = (userId, event, payload, { exceptSocketId } = {}) =>
  emitToRoom(userRoom(userId), event, payload, exceptSocketId);

export const emitToPresence = (userId, event, payload) =>
  emitToRoom(presenceRoom(userId), event, payload);

export function joinConversationRoom(userId, conversationId) {
  safely('joinConversationRoom', () => {
    getIO()?.in(userRoom(userId)).socketsJoin(conversationRoom(conversationId));
  });
}

export function leaveConversationRoom(userId, conversationId) {
  safely('leaveConversationRoom', () => {
    getIO()?.in(userRoom(userId)).socketsLeave(conversationRoom(conversationId));
  });
}

export function broadcastNewMessage(messageRow, options = {}) {
  emitToConversation(messageRow.conversation_id, 'message:new', { message: toMessage(messageRow) }, options);
}

// event: 'message:delivered' | 'message:read'
export function broadcastReceipt(event, { conversationId, userId, messageId, conversationType }, options = {}) {
  const payload = { conversationId, userId, messageId };

  if (conversationType === 'channel') {
    if (event === 'message:read') emitToUser(userId, event, payload, options);
    return;
  }

  emitToConversation(conversationId, event, payload, options);
}