import { AppError } from '../utils/AppError.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

export function notFoundHandler(req, _res, next) {
  next(AppError.notFound(`Route ${req.method} ${req.originalUrl} not found`, 'ROUTE_NOT_FOUND'));
}

// Alag-alag library errors ko ek standard AppError mein convert karta hai
function normalizeError(err) {
  if (err instanceof AppError) return err;

  // express.json() errors
  if (err.type === 'entity.parse.failed') {
    return new AppError(400, 'INVALID_JSON', 'Malformed JSON in request body');
  }
  if (err.type === 'entity.too.large') {
    return new AppError(413, 'PAYLOAD_TOO_LARGE', 'Request body is too large');
  }

  // PostgreSQL errors
  if (err.code === '23505') {
    return new AppError(409, 'CONFLICT', 'Resource already exists'); // unique violation
  }
  if (err.code === '22P02') {
    return new AppError(400, 'INVALID_INPUT', 'Invalid input format'); // e.g. bad UUID
  }

  return new AppError(500, 'INTERNAL_ERROR', 'Something went wrong');
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);

  const normalized = normalizeError(err);
  const log = req.log ?? logger;

  if (normalized.statusCode >= 500) {
    log.error({ err }, 'Unhandled error');
  } else {
    log.warn({ code: normalized.code, status: normalized.statusCode }, normalized.message);
  }

  res.status(normalized.statusCode).json({
    success: false,
    error: {
      code: normalized.code,
      message: normalized.message,
      ...(normalized.details && { details: normalized.details }),
      requestId: req.id,
      ...(env.NODE_ENV === 'development' && normalized.statusCode >= 500 && { stack: err.stack }),
    },
  });
}