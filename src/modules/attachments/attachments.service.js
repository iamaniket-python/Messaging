import { randomUUID } from 'node:crypto';
import { pool, query } from '../../config/db.js';
import { env } from '../../config/env.js';
import { AppError } from '../../utils/AppError.js';
import { logger } from '../../utils/logger.js';
import { getStorage } from '../../services/storage.js';
import { requireMembership } from '../conversations/conversations.service.js';

export const ALLOWED_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'application/pdf',
  'text/plain',
  'text/csv',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);

const attachmentNotFound = () => AppError.notFound('Attachment not found', 'ATTACHMENT_NOT_FOUND');

// Display name: path hata do, control chars hata do (unicode allowed)
export function cleanDisplayName(fileName) {
  const base = fileName.split(/[\\/]/).pop() ?? '';
  // eslint-disable-next-line no-control-regex
  const cleaned = base.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 255);
  return cleaned || 'file';
}

// Storage key ke liye strictly ASCII safe name
export function sanitizeFileName(fileName) {
  let name = cleanDisplayName(fileName)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/^[._]+/, '');

  if (name.length > 100) {
    const dot = name.lastIndexOf('.');
    const ext = dot > 0 && name.length - dot <= 10 ? name.slice(dot) : '';
    name = name.slice(0, 100 - ext.length) + ext;
  }
  return name || 'file';
}

async function loadForMember(attachmentId, userId) {
  const { rows } = await query(
    `SELECT a.*, m.deleted_at AS message_deleted_at
       FROM attachments a
       JOIN conversation_members cm
         ON cm.conversation_id = a.conversation_id AND cm.user_id = $2
       LEFT JOIN messages m ON m.id = a.message_id
      WHERE a.id = $1`,
    [attachmentId, userId]
  );
  if (!rows[0]) throw attachmentNotFound();
  return rows[0];
}

async function discardPending(row) {
  await query("DELETE FROM attachments WHERE id = $1 AND status = 'pending'", [row.id]);
  try {
    await getStorage().deleteObject(row.storage_key);
  } catch (err) {
    logger.warn({ err, attachmentId: row.id }, 'Failed to delete rejected upload');
  }
}

export async function createUploadUrl({ userId, conversationId, fileName, mimeType, sizeBytes }) {
  await requireMembership(pool, conversationId, userId);

  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    throw AppError.badRequest('This file type is not allowed', undefined, 'UNSUPPORTED_FILE_TYPE');
  }
  if (sizeBytes > env.UPLOAD_MAX_BYTES) {
    throw new AppError(413, 'FILE_TOO_LARGE', `File exceeds the ${env.UPLOAD_MAX_BYTES} byte limit`);
  }

  const attachmentId = randomUUID();
  const storageKey = `conversations/${conversationId}/${attachmentId}/${sanitizeFileName(fileName)}`;
  const expiresIn = env.UPLOAD_URL_TTL_SECONDS;

  // Pehle presign (503 yahin se aayega agar storage configured nahi), phir row insert
  const { url, headers } = await getStorage().createUploadUrl({
    key: storageKey,
    mimeType,
    sizeBytes,
    expiresIn,
  });

  await query(
    `INSERT INTO attachments (id, uploader_id, conversation_id, storage_key, original_name, mime_type, size_bytes)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [attachmentId, userId, conversationId, storageKey, cleanDisplayName(fileName), mimeType, sizeBytes]
  );

  return { attachmentId, uploadUrl: url, headers, expiresIn };
}

export async function completeUpload({ attachmentId, userId }) {
  const row = await loadForMember(attachmentId, userId);

  if (row.uploader_id !== userId) {
    throw AppError.forbidden('Only the uploader can complete this upload', 'INSUFFICIENT_PERMISSIONS');
  }
  if (row.status === 'ready') return row;

  const head = await getStorage().headObject(row.storage_key);
  if (!head) {
    throw AppError.badRequest('File has not been uploaded yet', undefined, 'UPLOAD_NOT_FOUND');
  }

  if (Number(head.size) !== Number(row.size_bytes)) {
    await discardPending(row);
    throw AppError.badRequest('Uploaded file size does not match', undefined, 'UPLOAD_SIZE_MISMATCH');
  }

  const actualType = head.contentType ? head.contentType.split(';')[0].trim().toLowerCase() : null;
  if (actualType && actualType !== row.mime_type) {
    await discardPending(row);
    throw AppError.badRequest('Uploaded file type does not match', undefined, 'UPLOAD_TYPE_MISMATCH');
  }

  const { rows } = await query(
    "UPDATE attachments SET status = 'ready' WHERE id = $1 RETURNING *",
    [attachmentId]
  );
  return rows[0];
}

export async function getAttachment({ attachmentId, userId }) {
  const row = await loadForMember(attachmentId, userId);
  const isUploader = row.uploader_id === userId;

  if (row.message_deleted_at) throw attachmentNotFound();
  // Message se attach hone se pehle sirf uploader dekh sakta hai
  if (!row.message_id && !isUploader) throw attachmentNotFound();
  if (row.status !== 'ready') {
    if (!isUploader) throw attachmentNotFound();
    throw new AppError(409, 'ATTACHMENT_NOT_READY', 'Upload has not been completed yet');
  }

  const expiresIn = env.UPLOAD_URL_TTL_SECONDS;
  const downloadUrl = await getStorage().createDownloadUrl({
    key: row.storage_key,
    fileName: row.original_name,
    mimeType: row.mime_type,
    expiresIn,
  });

  return { row, downloadUrl, expiresIn };
}