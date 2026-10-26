import { z } from 'zod';
import { emailSchema, passwordSchema } from '../../validators/common.js';

export const registerSchema = z.object({
  name: z.string().trim().min(2).max(100),
  email: emailSchema,
  password: passwordSchema,
});

// Login par strength rules nahi lagate, sirf non-empty check
export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(200),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(20).max(200),
});