import { Router } from 'express';
import { validate } from '../../middlewares/validate.js';
import { authenticate } from '../../middlewares/authenticate.js';
import { requireRole } from '../../middlewares/authorize.js';
import * as controller from './users.controller.js';
import {
  userIdParamsSchema,
  updateProfileSchema,
  changePasswordSchema,
  updateRoleSchema,
} from './users.validation.js';

const router = Router();

router.use(authenticate); // is router ke saare routes login maangte hain

// "/me" routes pehle, warna "/:userId" unhe "me" ID samajh lega
router.get('/me', controller.getMe);
router.patch('/me', validate({ body: updateProfileSchema }), controller.updateMe);
router.post('/me/change-password', validate({ body: changePasswordSchema }), controller.changePassword);

router.get('/:userId', validate({ params: userIdParamsSchema }), controller.getUserById);
router.patch(
  '/:userId/role',
  requireRole('admin'),
  validate({ params: userIdParamsSchema, body: updateRoleSchema }),
  controller.updateUserRole
);

export default router;