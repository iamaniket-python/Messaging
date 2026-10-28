import { AppError } from '../utils/AppError.js';
import { containsNullByte } from '../utils/sanitize.js';

export function rejectNullBytes(req, _res, next) {
  if (containsNullByte(req.body) || containsNullByte(req.query)) {
    return next(new AppError(400, 'INVALID_INPUT', 'Request contains invalid characters'));
  }
  next();
}