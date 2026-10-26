import { Router } from 'express';
import authRoutes from './modules/auth/auth.routes.js';
import usersRoutes from './modules/users/users.routes.js';

const router = Router();

router.get('/', (_req, res) => {
  res.json({ success: true, data: { name: 'chat-platform-api', version: 'v1' } });
});

router.use('/auth', authRoutes);
router.use('/users', usersRoutes);

// Phase 4+: conversations, messages routes yahan mount honge

export default router;