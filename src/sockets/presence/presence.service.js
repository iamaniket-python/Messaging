import { presenceStore } from './presenceStore.js';
import { query } from '../../config/db.js';
import { env } from '../../config/env.js';
import { emitToPresence } from '../realtime.js';
import { logger } from '../../utils/logger.js';

const offlineTimers = new Map();

export async function userConnected(userId, socketId) {
  const pending = offlineTimers.get(userId);
  if (pending) {
    clearTimeout(pending);
    offlineTimers.delete(userId);
  }

  const count = await presenceStore.add(userId, socketId);

  if (count === 1 && !pending) {
    emitToPresence(userId, 'presence:update', { userId, status: 'online', lastSeenAt: null });
  }
}

export async function userDisconnected(userId, socketId) {
  const count = await presenceStore.remove(userId, socketId);
  if (count > 0) return;

  const existing = offlineTimers.get(userId);
  if (existing) clearTimeout(existing);

  const timer = setTimeout(async () => {
    offlineTimers.delete(userId);
    try {
      if ((await presenceStore.count(userId)) > 0) return;

      const { rows } = await query(
        'UPDATE users SET last_seen_at = now() WHERE id = $1 RETURNING last_seen_at',
        [userId]
      );
      emitToPresence(userId, 'presence:update', {
        userId,
        status: 'offline',
        lastSeenAt: rows[0]?.last_seen_at ?? null,
      });
    } catch (err) {
      logger.error({ err, userId }, 'Failed to mark user offline');
    }
  }, env.PRESENCE_OFFLINE_GRACE_MS);

  timer.unref();
  offlineTimers.set(userId, timer);
}

export async function filterVisibleUsers(requesterId, userIds) {
  const { rows } = await query(
    `SELECT DISTINCT other.user_id
       FROM conversation_members mine
       JOIN conversation_members other ON other.conversation_id = mine.conversation_id
      WHERE mine.user_id = $1 AND other.user_id = ANY($2::uuid[])`,
    [requesterId, userIds]
  );
  const visible = new Set(rows.map((row) => row.user_id));
  return userIds.filter((id) => visible.has(id));
}

export async function getStatuses(userIds) {
  if (userIds.length === 0) return {};

  const online = await presenceStore.onlineUserIds(userIds);
  const isOnline = (id) => online.has(id) || offlineTimers.has(id);

  const offlineIds = userIds.filter((id) => !isOnline(id));
  const lastSeen = new Map();

  if (offlineIds.length > 0) {
    const { rows } = await query('SELECT id, last_seen_at FROM users WHERE id = ANY($1::uuid[])', [offlineIds]);
    for (const row of rows) lastSeen.set(row.id, row.last_seen_at);
  }

  return Object.fromEntries(
    userIds.map((id) => [
      id,
      isOnline(id)
        ? { status: 'online', lastSeenAt: null }
        : { status: 'offline', lastSeenAt: lastSeen.get(id) ?? null },
    ])
  );
}