import { Router } from 'express';
import authRoutes from './modules/auth/auth.routes.js';
import usersRoutes from './modules/users/users.routes.js';
import conversationsRoutes from './modules/conversations/conversations.routes.js';
import messageRoutes, { conversationMessagesRouter } from './modules/messages/messages.routes.js';

const router = Router();

router.get('/', (_req, res) => {
  res.json({ success: true, data: { name: 'chat-platform-api', version: 'v1' } });
});

router.use('/auth', authRoutes);
router.use('/users', usersRoutes);
router.use('/conversations/:conversationId/messages', conversationMessagesRouter);
router.use('/conversations', conversationsRoutes);
router.use('/messages', messageRoutes);

export default router;