import { randomUUID } from 'node:crypto';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import pinoHttp from 'pino-http';
import { env } from './config/env.js';
import { logger } from './utils/logger.js';
import { AppError } from './utils/AppError.js';
import healthRoutes from './modules/health/health.routes.js';
import apiRoutes from './routes.js';
import { notFoundHandler, errorHandler } from './middlewares/errorHandler.js';

const app = express();

// Load balancer ke peeche real client IP ke liye (rate limiting mein kaam aayega)
app.set('trust proxy', env.TRUST_PROXY);

// 1. Request ID + structured logging
app.use(
  pinoHttp({
    logger,
    genReqId: (req, res) => {
      const incoming = req.headers['x-request-id'];
      const id = typeof incoming === 'string' && /^[\w-]{1,64}$/.test(incoming) ? incoming : randomUUID();
      res.setHeader('x-request-id', id);
      return id;
    },
    customLogLevel: (_req, res, err) => {
      if (err || res.statusCode >= 500) return 'error';
      if (res.statusCode >= 400) return 'warn';
      return 'info';
    },
    autoLogging: { ignore: (req) => req.url === '/health' },
  })
);

// 2. Security headers
app.use(helmet());

// 3. CORS allow-list (Postman/curl jaise no-origin requests allowed)
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || env.CORS_ORIGINS.includes(origin)) return callback(null, true);
      return callback(new AppError(403, 'CORS_ORIGIN_DENIED', 'Origin not allowed'));
    },
    credentials: true,
  })
);

// 4. Body parsing (size limit se malicious bade payloads rukte hain)
app.use(express.json({ limit: '100kb' }));

// 5. Routes
app.use(healthRoutes);
app.use('/api/v1', apiRoutes);

// 6. 404 + central error handler (hamesha sabse last mein)
app.use(notFoundHandler);
app.use(errorHandler);

export default app;