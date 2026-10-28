import { randomUUID } from 'node:crypto';
import express, { Router } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import pinoHttp from 'pino-http';
import swaggerUi from 'swagger-ui-express';
import { env } from './config/env.js';
import { logger } from './utils/logger.js';
import { AppError } from './utils/AppError.js';
import healthRoutes from './modules/health/health.routes.js';
import apiRoutes from './routes.js';
import { openApiDocument } from './docs/openapi.js';
import { notFoundHandler, errorHandler } from './middlewares/errorHandler.js';
import { requestTimeout } from './middlewares/requestTimeout.js';
import { rejectNullBytes } from './middlewares/rejectNullBytes.js';

const app = express();

app.set('trust proxy', env.TRUST_PROXY);

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

// Swagger UI ko inline styles chahiye, isliye sirf /api/docs par relaxed CSP.
// API ke baaki routes par strict CSP (neeche) hi lagti hai.
const docsRouter = Router();
docsRouter.use((req, res, next) => {
  if (req.originalUrl.split('?')[0] === '/api/docs') return res.redirect(302, '/api/docs/');
  next();
});
docsRouter.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        frameAncestors: ["'none'"],
        upgradeInsecureRequests: null,
      },
    },
    referrerPolicy: { policy: 'no-referrer' },
    hsts: false,
  })
);
docsRouter.get('/openapi.json', (_req, res) => res.json(openApiDocument));
docsRouter.use('/', swaggerUi.serve, swaggerUi.setup(openApiDocument, { customSiteTitle: 'Chat Platform API' }));
app.use('/api/docs', docsRouter);

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
    },
    referrerPolicy: { policy: 'no-referrer' },
    hsts:
      env.NODE_ENV === 'production'
        ? { maxAge: 15_552_000, includeSubDomains: true }
        : false,
  })
);

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || env.CORS_ORIGINS.includes(origin)) return callback(null, true);
      return callback(new AppError(403, 'CORS_ORIGIN_DENIED', 'Origin not allowed'));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
    exposedHeaders: ['X-Request-Id'],
    maxAge: 600,
  })
);

app.use(requestTimeout());
app.use(express.json({ limit: '100kb' }));
app.use(rejectNullBytes);

app.use(healthRoutes);
app.use('/api/v1', apiRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

export default app;