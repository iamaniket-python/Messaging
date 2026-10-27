import { presenceStore } from './presenceStore.js';
import { query } from '../../config/db.js';
import { env } from '../../config/env.js';
import { emitToPresence } from '../realtime.js';
import { logger } from '../../utils/logger.js';

const offlineTimers = new Map();
const localSockets = new Map();
let heartbeatTimer = null;
let sweepTimer = null;

async function safely(label, fn, fallback) {
  try {
    return await fn();
  } catch (err) {
    logger.error({ err, label }, 'Presence operation failed');
    return fallback;
  }
}

async function markOffline(userId) {
  const claimed = await presenceStore.claimOffline(userId);
  if (!claimed) return;

  const { rows } = await query('UPDATE users SET last_seen_at = now() WHERE id = $1 RETURNING last_seen_at', [
    userId,
  ]);

  emitToPresence(userId, 'presence:update', {
    userId,
    status: 'offline',
    lastSeenAt: rows[0]?.last_seen_at ?? null,
  });
}

function startBackgroundTasks() {
  if (!heartbeatTimer) {
    heartbeatTimer = setInterval(() => {
      const entries = [...localSockets].map(([socketId, userId]) => ({ userId, socketId }));
      safely('heartbeat', () => presenceStore.touchMany(entries));
    }, env.PRESENCE_HEARTBEAT_MS);
    heartbeatTimer.unref();
  }

  if (!sweepTimer) {
    sweepTimer = setInterval(() => {
      safely('sweep', async () => {
        for (const userId of await presenceStore.findStaleOnlineUsers()) {
          await markOffline(userId);
        }
      });
    }, env.PRESENCE_SWEEP_INTERVAL_MS);
    sweepTimer.unref();
  }
}

export function stopPresenceTasks() {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  if (sweepTimer) clearInterval(sweepTimer);
  heartbeatTimer = null;
  sweepTimer = null;
}

export async function userConnected(userId, socketId) {
  startBackgroundTasks();
  localSockets.set(socketId, userId);

  const pending = offlineTimers.get(userId);
  if (pending) {
    clearTimeout(pending);
    offlineTimers.delete(userId);
  }

  await safely('connect', async () => {
    await presenceStore.add(userId, socketId);
    if (await presenceStore.markOnline(userId)) {
      emitToPresence(userId, 'presence:update', { userId, status: 'online', lastSeenAt: null });
    }
  });
}

export async function userDisconnected(userId, socketId) {
  localSockets.delete(socketId);

  await safely('disconnect', async () => {
    await presenceStore.setGrace(userId, env.PRESENCE_OFFLINE_GRACE_MS + 5000);
    const live = await presenceStore.remove(userId, socketId);
    if (live > 0) return;

    const existing = offlineTimers.get(userId);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      offlineTimers.delete(userId);
      safely('offline', async () => {
        if ((await presenceStore.count(userId)) > 0) return;
        await markOffline(userId);
      });
    }, env.PRESENCE_OFFLINE_GRACE_MS);

    timer.unref();
    offlineTimers.set(userId, timer);
  });
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

  const online = await safely('statuses', () => presenceStore.onlineUserIds(userIds), new Set());
  const offlineIds = userIds.filter((id) => !online.has(id));
  const lastSeen = new Map();

  if (offlineIds.length > 0) {
    const { rows } = await query('SELECT id, last_seen_at FROM users WHERE id = ANY($1::uuid[])', [offlineIds]);
    for (const row of rows) lastSeen.set(row.id, row.last_seen_at);
  }

  return Object.fromEntries(
    userIds.map((id) => [
      id,
      online.has(id)
        ? { status: 'online', lastSeenAt: null }
        : { status: 'offline', lastSeenAt: lastSeen.get(id) ?? null },
    ])
  );
}