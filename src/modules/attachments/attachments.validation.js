import { z } from 'zod';
import { uuidSchema } from '../../validators/common.js';

export const attachmentIdParamsSchema = z.object({ attachmentId: uuidSchema });

// MIME whitelist aur size limit service mein check hoti hai (membership ke baad)
export const createUploadUrlSchema = z
  .object({
    conversationId: uuidSchema,
    fileName: z.string().trim().min(1).max(255),
    mimeType: z.string().trim().toLowerCase().min(1).max(100),
    sizeBytes: z.number().int().positive(),
  })
  .strict();