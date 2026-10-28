import { Router } from 'express';
import { validate } from '../../middlewares/validate.js';
import { authenticate } from '../../middlewares/authenticate.js';
import { messageLimiter } from '../../middlewares/rateLimiters.js';
import * as controller from './attachments.controller.js';
import { attachmentIdParamsSchema, createUploadUrlSchema } from './attachments.validation.js';

const router = Router();

router.use(authenticate);

router.post(
  '/upload-url',
  messageLimiter,
  validate({ body: createUploadUrlSchema }),
  controller.createUploadUrl
);
router.post(
  '/:attachmentId/complete',
  validate({ params: attachmentIdParamsSchema }),
  controller.complete
);
router.get('/:attachmentId', validate({ params: attachmentIdParamsSchema }), controller.get);

export default router;