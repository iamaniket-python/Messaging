import { randomUUID } from 'node:crypto';
import { io } from 'socket.io-client';

const [token, conversationId, text] = process.argv.slice(2);

if (!token) {
  console.error('Usage: node scripts/socket-client.js <accessToken> [conversationId] [message]');
  console.error('Env: SOCKET_URL, WATCH_USERS=id1,id2, AUTO_READ=1, TYPING=1');
  process.exit(1);
}

const socket = io(process.env.SOCKET_URL ?? 'http://localhost:5000', {
  auth: { token },
  transports: ['websocket'],
});

socket.on('connect_error', (err) => console.error('connect_error:', err.message, err.data));
socket.on('disconnect', (reason) => console.log('disconnected:', reason));

socket.on('session:ready', async (info) => {
  console.log('session:ready', JSON.stringify(info));

  if (process.env.WATCH_USERS) {
    const userIds = process.env.WATCH_USERS.split(',').map((id) => id.trim());
    const ack = await socket.emitWithAck('presence:subscribe', { userIds });
    console.log('presence:subscribe ack:', JSON.stringify(ack));
  }

  if (conversationId && process.env.TYPING === '1') {
    await socket.emitWithAck('typing:start', { conversationId });
    console.log('typing started');
  }

  if (conversationId && text) {
    const ack = await socket.emitWithAck('message:send', {
      conversationId,
      clientMessageId: randomUUID(),
      content: text,
    });
    console.log('ack:', JSON.stringify(ack));
  }
});

socket.on('message:new', async (payload) => {
  console.log('message:new', JSON.stringify(payload));
  const { conversationId: cid, id } = payload.message;

  const delivered = await socket.emitWithAck('message:delivered', { conversationId: cid, messageId: id });
  console.log('delivered ack:', JSON.stringify(delivered));

  if (process.env.AUTO_READ === '1') {
    const read = await socket.emitWithAck('message:read', { conversationId: cid, messageId: id });
    console.log('read ack:', JSON.stringify(read));
  }
});

for (const event of [
  'message:updated',
  'message:deleted',
  'message:delivered',
  'message:read',
  'typing:update',
  'presence:update',
  'conversation:new',
  'conversation:updated',
  'conversation:member_added',
  'conversation:member_removed',
  'conversation:member_role_changed',
]) {
  socket.on(event, (payload) => console.log(event, JSON.stringify(payload)));
}