import * as service from './notifications.service.js';
import { toNotification, toPreferences } from './notifications.mapper.js';

export async function list(req, res) {
  const { limit, cursor, unread } = req.validated.query;
  const result = await service.listNotifications({
    userId: req.user.id,
    limit,
    cursor,
    unreadOnly: unread === 'true',
  });

  res.json({
    success: true,
    data: {
      notifications: result.notifications.map(toNotification),
      pageInfo: { hasMore: result.hasMore, nextCursor: result.nextCursor },
    },
  });
}

export async function unreadCount(req, res) {
  const count = await service.unreadCount(req.user.id);
  res.json({ success: true, data: { unreadCount: count } });
}

export async function markRead(req, res) {
  const { ids, all } = req.validated.body;
  const updated = await service.markRead({ userId: req.user.id, ids, all });
  res.json({ success: true, data: { updated } });
}

export async function getPreferences(req, res) {
  const row = await service.getPreferences(req.user.id);
  res.json({ success: true, data: { preferences: toPreferences(row) } });
}

export async function updatePreferences(req, res) {
  const { messagesMode, mentionsEnabled } = req.validated.body;
  const row = await service.updatePreferences({
    userId: req.user.id,
    messagesMode,
    mentionsEnabled,
  });
  res.json({ success: true, data: { preferences: toPreferences(row) } });
}