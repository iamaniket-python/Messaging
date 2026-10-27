const socketsByUser = new Map();

export const memoryPresenceStore = {
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

  async onlineUserIds(userIds) {
    return new Set(userIds.filter((id) => socketsByUser.has(id)));
  },
};

// Phase 7: yahan Redis implementation swap hogi
export const presenceStore = memoryPresenceStore;