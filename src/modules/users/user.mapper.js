// DB row (snake_case) se API response (camelCase). password_hash kabhi bahar nahi jata.
export const toOwnUser = (row) => ({
  id: row.id,
  name: row.name,
  email: row.email,
  avatarUrl: row.avatar_url,
  bio: row.bio,
  role: row.role,
  lastSeenAt: row.last_seen_at,
  createdAt: row.created_at,
});

export const toPublicUser = (row) => ({
  id: row.id,
  name: row.name,
  avatarUrl: row.avatar_url,
  bio: row.bio,
});