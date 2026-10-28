import { Router } from 'express';
import { validate } from '../../middlewares/validate.js';
import { authenticate } from '../../middlewares/authenticate.js';
import * as controller from './notifications.controller.js';
import {
  listNotificationsQuerySchema,
  markReadSchema,
  updatePreferencesSchema,
} from './notifications.validation.js';

const router = Router();

router.use(authenticate);
router.get('/', validate({ query: listNotificationsQuerySchema }), controller.list);
router.get('/unread-count', controller.unreadCount);
router.post('/read', validate({ body: markReadSchema }), controller.markRead);

export const preferencesRouter = Router();

preferencesRouter.use(authenticate);
preferencesRouter.get('/', controller.getPreferences);
preferencesRouter.patch('/', validate({ body: updatePreferencesSchema }), controller.updatePreferences);

export default router;