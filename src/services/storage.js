import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from '../config/env.js';
import { AppError } from '../utils/AppError.js';
import { logger } from '../utils/logger.js';

/**
 * Storage interface:
 *   isConfigured: boolean
 *   createUploadUrl({ key, mimeType, sizeBytes, expiresIn }) -> { url, headers }
 *   createDownloadUrl({ key, fileName, mimeType, expiresIn }) -> string
 *   headObject(key) -> { size, contentType } | null
 *   deleteObject(key) -> void
 */

const INLINE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

const notConfigured = () =>
  new AppError(503, 'STORAGE_NOT_CONFIGURED', 'File storage is not configured');

const storageFailure = (err, op) => {
  logger.error({ err, op }, 'Storage request failed');
  return new AppError(502, 'STORAGE_ERROR', 'Storage request failed');
};

const encodeRfc5987 = (value) =>
  encodeURIComponent(value).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`
  );

export function createUnconfiguredStorage() {
  const fail = async () => {
    throw notConfigured();
  };
  return {
    isConfigured: false,
    createUploadUrl: fail,
    createDownloadUrl: fail,
    headObject: fail,
    deleteObject: fail,
  };
}

export function createS3Storage() {
  const client = new S3Client({
    region: env.S3_REGION,
    ...(env.S3_ENDPOINT && { endpoint: env.S3_ENDPOINT }),
    forcePathStyle: env.S3_FORCE_PATH_STYLE,
    credentials: {
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    },
    // Presigned PUT ke saath default checksum headers problem karte hain (R2/MinIO/S3 sab par)
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });
  const Bucket = env.S3_BUCKET;

  return {
    isConfigured: true,

    async createUploadUrl({ key, mimeType, sizeBytes, expiresIn }) {
      try {
        // ContentLength sign hota hai, so S3 galat size ka upload reject kar deta hai.
        // /complete step phir bhi HEAD se size aur type dobara verify karta hai.
        const command = new PutObjectCommand({
          Bucket,
          Key: key,
          ContentType: mimeType,
          ContentLength: sizeBytes,
        });
        const url = await getSignedUrl(client, command, { expiresIn });
        return { url, headers: { 'Content-Type': mimeType } };
      } catch (err) {
        throw storageFailure(err, 'createUploadUrl');
      }
    },

    async createDownloadUrl({ key, fileName, mimeType, expiresIn }) {
      try {
        const disposition = INLINE_TYPES.has(mimeType) ? 'inline' : 'attachment';
        const command = new GetObjectCommand({
          Bucket,
          Key: key,
          ResponseContentType: mimeType,
          ResponseContentDisposition: `${disposition}; filename*=UTF-8''${encodeRfc5987(fileName)}`,
        });
        return await getSignedUrl(client, command, { expiresIn });
      } catch (err) {
        throw storageFailure(err, 'createDownloadUrl');
      }
    },

    async headObject(key) {
      try {
        const out = await client.send(new HeadObjectCommand({ Bucket, Key: key }));
        return { size: out.ContentLength, contentType: out.ContentType };
      } catch (err) {
        if (err?.name === 'NotFound' || err?.$metadata?.httpStatusCode === 404) return null;
        throw storageFailure(err, 'headObject');
      }
    },

    async deleteObject(key) {
      try {
        await client.send(new DeleteObjectCommand({ Bucket, Key: key }));
      } catch (err) {
        throw storageFailure(err, 'deleteObject');
      }
    },
  };
}

const isS3Configured = () =>
  Boolean(env.S3_BUCKET && env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY);

let current = isS3Configured() ? createS3Storage() : createUnconfiguredStorage();

if (!current.isConfigured) {
  logger.warn('S3 not configured: file sharing endpoints will return 503 STORAGE_NOT_CONFIGURED');
}

export const getStorage = () => current;

// Tests yahan fake storage inject karte hain
export const setStorage = (storage) => {
  current = storage;
};