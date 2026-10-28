import { z } from 'zod';
import { bigintIdSchema, limitSchema } from '../../validators/common.js';

export const listNotificationsQuerySchema = z
  .object({
    limit: limitSchema(100, 30),
    cursor: bigintIdSchema.optional(),
    unread: z.enum(['true', 'false']).optional(),
  })
  .strict();

export const markReadSchema = z
  .object({
    ids: z.array(bigintIdSchema).min(1).max(100).optional(),
    all: z.literal(true).optional(),
  })
  .strict()
  .refine((body) => Boolean(body.ids) !== Boolean(body.all), {
    message: 'Provide either "ids" or "all": true',
    path: ['ids'],
  });

export const updatePreferencesSchema = z
  .object({
    messagesMode: z.enum(['all', 'mentions', 'none']).optional(),
    mentionsEnabled: z.boolean().optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, {
    message: 'Provide at least one field',
    path: ['messagesMode'],
  });