import { z } from 'zod';
import { uuidSchema, bigintIdSchema } from '../validators/common.js';

export const sendMessageEventSchema = z
  .object({
    conversationId: uuidSchema,
    clientMessageId: uuidSchema,
    content: z.string().trim().max(4000).default(''),
    attachmentIds: z.array(uuidSchema).max(5).optional(),
  })
  .strict()
  .refine((body) => body.content.length > 0 || (body.attachmentIds?.length ?? 0) > 0, {
    message: 'Message needs content or at least one attachment',
    path: ['content'],
  });

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