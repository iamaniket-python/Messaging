import { registerEvent } from '../registerEvent.js';
import { presenceEventSchema } from '../validation.js';
import { presenceRoom } from '../rooms.js';
import * as presenceService from '../presence/presence.service.js';
import { AppError } from '../../utils/AppError.js';

const MAX_ROOMS_PER_SOCKET = 1000;

const normalize = (userIds) => [...new Set(userIds.map((id) => id.toLowerCase()))];

export function registerPresenceHandlers(socket) {
  registerEvent(socket, 'presence:subscribe', {
    schema: presenceEventSchema,
    handler: async (sock, { userIds }) => {
      if (sock.rooms.size > MAX_ROOMS_PER_SOCKET) {
        throw AppError.badRequest('Too many subscriptions', undefined, 'TOO_MANY_SUBSCRIPTIONS');
      }

      const requested = normalize(userIds);
      const allowed = await presenceService.filterVisibleUsers(sock.data.user.id, requested);

      await sock.join(allowed.map(presenceRoom));
      const statuses = await presenceService.getStatuses(allowed);

      return { statuses, ignored: requested.filter((id) => !allowed.includes(id)) };
    },
  });

  registerEvent(socket, 'presence:unsubscribe', {
    schema: presenceEventSchema,
    handler: async (sock, { userIds }) => {
      for (const id of normalize(userIds)) {
        await sock.leave(presenceRoom(id));
      }
    },
  });
}