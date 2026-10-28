import { randomUUID } from 'node:crypto';
import { io } from 'socket.io-client';

const BASE = process.env.BASE_URL ?? 'http://localhost:5000';
const SENDERS = Number(process.env.SENDERS ?? 10); // sender user ke sockets (har ka apna token bucket)
const RECEIVERS = Number(process.env.RECEIVERS ?? 5);
const MSGS_PER_SOCKET = Number(process.env.MSGS_PER_SOCKET ?? 15); // bucket capacity (20) ke andar

async function api(path, body, token) {
  const res = await fetch(`${BASE}/api/v1${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token && { authorization: `Bearer ${token}` }) },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`${path}: ${res.status} ${JSON.stringify(json)}`);
  return json.data;
}

const stamp = Date.now();
const register = (name) =>
  api('/auth/register', { name, email: `${name}${stamp}@example.com`, password: 'StrongPass123!' });

const sender = await register('sockload-sender');
const receiver = await register('sockload-receiver');
const group = await api(
  '/conversations',
  { type: 'group', name: `SockLoad ${stamp}`, memberIds: [receiver.user.id] },
  sender.accessToken
);
const conversationId = group.conversation.id;

async function connect(token) {
  const socket = io(BASE, { transports: ['websocket'], forceNew: true, reconnection: false, auth: { token } });
  await new Promise((resolve, reject) => {
    socket.once('session:ready', resolve);
    socket.once('connect_error', reject);
  });
  return socket;
}

const senders = await Promise.all(Array.from({ length: SENDERS }, () => connect(sender.accessToken)));
const receivers = await Promise.all(Array.from({ length: RECEIVERS }, () => connect(receiver.accessToken)));

const received = receivers.map(() => 0);
receivers.forEach((socket, i) => socket.on('message:new', () => (received[i] += 1)));

const percentile = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
const latencies = [];
const errorCodes = {};
let ok = 0;

const startedAt = Date.now();
await Promise.all(
  senders.flatMap((socket) =>
    Array.from({ length: MSGS_PER_SOCKET }, async () => {
      const t0 = performance.now();
      try {
        const ack = await socket.timeout(15000).emitWithAck('message:send', {
          conversationId,
          clientMessageId: randomUUID(),
          content: 'socket burst',
        });
        latencies.push(performance.now() - t0);
        if (ack.ok) ok += 1;
        else errorCodes[ack.error.code] = (errorCodes[ack.error.code] ?? 0) + 1;
      } catch {
        errorCodes.TIMEOUT = (errorCodes.TIMEOUT ?? 0) + 1;
      }
    })
  )
);
const elapsedMs = Date.now() - startedAt;

await new Promise((resolve) => setTimeout(resolve, 1500));

latencies.sort((a, b) => a - b);
console.log({
  sent: SENDERS * MSGS_PER_SOCKET,
  acksOk: ok,
  errorCodes,
  elapsedMs,
  ackLatencyMs: latencies.length
    ? { p50: percentile(latencies, 50).toFixed(1), p95: percentile(latencies, 95).toFixed(1), max: latencies.at(-1).toFixed(1) }
    : null,
  expectedPerReceiver: ok,
  receivedPerReceiver: received,
});
console.log('Note: SOCKET_MESSAGE_LIMIT_PER_MIN (default 120/user) se zyada ho to server env mein badha ke chalao.');

[...senders, ...receivers].forEach((socket) => socket.disconnect());
process.exit(0);