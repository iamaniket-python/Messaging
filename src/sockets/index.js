import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { env } from '../config/env.js';
import { isRedisEnabled, createRedisConnection } from '../config/redis.js';
import { logger } from '../utils/logger.js';
import { setIO } from './io.js';
import { socketAuth } from './middleware/auth.js';
import { onConnection } from './handlers/connection.js';

export function initSocket(httpServer) {
  const io = new Server(httpServer, {
    cors: { origin: env.CORS_ORIGINS, credentials: true },
    maxHttpBufferSize: 100_000,
    pingInterval: 25_000,
    pingTimeout: 20_000,
  });

  if (isRedisEnabled) {
    const pubClient = createRedisConnection();
    const subClient = createRedisConnection();
    io.adapter(createAdapter(pubClient, subClient));
    logger.info('Socket.IO Redis adapter enabled');
  } else {
    logger.warn('REDIS_URL not set: Socket.IO running single-instance (in-memory adapter)');
  }

  io.use(socketAuth);

  io.on('connection', (socket) => {
    onConnection(socket).catch((err) => {
      logger.error({ err }, 'Connection handler failed');
      socket.disconnect(true);
    });
  });

  setIO(io);
  return io;
}