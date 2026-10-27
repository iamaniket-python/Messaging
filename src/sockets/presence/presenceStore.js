import { redis } from '../../config/redis.js';
import { env } from '../../config/env.js';

const PREFIX = 'chat:presence';
const ONLINE_KEY = `${PREFIX}:online`;
const socketsKey = (userId) => `${PREFIX}:sockets:${userId}`;
const graceKey = (userId) => `${PREFIX}:grace:${userId}`;

export function createMemoryPresenceStore() {
  const socketsByUser = new Map();
  const onlineUsers = new Set();
  const graceUntil = new Map();

  return {
    async add(userId, socketId) {
      let sockets = socketsByUser.get(userId);
      if (!sockets) {
        sockets = new Set();
        socketsByUser.set(userId, sockets);
      }
      sockets.add(socketId);
      return sockets.size;
    },

    async remove(userId, socketId) {
      const sockets = socketsByUser.get(userId);
      if (!sockets) return 0;
      sockets.delete(socketId);
      if (sockets.size === 0) socketsByUser.delete(userId);
      return sockets.size;
    },

    async count(userId) {
      return socketsByUser.get(userId)?.size ?? 0;
    },

    async touchMany(entries) {
      for (const { userId } of entries) onlineUsers.add(userId);
    },

    async markOnline(userId) {
      if (onlineUsers.has(userId)) return false;
      onlineUsers.add(userId);
      return true;
    },

    async claimOffline(userId) {
      return onlineUsers.delete(userId);
    },

    async onlineUserIds(userIds) {
      return new Set(userIds.filter((id) => onlineUsers.has(id)));
    },

    async setGrace(userId, ms) {
      graceUntil.set(userId, Date.now() + ms);
    },

    async findStaleOnlineUsers() {
      const now = Date.now();
      return [...onlineUsers].filter((id) => !socketsByUser.has(id) && (graceUntil.get(id) ?? 0) <= now);
    },
  };
}

export function createRedisPresenceStore(client) {
  const ttl = env.PRESENCE_SOCKET_TTL_MS;

  const exec = async (pipeline) => {
    const results = await pipeline.exec();
    return results.map(([err, value]) => {
      if (err) throw err;
      return value;
    });
  };

  return {
    async add(userId, socketId) {
      const key = socketsKey(userId);
      const now = Date.now();
      const results = await exec(
        client
          .pipeline()
          .zadd(key, now + ttl, socketId)
          .zremrangebyscore(key, '-inf', now)
          .pexpire(key, ttl * 3)
          .zcount(key, now, '+inf')
      );
      return results[3];
    },

    async remove(userId, socketId) {
      const key = socketsKey(userId);
      const results = await exec(client.pipeline().zrem(key, socketId).zcount(key, Date.now(), '+inf'));
      return results[1];
    },

    async count(userId) {
      return client.zcount(socketsKey(userId), Date.now(), '+inf');
    },

    async touchMany(entries) {
      if (entries.length === 0) return;
      const now = Date.now();
      const pipeline = client.pipeline();
      for (const { userId, socketId } of entries) {
        pipeline.zadd(socketsKey(userId), now + ttl, socketId);
        pipeline.pexpire(socketsKey(userId), ttl * 3);
        pipeline.sadd(ONLINE_KEY, userId);
      }
      await exec(pipeline);
    },

    async markOnline(userId) {
      return (await client.sadd(ONLINE_KEY, userId)) === 1;
    },

    async claimOffline(userId) {
      return (await client.srem(ONLINE_KEY, userId)) === 1;
    },

    async onlineUserIds(userIds) {
      if (userIds.length === 0) return new Set();
      const pipeline = client.pipeline();
      for (const id of userIds) pipeline.sismember(ONLINE_KEY, id);
      const results = await exec(pipeline);
      return new Set(userIds.filter((_, index) => results[index] === 1));
    },

    async setGrace(userId, ms) {
      await client.set(graceKey(userId), '1', 'PX', ms);
    },

    async findStaleOnlineUsers() {
      const members = await client.smembers(ONLINE_KEY);
      if (members.length === 0) return [];

      const now = Date.now();
      const pipeline = client.pipeline();
      for (const id of members) {
        pipeline.zcount(socketsKey(id), now, '+inf');
        pipeline.exists(graceKey(id));
      }
      const results = await exec(pipeline);

      return members.filter((_, index) => results[index * 2] === 0 && results[index * 2 + 1] === 0);
    },
  };
}

export const presenceStore = redis ? createRedisPresenceStore(redis) : createMemoryPresenceStore();