import { z } from 'zod';

export const emailSchema = z.string().trim().toLowerCase().email().max(254);

// bcrypt sirf pehle 72 bytes use karta hai, isliye upar limit
export const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .refine((value) => Buffer.byteLength(value, 'utf8') <= 72, 'Password must be at most 72 bytes');

export const uuidSchema = z.string().uuid();