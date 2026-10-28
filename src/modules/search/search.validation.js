import { z } from 'zod';
import { uuidSchema, bigintIdSchema, limitSchema } from '../../validators/common.js';

const isoDateSchema = z.string().datetime({ offset: true });

export const searchMessagesQuerySchema = z
  .object({
    q: z.string().trim().min(1, 'Search query cannot be empty').max(200),
    conversationId: uuidSchema.optional(),
    senderId: uuidSchema.optional(),
    from: isoDateSchema.optional(),
    to: isoDateSchema.optional(),
    limit: limitSchema(50, 20),
    cursor: bigintIdSchema.optional(),
  })
  .strict()
  .refine((query) => !(query.from && query.to) || new Date(query.from) <= new Date(query.to), {
    message: '"from" must be earlier than or equal to "to"',
    path: ['from'],
  });