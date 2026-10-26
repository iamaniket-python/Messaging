import { AppError } from '../utils/AppError.js';

export const requireRole =
  (...roles) =>
  (req, _res, next) => {
    if (!req.user) throw AppError.unauthorized();
    if (!roles.includes(req.user.role)) {
      throw AppError.forbidden('Insufficient permissions', 'INSUFFICIENT_ROLE');
    }
    next();
  };