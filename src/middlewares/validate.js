import { AppError } from '../utils/AppError.js';

/**
 * Usage:
 *   router.post('/x', validate({ body: schema, params: schema, query: schema }), controller)
 * Parsed (aur coerced) data req.validated mein milta hai.
 *
 * Note: Express 5 mein req.query read-only getter hai, isliye usko overwrite nahi karte.
 */
export const validate = (schemas) => (req, _res, next) => {
  const issues = [];
  const validated = {};

  for (const part of ['params', 'query', 'body']) {
    const schema = schemas[part];
    if (!schema) continue;

    const result = schema.safeParse(req[part]);
    if (result.success) {
      validated[part] = result.data;
    } else {
      for (const issue of result.error.issues) {
        issues.push({ in: part, path: issue.path.join('.'), message: issue.message });
      }
    }
  }

  if (issues.length > 0) {
    return next(new AppError(400, 'VALIDATION_ERROR', 'Request validation failed', issues));
  }

  req.validated = validated;
  next();
};