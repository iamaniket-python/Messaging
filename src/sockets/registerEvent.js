import { AppError } from '../utils/AppError.js';
import { logger } from '../utils/logger.js';

const nowSeconds = () => Math.floor(Date.now() / 1000);

function toAckError(err, event) {
  if (err instanceof AppError) {
    return {
      ok: false,
      error: {
        code: err.code,
        message: err.message,
        ...(err.details && { details: err.details }),
      },
    };
  }
  logger.error({ err, event }, 'Unhandled socket event error');
  return { ok: false, error: { code: 'INTERNAL_ERROR', message: 'Something went wrong' } };
}

export function registerEvent(socket, event, { schema, handler, requireFreshToken = true, rateLimited = true }) {
  socket.on(event, async (payload, ack) => {
    const respond = typeof ack === 'function' ? ack : () => {};

    try {
      if (requireFreshToken && socket.data.tokenExp <= nowSeconds()) {
        throw AppError.unauthorized('Access token expired', 'TOKEN_EXPIRED');
      }

      if (rateLimited && !socket.data.bucket.consume()) {
        throw new AppError(429, 'RATE_LIMITED', 'Too many events, slow down');
      }

      let data = payload;
      if (schema) {
        const parsed = schema.safeParse(payload);
        if (!parsed.success) {
          throw new AppError(
            400,
            'VALIDATION_ERROR',
            'Invalid event payload',
            parsed.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }))
          );
        }
        data = parsed.data;
      }

      const result = await handler(socket, data);
      respond({ ok: true, data: result ?? null });
    } catch (err) {
      respond(toAckError(err, event));
    }
  });
}