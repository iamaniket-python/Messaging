import bcrypt from 'bcrypt';
import { query } from '../../config/db.js';
import { env } from '../../config/env.js';
import { AppError } from '../../utils/AppError.js';

// API field -> DB column whitelist. Dynamic SQL mein sirf yahi columns aa sakte hain.
const PROFILE_COLUMNS = { name: 'name', bio: 'bio', avatarUrl: 'avatar_url' };

export async function getById(userId) {
  const { rows } = await query('SELECT * FROM users WHERE id = $1', [userId]);
  if (!rows[0]) throw AppError.notFound('User not found', 'USER_NOT_FOUND');
  return rows[0];
}

export async function updateProfile(userId, data) {
  const sets = [];
  const values = [];

  for (const [key, column] of Object.entries(PROFILE_COLUMNS)) {
    if (key in data) {
      values.push(data[key]);
      sets.push(`${column} = $${values.length}`);
    }
  }

  values.push(userId);
  const { rows } = await query(
    `UPDATE users SET ${sets.join(', ')}, updated_at = now()
      WHERE id = $${values.length}
      RETURNING *`,
    values
  );
  if (!rows[0]) throw AppError.notFound('User not found', 'USER_NOT_FOUND');
  return rows[0];
}

export async function changePassword({ userId, sessionId, currentPassword, newPassword }) {
  const user = await getById(userId);

  const matches = await bcrypt.compare(currentPassword, user.password_hash);
  if (!matches) {
    throw AppError.badRequest('Current password is incorrect', undefined, 'INVALID_CURRENT_PASSWORD');
  }

  const newHash = await bcrypt.hash(newPassword, env.BCRYPT_ROUNDS);
  await query('UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2', [newHash, userId]);

  // Baaki sab devices logout, current session chalta rahe
  await query(
    `UPDATE sessions SET revoked_at = now()
      WHERE user_id = $1 AND id <> $2 AND revoked_at IS NULL`,
    [userId, sessionId]
  );
}

export async function updateRole(userId, role) {
  const { rows } = await query(
    'UPDATE users SET role = $1, updated_at = now() WHERE id = $2 RETURNING *',
    [role, userId]
  );
  if (!rows[0]) throw AppError.notFound('User not found', 'USER_NOT_FOUND');
  return rows[0];
}