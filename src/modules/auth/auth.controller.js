import * as authService from './auth.service.js';
import { toOwnUser } from '../users/user.mapper.js';

const clientMeta = (req) => ({
  userAgent: (req.get('user-agent') ?? '').slice(0, 255) || null,
  ip: req.ip ?? null,
});

export async function register(req, res) {
  const { user, accessToken, refreshToken } = await authService.register(req.validated.body, clientMeta(req));
  res.status(201).json({ success: true, data: { user: toOwnUser(user), accessToken, refreshToken } });
}

export async function login(req, res) {
  const { user, accessToken, refreshToken } = await authService.login(req.validated.body, clientMeta(req));
  res.json({ success: true, data: { user: toOwnUser(user), accessToken, refreshToken } });
}

export async function refresh(req, res) {
  const { accessToken, refreshToken } = await authService.refresh(
    req.validated.body.refreshToken,
    clientMeta(req)
  );
  res.json({ success: true, data: { accessToken, refreshToken } });
}

export async function logout(req, res) {
  await authService.logout(req.validated.body.refreshToken);
  res.status(204).end();
}

export async function logoutAll(req, res) {
  await authService.logoutAll(req.user.id);
  res.status(204).end();
}