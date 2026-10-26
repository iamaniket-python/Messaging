import { z } from 'zod';

export const emailSchema = z.string().trim().toLowerCase().email().max(254);

export const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .refine((value) => Buffer.byteLength(value, 'utf8') <= 72, 'Password must be at most 72 bytes');

export const uuidSchema = z.string().uuid();

export const bigintIdSchema = z.string().regex(/^\d{1,18}$/, 'Must be a numeric id');

export const limitSchema = (max, defaultValue) =>
  z.coerce.number().int().min(1).max(max).default(defaultValue);