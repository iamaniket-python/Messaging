import { getIO } from './io.js';
import { userRoom, conversationRoom } from './rooms.js';
import { logger } from '../utils/logger.js';
import { toMessage } from '../modules/messages/message.mapper.js';

function safely(label, fn) {
  try {
    fn();
  } catch (err) {
    logger.error({ err, label }, 'Realtime emit failed');
  }
}

export function emitToConversation(conversationId, event, payload, { exceptSocketId } = {}) {
  safely(event, () => {
    const io = getIO();
    if (!io) return;
    let target = io.to(conversationRoom(conversationId));
    if (exceptSocketId) target = target.except(exceptSocketId);
    target.emit(event, payload);
  });
}

export function emitToUser(userId, event, payload) {
  safely(event, () => {
    getIO()?.to(userRoom(userId)).emit(event, payload);
  });
}

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