import * as service from './attachments.service.js';
import { toAttachmentDetail } from './attachments.mapper.js';

export async function createUploadUrl(req, res) {
  const data = await service.createUploadUrl({ userId: req.user.id, ...req.validated.body });
  res.status(201).json({ success: true, data });
}

export async function complete(req, res) {
  const row = await service.completeUpload({
    attachmentId: req.validated.params.attachmentId,
    userId: req.user.id,
  });
  res.json({ success: true, data: { attachment: toAttachmentDetail(row) } });
}

export async function get(req, res) {
  const { row, downloadUrl, expiresIn } = await service.getAttachment({
    attachmentId: req.validated.params.attachmentId,
    userId: req.user.id,
  });
  res.json({
    success: true,
    data: { attachment: toAttachmentDetail(row), downloadUrl, expiresIn },
  });
}