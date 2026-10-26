import { Router } from 'express';
import { checkDb } from '../../config/db.js';

const router = Router();

// Liveness: process zinda hai? (load balancer / Docker yahi check karta hai)
router.get('/health', (_req, res) => {
  res.status(200).json({
    success: true,
    data: {
      status: 'ok',
      uptime: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    },
  });
});

// Readiness: dependencies (DB) ready hain? Nahi to traffic mat bhejo
router.get('/ready', async (req, res) => {
  try {
    await checkDb();
    res.status(200).json({
      success: true,
      data: { status: 'ready', checks: { database: 'up' } },
    });
  } catch (err) {
    req.log.error({ err }, 'Readiness check failed');
    res.status(503).json({
      success: false,
      data: { status: 'not_ready', checks: { database: 'down' } },
    });
  }
});

export default router;
