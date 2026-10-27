import { registerEvent } from '../registerEvent.js';
import { authRefreshEventSchema } from '../validation.js';
import { verifyAccessToken } from '../../utils/tokens.js';
import { AppError } from '../../utils/AppError.js';

export function registerAuthHandlers(socket) {
  registerEvent(socket, 'auth:refresh', {
    schema: authRefreshEventSchema,
    requireFreshToken: false,
    handler: async (sock, { accessToken }) => {
      const payload = verifyAccessToken(accessToken);

      if (payload.sub !== sock.data.user.id) {
        throw AppError.forbidden('Token belongs to a different user', 'TOKEN_USER_MISMATCH');
      }

      sock.data.tokenExp = payload.exp;
      sock.data.user.role = payload.role;

      return { expiresAt: payload.exp };
    },
  });
}