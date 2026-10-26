import bcrypt from 'bcrypt';
import { pool, query, withTransaction } from '../../config/db.js';
import { env } from '../../config/env.js';
import { AppError } from '../../utils/AppError.js';
import { signAccessToken, generateRefreshToken, hashToken } from '../../utils/tokens.js';

// User exist na kare tab bhi bcrypt.compare chalate hain, taaki response time se email guess na ho (timing attack)
let dummyHashPromise;
const getDummyHash = () => (dummyHashPromise ??= bcrypt.hash('dummy-password-for-timing', env.BCRYPT_ROUNDS));

// db = pool ya transaction client, dono mein .query() hai
async function issueTokens(db, user, meta, familyId = null) {
  const { token: refreshToken, hash } = generateRefreshToken();
  const expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);

  const {
    rows: [session],
  } = await db.query(
    `INSERT INTO sessions (user_id, family_id, token_hash, user_agent, ip, expires_at)
     VALUES ($1, COALESCE($2::uuid, gen_random_uuid()), $3, $4, $5, $6)
     RETURNING id`,
    [user.id, familyId, hash, meta.userAgent, meta.ip, expiresAt]
  );

  const accessToken = signAccessToken({ userId: user.id, role: user.role, sessionId: session.id });
  return { accessToken, refreshToken };
}

export async function register({ name, email, password }, meta) {
  const passwordHash = await bcrypt.hash(password, env.BCRYPT_ROUNDS);

  let user;
  try {
    const { rows } = await query(
      'INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING *',
      [name, email, passwordHash]
    );
    user = rows[0];
  } catch (err) {
    if (err.code === '23505') {
      throw AppError.conflict('An account with this email already exists', 'EMAIL_TAKEN');
    }
    throw err;
  }

  const tokens = await issueTokens(pool, user, meta);
  return { user, ...tokens };
}

export async function login({ email, password }, meta) {
  const { rows } = await query('SELECT * FROM users WHERE email = $1', [email]);
  const user = rows[0];

  const hash = user?.password_hash ?? (await getDummyHash());
  const passwordOk = await bcrypt.compare(password, hash);

  // Dono case (email galat / password galat) mein same message
  if (!user || !passwordOk) {
    throw AppError.unauthorized('Invalid email or password', 'INVALID_CREDENTIALS');
  }

  const tokens = await issueTokens(pool, user, meta);
  return { user, ...tokens };
}

export async function refresh(refreshToken, meta) {
  const outcome = await withTransaction(async (client) => {
    // FOR UPDATE: ek hi token par do parallel refresh aaye to doosra wait karega
    const {
      rows: [session],
    } = await client.query(
      `SELECT s.id, s.user_id, s.family_id, s.expires_at, s.revoked_at, u.role
         FROM sessions s
         JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = $1
        FOR UPDATE OF s`,
      [hashToken(refreshToken)]
    );

    if (!session) return { error: 'INVALID' };

    if (session.revoked_at) {
      // Purana token dobara aaya: chori ka shak, poori family revoke
      await client.query(
        'UPDATE sessions SET revoked_at = now() WHERE family_id = $1 AND revoked_at IS NULL',
        [session.family_id]
      );
      return { error: 'REUSED' };
    }

    if (session.expires_at <= new Date()) return { error: 'EXPIRED' };

    await client.query('UPDATE sessions SET revoked_at = now() WHERE id = $1', [session.id]);
    const tokens = await issueTokens(
      client,
      { id: session.user_id, role: session.role },
      meta,
      session.family_id
    );
    return { tokens };
  });

  // Error transaction ke BAHAR throw karte hain, warna family-revoke rollback ho jata
  if (outcome.error === 'INVALID') {
    throw AppError.unauthorized('Invalid refresh token', 'INVALID_REFRESH_TOKEN');
  }
  if (outcome.error === 'REUSED') {
    throw AppError.unauthorized('Refresh token reuse detected, please log in again', 'REFRESH_TOKEN_REUSED');
  }
  if (outcome.error === 'EXPIRED') {
    throw AppError.unauthorized('Refresh token expired', 'REFRESH_TOKEN_EXPIRED');
  }
  return outcome.tokens;
}

// Idempotent: token pehle se revoked ya unknown ho tab bhi success (204)
export async function logout(refreshToken) {
  await query(
    'UPDATE sessions SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL',
    [hashToken(refreshToken)]
  );
}

export async function logoutAll(userId) {
  await query('UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [userId]);
}