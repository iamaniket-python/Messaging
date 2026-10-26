import { Router } from 'express';
import { validate } from '../../middlewares/validate.js';
import { authenticate } from '../../middlewares/authenticate.js';
import * as controller from './conversations.controller.js';
import {
  createConversationSchema,
  conversationIdParamsSchema,
  memberParamsSchema,
  listConversationsQuerySchema,
  publicChannelsQuerySchema,
  updateConversationSchema,
  addMembersSchema,
  updateMemberRoleSchema,
  markReadSchema,
} from './conversations.validation.js';

const router = Router();

router.use(authenticate);

router.post('/', validate({ body: createConversationSchema }), controller.create);
router.get('/', validate({ query: listConversationsQuerySchema }), controller.listMine);
router.get('/public-channels', validate({ query: publicChannelsQuerySchema }), controller.listPublicChannels);

router.get('/:conversationId', validate({ params: conversationIdParamsSchema }), controller.getOne);
router.patch(
  '/:conversationId',
  validate({ params: conversationIdParamsSchema, body: updateConversationSchema }),
  controller.update
);

router.post('/:conversationId/join', validate({ params: conversationIdParamsSchema }), controller.join);
router.post('/:conversationId/leave', validate({ params: conversationIdParamsSchema }), controller.leave);
router.post(
  '/:conversationId/read',
  validate({ params: conversationIdParamsSchema, body: markReadSchema }),
  controller.markRead
);

router.post(
  '/:conversationId/members',
  validate({ params: conversationIdParamsSchema, body: addMembersSchema }),
  controller.addMembers
);
router.delete(
  '/:conversationId/members/:userId',
  validate({ params: memberParamsSchema }),
  controller.removeMember
);
router.patch(
  '/:conversationId/members/:userId',
  validate({ params: memberParamsSchema, body: updateMemberRoleSchema }),
  controller.updateMemberRole
);

export default router;