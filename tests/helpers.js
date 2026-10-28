import request from 'supertest';
import app from '../src/app.js';
import { pool } from '../src/config/db.js';

export const hasTestDb = Boolean(process.env.TEST_DATABASE_URL);
export const api = (path) => `/api/v1${path}`;
export const bearer = (token) => ({ Authorization: `Bearer ${token}` });

function assertTestEnv() {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error('Refusing to wipe data outside the test environment');
  }
}

export async function resetDb() {
  assertTestEnv();
  await pool.query(
    'TRUNCATE users, sessions, conversations, conversation_members, messages, attachments RESTART IDENTITY CASCADE'
  );
}

export async function resetChatData() {
  assertTestEnv();
  await pool.query(
    'TRUNCATE conversations, conversation_members, messages, attachments RESTART IDENTITY CASCADE'
  );
}

let counter = 0;

export async function createUser(name) {
  counter += 1;
  const res = await request(app)
    .post(api('/auth/register'))
    .send({ name, email: `${name.toLowerCase()}${counter}@example.com`, password: 'StrongPass123!' });
  if (res.status !== 201) {
    throw new Error(`createUser failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return { id: res.body.data.user.id, token: res.body.data.accessToken, name };
}

export const as = (user) => ({
  get: (path) => request(app).get(api(path)).set(bearer(user.token)),
  post: (path, body = {}) => request(app).post(api(path)).set(bearer(user.token)).send(body),
  patch: (path, body = {}) => request(app).patch(api(path)).set(bearer(user.token)).send(body),
  delete: (path) => request(app).delete(api(path)).set(bearer(user.token)),
});

export async function createGroup(owner, members = [], name = 'Backend Team') {
  const res = await as(owner).post('/conversations', {
    type: 'group',
    name,
    memberIds: members.map((member) => member.id),
  });
  return res.body.data.conversation;
}

export const sendMessage = (user, conversationId, content = 'hello', extra = {}) =>
  as(user).post(`/conversations/${conversationId}/messages`, { content, ...extra });