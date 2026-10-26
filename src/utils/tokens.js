import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { AppError } from './AppError.js';

export const ISSUER = 'chat-platform';

export function signAccessToken({ userId, role, sessionId }) {
  return jwt.sign({ role, sid: sessionId }, env.JWT_ACCESS_SECRET, {
    algorithm: 'HS256',
    issuer: ISSUER,
    subject: userId,
    expiresIn: env.ACCESS_TOKEN_TTL_MIN * 60,
  });
}

export function verifyAccessToken(token) {
  try {
    // algorithms explicitly pin kiya, taaki "alg confusion" attack na ho
    return jwt.verify(token, env.JWT_ACCESS_SECRET, { algorithms: ['HS256'], issuer: ISSUER });
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      throw AppError.unauthorized('Access token expired', 'TOKEN_EXPIRED');
    }
    throw AppError.unauthorized('Invalid access token', 'INVALID_TOKEN');
  }
}

// Refresh token high-entropy random hai, isliye fast SHA-256 kaafi hai (bcrypt sirf low-entropy passwords ke liye)
export const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

export function generateRefreshToken() {
  const token = crypto.randomBytes(48).toString('base64url');
  return { token, hash: hashToken(token) };
}