import { Router } from 'express';
import { validate } from '../../middlewares/validate.js';
import { authenticate } from '../../middlewares/authenticate.js';
import { messageLimiter } from '../../middlewares/rateLimiters.js';
import { conversationIdParamsSchema } from '../conversations/conversations.validation.js';
import * as controller from './messages.controller.js';
import {
  messageIdParamsSchema,
  sendMessageSchema,
  editMessageSchema,
  listMessagesQuerySchema,
} from './messages.validation.js';

// /api/v1/conversations/:conversationId/messages
export const conversationMessagesRouter = Router({ mergeParams: true });

conversationMessagesRouter.use(authenticate);
conversationMessagesRouter.get(
  '/',
  validate({ params: conversationIdParamsSchema, query: listMessagesQuerySchema }),
  controller.list
);
conversationMessagesRouter.post(
  '/',
  messageLimiter,
  validate({ params: conversationIdParamsSchema, body: sendMessageSchema }),
  controller.send
);

// /api/v1/messages/:messageId
const messageRouter = Router();

messageRouter.use(authenticate);
messageRouter.patch(
  '/:messageId',
  validate({ params: messageIdParamsSchema, body: editMessageSchema }),
  controller.edit
);
messageRouter.delete('/:messageId', validate({ params: messageIdParamsSchema }), controller.remove);

export default messageRouter;