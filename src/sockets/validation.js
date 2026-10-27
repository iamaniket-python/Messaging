import { z } from 'zod';
import { uuidSchema, bigintIdSchema } from '../validators/common.js';

export const sendMessageEventSchema = z
  .object({
    conversationId: uuidSchema,
    clientMessageId: uuidSchema,
    content: z.string().trim().min(1).max(4000),
  })
  .strict();

export const conversationEventSchema = z.object({ conversationId: uuidSchema }).strict();

export const authRefreshEventSchema = z
  .object({ accessToken: z.string().min(20).max(2000) })
  .strict();

export const receiptEventSchema = z
  .object({ conversationId: uuidSchema, messageId: bigintIdSchema })
  .strict();

export const presenceEventSchema = z
  .object({ userIds: z.array(uuidSchema).min(1).max(100) })
  .strict();