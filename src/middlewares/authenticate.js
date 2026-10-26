import { verifyAccessToken } from '../utils/tokens.js';
import { AppError } from '../utils/AppError.js';

export function authenticate(req, _res, next) {
  const header = req.headers.authorization ?? '';
  const [scheme, token] = header.split(' ');

  if (scheme?.toLowerCase() !== 'bearer' || !token) {
    throw AppError.unauthorized('Missing or malformed Authorization header', 'MISSING_TOKEN');
  }

  const payload = verifyAccessToken(token);
  // Identity hamesha verified token se aati hai, client ke body se kabhi nahi
  req.user = { id: payload.sub, role: payload.role, sessionId: payload.sid };
  next();
}