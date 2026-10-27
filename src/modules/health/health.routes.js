import { Router } from 'express';
import { checkDb } from '../../config/db.js';
import { checkRedis, isRedisEnabled } from '../../config/redis.js';

const router = Router();

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

router.get('/ready', async (req, res) => {
  const checks = { database: 'up' };
  let ready = true;

  try {
    await checkDb();
  } catch (err) {
    req.log.error({ err }, 'Database readiness check failed');
    checks.database = 'down';
    ready = false;
  }

  if (isRedisEnabled) {
    try {
      await checkRedis();
      checks.redis = 'up';
    } catch (err) {
      req.log.error({ err }, 'Redis readiness check failed');
      checks.redis = 'down';
      ready = false;
    }
  }

  res.status(ready ? 200 : 503).json({
    success: ready,
    data: { status: ready ? 'ready' : 'not_ready', checks },
  });
});

export default router;