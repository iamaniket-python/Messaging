import { z } from 'zod';
import { uuidSchema, bigintIdSchema, limitSchema } from '../../validators/common.js';

const contentSchema = z.string().trim().min(1, 'Message cannot be empty').max(4000);

export const messageIdParamsSchema = z.object({ messageId: bigintIdSchema });

export const sendMessageSchema = z
  .object({
    content: contentSchema,
    clientMessageId: uuidSchema.optional(),
    mentions: z.array(uuidSchema).max(20).optional(),
  })
  .strict();

export const editMessageSchema = z.object({ content: contentSchema }).strict();

export const listMessagesQuerySchema = z
  .object({
    limit: limitSchema(100, 30),
    before: bigintIdSchema.optional(),
    after: bigintIdSchema.optional(),
  })
  .refine((query) => !(query.before && query.after), {
    message: 'Use either "before" or "after", not both',
    path: ['before'],
  });