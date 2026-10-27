import { registerEvent } from '../registerEvent.js';
import { receiptEventSchema } from '../validation.js';
import { broadcastReceipt } from '../realtime.js';
import * as receiptsService from '../../modules/conversations/receipts.service.js';

export function registerReceiptHandlers(socket) {
  registerEvent(socket, 'message:delivered', {
    schema: receiptEventSchema,
    handler: async (sock, { conversationId, messageId }) => {
      const userId = sock.data.user.id;
      const result = await receiptsService.markDelivered(conversationId, userId, messageId);

      if (result.advanced) {
        broadcastReceipt(
          'message:delivered',
          { conversationId, userId, messageId: result.messageId, conversationType: result.conversationType },
          { exceptSocketId: sock.id }
        );
      }

      return { lastDeliveredMessageId: result.messageId };
    },
  });

  registerEvent(socket, 'message:read', {
    schema: receiptEventSchema,
    handler: async (sock, { conversationId, messageId }) => {
      const userId = sock.data.user.id;
      const result = await receiptsService.markRead(conversationId, userId, messageId);

      if (result.advanced) {
        broadcastReceipt(
          'message:read',
          { conversationId, userId, messageId: result.messageId, conversationType: result.conversationType },
          { exceptSocketId: sock.id }
        );
      }

      return { lastReadMessageId: result.messageId };
    },
  });
}