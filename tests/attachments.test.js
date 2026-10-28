import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { io as connect } from 'socket.io-client';
import app from '../src/app.js';
import { pool } from '../src/config/db.js';
import { runMigrations } from '../src/db/migrate.js';
import { initSocket } from '../src/sockets/index.js';
import { stopPresenceTasks } from '../src/sockets/presence/presence.service.js';
import { setStorage, createUnconfiguredStorage } from '../src/services/storage.js';
import {
  hasTestDb,
  api,
  as,
  resetDb,
  resetChatData,
  createUser,
  createGroup,
  sendMessage,
} from './helpers.js';
import { createFakeStorage } from './fakeStorage.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const PNG = 'image/png';

describe.skipIf(!hasTestDb)('attachments', () => {
  const fake = createFakeStorage();
  let alice;
  let bob;
  let carol;
  let group;

  const requestUpload = (user, conversationId, overrides = {}) =>
    as(user).post('/attachments/upload-url', {
      conversationId,
      fileName: 'photo.png',
      mimeType: PNG,
      sizeBytes: 2048,
      ...overrides,
    });

  async function putObject(attachmentId, overrides = {}) {
    const { rows } = await pool.query(
      'SELECT storage_key, size_bytes, mime_type FROM attachments WHERE id = $1',
      [attachmentId]
    );
    fake.simulateUpload(rows[0].storage_key, {
      size: Number(rows[0].size_bytes),
      contentType: rows[0].mime_type,
      ...overrides,
    });
  }

  async function createReadyAttachment(user, conversationId, overrides = {}) {
    const res = await requestUpload(user, conversationId, overrides);
    expect(res.status).toBe(201);
    const id = res.body.data.attachmentId;
    await putObject(id);
    const done = await as(user).post(`/attachments/${id}/complete`);
    expect(done.status).toBe(200);
    return id;
  }

  beforeAll(async () => {
    await runMigrations();
    await resetDb();
    alice = await createUser('Alice');
    bob = await createUser('Bob');
    carol = await createUser('Carol');
  });

  beforeEach(async () => {
    await resetChatData();
    fake.objects.clear();
    setStorage(fake);
    group = await createGroup(alice, [bob], 'Files Team');
  });

  afterAll(async () => {
    await pool.end();
  });

  describe('POST /attachments/upload-url', () => {
    it('returns presigned data and stores a pending row with a sanitized key', async () => {
      const res = await requestUpload(alice, group.id, { fileName: '../../Évil name?.PNG' });

      expect(res.status).toBe(201);
      const { attachmentId, uploadUrl, headers, expiresIn } = res.body.data;
      expect(uploadUrl).toContain('fake-storage.test');
      expect(headers['Content-Type']).toBe(PNG);
      expect(typeof expiresIn).toBe('number');

      const { rows } = await pool.query('SELECT * FROM attachments WHERE id = $1', [attachmentId]);
      const prefix = `conversations/${group.id}/${attachmentId}/`;
      expect(rows[0].status).toBe('pending');
      expect(rows[0].storage_key.startsWith(prefix)).toBe(true);
      expect(rows[0].storage_key.slice(prefix.length)).toMatch(/^[A-Za-z0-9._-]+$/);
      expect(rows[0].original_name).toBe('Évil name?.PNG');
    });

    it('rejects requests without a token', async () => {
      const res = await request(app)
        .post(api('/attachments/upload-url'))
        .send({ conversationId: group.id, fileName: 'a.png', mimeType: PNG, sizeBytes: 10 });
      expect(res.status).toBe(401);
    });

    it('returns 404 for non-members', async () => {
      const res = await requestUpload(carol, group.id);
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('CONVERSATION_NOT_FOUND');
    });

    it('rejects unsupported file types', async () => {
      const res = await requestUpload(alice, group.id, { mimeType: 'application/x-msdownload' });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('UNSUPPORTED_FILE_TYPE');
    });

    it('rejects files over the size limit', async () => {
      const res = await requestUpload(alice, group.id, { sizeBytes: 5 * 1024 * 1024 + 1 });
      expect(res.status).toBe(413);
      expect(res.body.error.code).toBe('FILE_TOO_LARGE');
    });

    it('returns 503 when storage is not configured', async () => {
      setStorage(createUnconfiguredStorage());
      const res = await requestUpload(alice, group.id);
      expect(res.status).toBe(503);
      expect(res.body.error.code).toBe('STORAGE_NOT_CONFIGURED');
    });
  });

  describe('POST /attachments/:id/complete', () => {
    it('fails when the object was never uploaded', async () => {
      const up = await requestUpload(alice, group.id);
      const res = await as(alice).post(`/attachments/${up.body.data.attachmentId}/complete`);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('UPLOAD_NOT_FOUND');
    });

    it('rejects a size mismatch and removes the pending row', async () => {
      const up = await requestUpload(alice, group.id);
      const id = up.body.data.attachmentId;
      await putObject(id, { size: 1 });

      const res = await as(alice).post(`/attachments/${id}/complete`);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('UPLOAD_SIZE_MISMATCH');

      const { rowCount } = await pool.query('SELECT 1 FROM attachments WHERE id = $1', [id]);
      expect(rowCount).toBe(0);
      expect(fake.objects.size).toBe(0);
    });

    it('marks the attachment ready and is idempotent', async () => {
      const id = await createReadyAttachment(alice, group.id);

      const again = await as(alice).post(`/attachments/${id}/complete`);
      expect(again.status).toBe(200);
      expect(again.body.data.attachment.status).toBe('ready');
    });

    it('returns 403 when another member tries to complete it', async () => {
      const up = await requestUpload(alice, group.id);
      const id = up.body.data.attachmentId;
      await putObject(id);

      const res = await as(bob).post(`/attachments/${id}/complete`);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('INSUFFICIENT_PERMISSIONS');
    });
  });

  describe('GET /attachments/:id', () => {
    it('is visible only to the uploader until it is attached to a message', async () => {
      const id = await createReadyAttachment(alice, group.id);

      const mine = await as(alice).get(`/attachments/${id}`);
      expect(mine.status).toBe(200);
      expect(mine.body.data.downloadUrl).toContain('fake-storage.test/download');

      const theirs = await as(bob).get(`/attachments/${id}`);
      expect(theirs.status).toBe(404);
      expect(theirs.body.error.code).toBe('ATTACHMENT_NOT_FOUND');
    });

    it('gives members a download URL after sending, hides it from non-members and never leaks keys', async () => {
      const id = await createReadyAttachment(alice, group.id);
      const sent = await sendMessage(alice, group.id, '', { attachmentIds: [id] });
      expect(sent.status).toBe(201);

      const res = await as(bob).get(`/attachments/${id}`);
      expect(res.status).toBe(200);
      expect(Object.keys(res.body.data.attachment).sort()).toEqual(
        ['conversationId', 'createdAt', 'id', 'messageId', 'mimeType', 'name', 'sizeBytes', 'status', 'uploaderId'].sort()
      );
      expect(JSON.stringify(res.body.data.attachment)).not.toContain('conversations/');

      const outsider = await as(carol).get(`/attachments/${id}`);
      expect(outsider.status).toBe(404);
    });

    it('returns 404 once the message is deleted', async () => {
      const id = await createReadyAttachment(alice, group.id);
      const sent = await sendMessage(alice, group.id, '', { attachmentIds: [id] });

      const del = await as(alice).delete(`/messages/${sent.body.data.message.id}`);
      expect(del.status).toBe(204);

      const res = await as(bob).get(`/attachments/${id}`);
      expect(res.status).toBe(404);
    });
  });

  describe('messages with attachments', () => {
    it('sends a file message and lists it with attachments', async () => {
      const id = await createReadyAttachment(alice, group.id);
      const res = await sendMessage(alice, group.id, '', { attachmentIds: [id] });

      expect(res.status).toBe(201);
      const { message } = res.body.data;
      expect(message.type).toBe('file');
      expect(message.content).toBe('');
      expect(message.attachments).toEqual([
        { id, name: 'photo.png', mimeType: PNG, sizeBytes: 2048 },
      ]);

      const list = await as(bob).get(`/conversations/${group.id}/messages`);
      expect(list.status).toBe(200);
      expect(list.body.data.messages[0].attachments).toHaveLength(1);
    });

    it('rejects pending, foreign, cross-conversation and unknown attachments', async () => {
      const other = await createGroup(alice, [bob], 'Other Team');

      const pending = (await requestUpload(alice, group.id)).body.data.attachmentId;
      const foreign = await createReadyAttachment(bob, group.id);
      const crossConversation = await createReadyAttachment(alice, other.id);

      for (const attachmentId of [pending, foreign, crossConversation, randomUUID()]) {
        const res = await sendMessage(alice, group.id, '', { attachmentIds: [attachmentId] });
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('INVALID_ATTACHMENTS');
      }
    });

    it('does not allow reusing an attachment in a second message', async () => {
      const id = await createReadyAttachment(alice, group.id);
      const first = await sendMessage(alice, group.id, '', { attachmentIds: [id] });
      expect(first.status).toBe(201);

      const second = await sendMessage(alice, group.id, 'again', {
        attachmentIds: [id],
        clientMessageId: randomUUID(),
      });
      expect(second.status).toBe(400);
      expect(second.body.error.code).toBe('INVALID_ATTACHMENTS');
    });

    it('validates content or attachments and the 5 attachment cap', async () => {
      const empty = await sendMessage(alice, group.id, '');
      expect(empty.status).toBe(400);
      expect(empty.body.error.code).toBe('VALIDATION_ERROR');

      const tooMany = await sendMessage(alice, group.id, '', {
        attachmentIds: Array.from({ length: 6 }, () => randomUUID()),
      });
      expect(tooMany.status).toBe(400);
      expect(tooMany.body.error.code).toBe('VALIDATION_ERROR');

      const badId = await sendMessage(alice, group.id, '', { attachmentIds: ['nope'] });
      expect(badId.status).toBe(400);
    });

    it('returns the existing message with attachments on duplicate retry', async () => {
      const id = await createReadyAttachment(alice, group.id);
      const clientMessageId = randomUUID();
      const body = { attachmentIds: [id], clientMessageId };

      const first = await sendMessage(alice, group.id, '', body);
      const retry = await sendMessage(alice, group.id, '', body);

      expect(first.status).toBe(201);
      expect(retry.status).toBe(200);
      expect(retry.body.data.message.id).toBe(first.body.data.message.id);
      expect(retry.body.data.message.attachments).toHaveLength(1);

      const { rows } = await pool.query(
        'SELECT count(*)::int AS n FROM messages WHERE conversation_id = $1',
        [group.id]
      );
      expect(rows[0].n).toBe(1);
    });

    it('keeps attachments empty for plain text messages', async () => {
      const res = await sendMessage(alice, group.id, 'sirf text');
      expect(res.status).toBe(201);
      expect(res.body.data.message.type).toBe('text');
      expect(res.body.data.message.attachments).toEqual([]);
    });
  });

  describe('socket message:send', () => {
    it('accepts attachmentIds and broadcasts attachments', async () => {
      const attachmentId = await createReadyAttachment(alice, group.id);

      const httpServer = http.createServer(app);
      const io = initSocket(httpServer);
      await new Promise((resolve) => httpServer.listen(0, resolve));
      const url = `http://localhost:${httpServer.address().port}`;
      const clients = [];

      const connectClient = (token) =>
        new Promise((resolve, reject) => {
          const socket = connect(url, {
            transports: ['websocket'],
            forceNew: true,
            reconnection: false,
            auth: { token },
          });
          clients.push(socket);
          socket.once('session:ready', () => resolve(socket));
          socket.once('connect_error', reject);
        });

      try {
        const aliceSocket = await connectClient(alice.token);
        const bobSocket = await connectClient(bob.token);

        const received = [];
        bobSocket.on('message:new', (payload) => received.push(payload));

        const ack = await aliceSocket.timeout(15000).emitWithAck('message:send', {
          conversationId: group.id,
          clientMessageId: randomUUID(),
          attachmentIds: [attachmentId],
        });

        expect(ack.ok).toBe(true);
        expect(ack.data.duplicate).toBe(false);
        expect(ack.data.message.type).toBe('file');
        expect(ack.data.message.attachments[0].id).toBe(attachmentId);

        await sleep(300);
        expect(received).toHaveLength(1);
        expect(received[0].message.attachments).toEqual([
          { id: attachmentId, name: 'photo.png', mimeType: PNG, sizeBytes: 2048 },
        ]);
      } finally {
        for (const socket of clients) socket.disconnect();
        await sleep(400);
        stopPresenceTasks();
        await new Promise((resolve) => io.close(resolve));
      }
    });
  });
});