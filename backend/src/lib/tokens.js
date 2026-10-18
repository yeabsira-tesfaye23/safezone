import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { query } from '../db.js';
import { randomToken, sha256 } from './crypto.js';

export const REFRESH_COOKIE = 'sz_refresh';

export function signAccessToken(user) {
  return jwt.sign({ role: user.role }, config.jwtSecret, {
    subject: user.id,
    expiresIn: `${config.accessTokenMinutes}m`,
    issuer: 'safezone',
    algorithm: 'HS256',
  });
}

export function verifyAccessToken(token) {
  return jwt.verify(token, config.jwtSecret, { issuer: 'safezone', algorithms: ['HS256'] });
}

// Refresh tokens are random strings; only their SHA-256 hash is stored, so a database leak cannot be replayed.
export async function issueRefreshToken(userId, deviceHash) {
  const token = randomToken();
  await query(
    `INSERT INTO refresh_tokens (user_id, token_hash, device_hash, expires_at)
     VALUES ($1, $2, $3, now() + ($4 || ' days')::interval)`,
    [userId, sha256(token), deviceHash ?? null, String(config.refreshTokenDays)],
  );
  return token;
}

export function setRefreshCookie(res, token) {
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: config.cookieSecure,
    path: '/api/auth',
    maxAge: config.refreshTokenDays * 24 * 60 * 60 * 1000,
  });
}

export function clearRefreshCookie(res) {
  res.clearCookie(REFRESH_COOKIE, { httpOnly: true, sameSite: 'strict', secure: config.cookieSecure, path: '/api/auth' });
}

export const revokeAllRefreshTokens = (userId) =>
  query('UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [userId]);
