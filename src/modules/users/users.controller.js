import * as usersService from './users.service.js';
import { toOwnUser, toPublicUser } from './user.mapper.js';

export async function getMe(req, res) {
  const user = await usersService.getById(req.user.id);
  res.json({ success: true, data: { user: toOwnUser(user) } });
}

export async function updateMe(req, res) {
  const user = await usersService.updateProfile(req.user.id, req.validated.body);
  res.json({ success: true, data: { user: toOwnUser(user) } });
}

export async function changePassword(req, res) {
  await usersService.changePassword({
    userId: req.user.id,
    sessionId: req.user.sessionId,
    currentPassword: req.validated.body.currentPassword,
    newPassword: req.validated.body.newPassword,
  });
  res.status(204).end();
}

export async function getUserById(req, res) {
  const user = await usersService.getById(req.validated.params.userId);
  res.json({ success: true, data: { user: toPublicUser(user) } });
}

export async function updateUserRole(req, res) {
  const user = await usersService.updateRole(req.validated.params.userId, req.validated.body.role);
  res.json({ success: true, data: { user: toOwnUser(user) } });
}