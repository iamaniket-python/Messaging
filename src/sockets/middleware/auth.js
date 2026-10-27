import { verifyAccessToken } from '../../utils/tokens.js';
import { AppError } from '../../utils/AppError.js';
import { query } from '../../config/db.js';
import { logger } from '../../utils/logger.js';

function reject(next, code, message) {
  const err = new Error(message);
  err.data = { code };
  next(err);
}

function extractToken(socket) {
  const fromAuth = socket.handshake.auth?.token;
  if (typeof fromAuth === 'string' && fromAuth) return fromAuth;

  const header = socket.handshake.headers?.authorization;
  if (typeof header === 'string' && header.toLowerCase().startsWith('bearer ')) {
    return header.slice(7);
  }
  return null;
}

export async function socketAuth(socket, next) {
  try {
    const token = extractToken(socket);
    if (!token) return reject(next, 'MISSING_TOKEN', 'Authentication token required');

    const payload = verifyAccessToken(token);

    const { rows } = await query(
      'SELECT conversation_id FROM conversation_members WHERE user_id = $1',
      [payload.sub]
    );

    socket.data.user = { id: payload.sub, role: payload.role };
    socket.data.tokenExp = payload.exp;
    socket.data.conversationIds = rows.map((row) => row.conversation_id);

    return next();
  } catch (err) {
    if (err instanceof AppError) return reject(next, err.code, err.message);
    logger.error({ err }, 'Socket authentication failed unexpectedly');
    return reject(next, 'INTERNAL_ERROR', 'Authentication failed');
  }
}