import { randomUUID } from 'node:crypto';
import { io } from 'socket.io-client';

const [token, conversationId, text] = process.argv.slice(2);

if (!token) {
  console.error('Usage: node scripts/socket-client.js <accessToken> [conversationId] [message]');
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

  if (conversationId && text) {
    const ack = await socket.emitWithAck('message:send', {
      conversationId,
      clientMessageId: randomUUID(),
      content: text,
    });
    console.log('ack:', JSON.stringify(ack));
  }
});

for (const event of [
  'message:new',
  'message:updated',
  'message:deleted',
  'conversation:new',
  'conversation:updated',
  'conversation:member_added',
  'conversation:member_removed',
  'conversation:member_role_changed',
]) {
  socket.on(event, (payload) => console.log(event, JSON.stringify(payload)));
}