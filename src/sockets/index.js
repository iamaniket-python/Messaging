import { Server } from 'socket.io';
import { env } from '../config/env.js';
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