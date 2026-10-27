import http from 'node:http';
import app from './app.js';
import { env } from './config/env.js';
import { logger } from './utils/logger.js';
import { checkDb, closeDb } from './config/db.js';
import { closeRedis } from './config/redis.js';
import { initSocket } from './sockets/index.js';
import { stopPresenceTasks } from './sockets/presence/presence.service.js';

const server = http.createServer(app);
const io = initSocket(server);

let shuttingDown = false;

async function shutdown(signal, exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'Shutting down gracefully');

  const forceExit = setTimeout(() => {
    logger.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10_000);
  forceExit.unref();

  io.close(async () => {
    try {
      stopPresenceTasks();
      await closeRedis();
      await closeDb();
      logger.info('Shutdown complete');
      process.exit(exitCode);
    } catch (err) {
      logger.error({ err }, 'Error during shutdown');
      process.exit(1);
    }
  });
  server.closeIdleConnections?.();
}

async function start() {
  try {
    await checkDb();
    server.listen(env.PORT, () => {
      logger.info(`Server running on port ${env.PORT} (${env.NODE_ENV})`);
    });
  } catch (err) {
    logger.error({ err }, 'Failed to start server');
    process.exit(1);
  }
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (reason) => {
  logger.error({ err: reason }, 'Unhandled promise rejection');
  shutdown('unhandledRejection', 1);
});
process.on('uncaughtException', (err) => {
  logger.error({ err }, 'Uncaught exception');
  shutdown('uncaughtException', 1);
});

start();