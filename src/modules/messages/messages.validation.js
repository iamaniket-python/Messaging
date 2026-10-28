import { z } from 'zod';
import { uuidSchema, bigintIdSchema, limitSchema } from '../../validators/common.js';

const contentSchema = z.string().trim().min(1, 'Message cannot be empty').max(4000);

// File message mein content khali ho sakta hai
const optionalContentSchema = z.string().trim().max(4000).default('');

const attachmentIdsSchema = z
  .array(uuidSchema)
  .max(5, 'At most 5 attachments per message')
  .optional();

export const messageIdParamsSchema = z.object({ messageId: bigintIdSchema });

export const sendMessageSchema = z
  .object({
    content: optionalContentSchema,
    clientMessageId: uuidSchema.optional(),
    attachmentIds: attachmentIdsSchema,
  })
  .strict()
  .refine((body) => body.content.length > 0 || (body.attachmentIds?.length ?? 0) > 0, {
    message: 'Message needs content or at least one attachment',
    path: ['content'],
  });

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