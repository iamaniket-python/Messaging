import { z } from 'zod';
import { passwordSchema, uuidSchema } from '../../validators/common.js';

export const userIdParamsSchema = z.object({ userId: uuidSchema });

// strict(): unknown fields (jaise role) reject hote hain, mass assignment se bachav
export const updateProfileSchema = z
  .object({
    name: z.string().trim().min(2).max(100),
    bio: z.string().trim().max(500).nullable(),
    avatarUrl: z.string().trim().url().max(2048).nullable(),
  })
  .partial()
  .strict()
  .refine((obj) => Object.keys(obj).length > 0, { message: 'At least one field is required' });

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1).max(200),
    newPassword: passwordSchema,
  })
  .refine((data) => data.currentPassword !== data.newPassword, {
    message: 'New password must be different from the current password',
    path: ['newPassword'],
  });

export const updateRoleSchema = z.object({ role: z.enum(['user', 'admin']) }).strict();