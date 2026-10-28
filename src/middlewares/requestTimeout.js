import { env } from '../config/env.js';

export const requestTimeout =
  (ms = env.REQUEST_TIMEOUT_MS) =>
  (req, res, next) => {
    const timer = setTimeout(() => {
      if (res.headersSent) return;
      req.log?.warn({ timeoutMs: ms }, 'Request timed out');
      res.status(503).json({
        success: false,
        error: {
          code: 'REQUEST_TIMEOUT',
          message: 'Request took too long to process',
          requestId: req.id,
        },
      });
    }, ms);
    timer.unref();

    const clear = () => clearTimeout(timer);
    res.once('finish', clear);
    res.once('close', clear);

    next();
  };