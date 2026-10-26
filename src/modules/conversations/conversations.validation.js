import { z } from 'zod';
import { uuidSchema, bigintIdSchema, limitSchema } from '../../validators/common.js';

export const CHANNEL_NAME_REGEX = /^[a-z0-9][a-z0-9_-]{1,79}$/;

const descriptionSchema = z.string().trim().max(500);
const memberIdsSchema = z.array(uuidSchema).max(99).default([]);

const dmSchema = z.object({ type: z.literal('dm'), userId: uuidSchema }).strict();

const groupSchema = z
  .object({
    type: z.literal('group'),
    name: z.string().trim().min(2).max(100),
    description: descriptionSchema.optional(),
    memberIds: memberIdsSchema,
  })
  .strict();

const channelSchema = z
  .object({
    type: z.literal('channel'),
    name: z
      .string()
      .trim()
      .toLowerCase()
      .regex(CHANNEL_NAME_REGEX, 'Channel name must be 2-80 chars: lowercase letters, numbers, "-" or "_"'),
    description: descriptionSchema.optional(),
    visibility: z.enum(['public', 'private']).default('public'),
    memberIds: memberIdsSchema,
  })
  .strict();

export const createConversationSchema = z.discriminatedUnion('type', [dmSchema, groupSchema, channelSchema]);

export const conversationIdParamsSchema = z.object({ conversationId: uuidSchema });

export const memberParamsSchema = z.object({ conversationId: uuidSchema, userId: uuidSchema });

export const listConversationsQuerySchema = z.object({ limit: limitSchema(50, 30) });

export const publicChannelsQuerySchema = z.object({
  q: z.string().trim().max(80).optional(),
  limit: limitSchema(50, 30),
});

export const updateConversationSchema = z
  .object({
    name: z.string().trim().min(2).max(100),
    description: descriptionSchema.nullable(),
  })
  .partial()
  .strict()
  .refine((obj) => Object.keys(obj).length > 0, { message: 'At least one field is required' });

export const addMembersSchema = z
  .object({ userIds: z.array(uuidSchema).min(1).max(50) })
  .strict();

export const updateMemberRoleSchema = z.object({ role: z.enum(['admin', 'member']) }).strict();

export const markReadSchema = z.object({ messageId: bigintIdSchema }).strict();