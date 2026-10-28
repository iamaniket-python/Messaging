import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { env } from '../../config/env.js';
import { isRedisEnabled } from '../../config/redis.js';
import { logger } from '../../utils/logger.js';
import { emitToUser } from '../../sockets/realtime.js';
import { planRecipients, insertNotification } from './notifications.service.js';
import { toNotification } from './notifications.mapper.js';

const QUEUE_NAME = 'notifications';

// Tests hamesha in-process chalte hain (Redis/BullMQ ki zaroorat nahi).
const useQueue = isRedisEnabled && env.NODE_ENV !== 'test';

let queue = null;
let worker = null;
const connections = [];
const pending = new Set();

function makeConnection(options) {
  const connection = new IORedis(env.REDIS_URL, options);
  connection.on('error', (err) => logger.warn({ err }, 'Notification Redis connection error'));
  connections.push(connection);
  return connection;
}

function getQueue() {
  if (!useQueue) return null;
  if (!queue) {
    queue = new Queue(QUEUE_NAME, {
      connection: makeConnection({ maxRetriesPerRequest: 2 }),
      defaultJobOptions: {
        attempts: env.NOTIFICATION_JOB_ATTEMPTS,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: { age: 3600, count: 1000 },
        removeOnFail: { age: 86400 },
      },
    });
    queue.on('error', (err) => logger.warn({ err }, 'Notification queue error'));
  }
  return queue;
}

function track(promise) {
  pending.add(promise);
  promise.finally(() => pending.delete(promise));
  return promise;
}

// Worker / in-process dono yahi function chalate hain. Idempotent hai (ON CONFLICT DO NOTHING).
export async function processNotificationJob(data) {
  const row = await insertNotification(data);
  if (!row) return null;
  emitToUser(data.userId, 'notification:new', { notification: toNotification(row) });
  return row;
}

async function dispatch(data) {
  const q = getQueue();
  if (q) {
    try {
      // jobId = "{type}:{messageId}:{userId}" (3 parts, BullMQ ke custom id rule ke andar)
      await q.add(data.type, data, { jobId: `${data.type}:${data.messageId}:${data.userId}` });
      return;
    } catch (err) {
      logger.warn({ err }, 'Queue add failed, processing notification in-process');
    }
  }
  await processNotificationJob(data);
}

/**
 * Fire-and-forget: message send response ko block nahi karta, aur kabhi throw nahi karta.
 * Note: in-process mode mein retry nahi hai; optional cleanup/retry sweep Phase 9 mein.
 */
export function enqueueMessageNotifications(message) {
  if (!message || message.type === 'system') return;

  track(
    (async () => {
      try {
        const jobs = await planRecipients(message);
        await Promise.all(
          jobs.map((job) =>
            dispatch(job).catch((err) => logger.error({ err, job }, 'Notification dispatch failed'))
          )
        );
      } catch (err) {
        logger.error({ err, messageId: message.id }, 'Notification planning failed');
      }
    })()
  );
}

export function startNotificationWorker() {
  if (!useQueue || worker) return;

  worker = new Worker(QUEUE_NAME, async (job) => processNotificationJob(job.data), {
    connection: makeConnection({ maxRetriesPerRequest: null }),
    concurrency: env.NOTIFICATION_WORKER_CONCURRENCY,
  });
  worker.on('failed', (job, err) => {
    logger.warn({ jobId: job?.id, err }, 'Notification job failed');
  });
  worker.on('error', (err) => logger.warn({ err }, 'Notification worker error'));
  logger.info('Notification worker started');
}

export async function flushNotificationJobs() {
  while (pending.size > 0) {
    await Promise.allSettled([...pending]);
  }
}

export async function closeNotificationQueue() {
  await flushNotificationJobs();
  try {
    await worker?.close();
    await queue?.close();
  } catch (err) {
    logger.warn({ err }, 'Error closing notification queue');
  }
  worker = null;
  queue = null;
  await Promise.allSettled(connections.map((connection) => connection.quit()));
  connections.length = 0;
}