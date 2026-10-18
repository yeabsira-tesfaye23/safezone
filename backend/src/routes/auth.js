import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { config } from '../config.js';
import { query, withTransaction } from '../db.js';
import { audit } from '../lib/audit.js';
import { randomToken, sha256 } from '../lib/crypto.js';
import { HttpError, badRequest, forbidden, unauthorized } from '../lib/errors.js';
import { sendMail } from '../lib/mail.js';
import { notify } from '../lib/notify.js';
import { DUMMY_HASH, checkPasswordPolicy, hashPassword, verifyPassword } from '../lib/password.js';
import { REFRESH_COOKIE, clearRefreshCookie, issueRefreshToken, revokeAllRefreshTokens, setRefreshCookie, signAccessToken } from '../lib/tokens.js';
import { parse, z } from '../lib/validate.js';
import { wrap } from '../middleware/auth.js';

const router = Router();

router.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: config.authRateLimit,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many attempts. Please wait and try again.' },
  }),
);

const publicUser = (u) => ({
  id: u.id,
  role: u.role,
  email: u.email,
  fullName: u.full_name,
  guardianVerified: u.guardian_verified,
  dateOfBirth: u.date_of_birth,
});

function ageFrom(dobIso) {
  const dob = new Date(dobIso);
  const now = new Date();
  let age = now.getUTCFullYear() - dob.getUTCFullYear();
  const m = now.getUTCMonth() - dob.getUTCMonth();
  if (m < 0 || (m === 0 && now.getUTCDate() < dob.getUTCDate())) age -= 1;
  return age;
}

// Track devices so we can tell a user when someone signs in from somewhere new (account-takeover safeguard).
async function recordDevice(req, user) {
  const deviceId = req.get('x-device-id');
  if (!deviceId || deviceId.length > 100) return null;
  const hash = sha256(deviceId);
  const existing = await query('SELECT count(*)::int AS n FROM devices WHERE user_id = $1', [user.id]);
  const { rows } = await query(
    `INSERT INTO devices (user_id, device_hash, user_agent) VALUES ($1, $2, $3)
     ON CONFLICT (user_id, device_hash) DO UPDATE SET last_seen = now()
     RETURNING (xmax = 0) AS is_new`,
    [user.id, hash, (req.get('user-agent') || '').slice(0, 200)],
  );
  if (rows[0]?.is_new && existing.rows[0].n > 0) {
    await notify({
      recipientId: user.id,
      kind: 'system',
      urgent: false,
      title: 'New device signed in',
      body: 'Your account was just used from a device we have not seen before. If this was not you, change your password now.',
      dedupeKey: `newdevice:${hash}`,
    });
  }
  return hash;
}

const registerSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  password: z.string().max(128),
  fullName: z.string().trim().min(2).max(100),
  role: z.enum(['child', 'guardian']),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  acceptedPrivacyNotice: z.literal(true, { errorMap: () => ({ message: 'you must accept the privacy notice' }) }),
});

router.post('/register', wrap(async (req, res) => {
  const body = parse(registerSchema, req.body);
  checkPasswordPolicy(body.password, { email: body.email, name: body.fullName });
  if (body.role === 'child') {
    if (!body.dateOfBirth || Number.isNaN(Date.parse(body.dateOfBirth))) throw badRequest('dateOfBirth: required for a child account', 'validation_error');
    const age = ageFrom(body.dateOfBirth);
    if (age >= 18) throw badRequest('Child accounts are for people under 18. Register as a guardian instead.', 'not_a_minor');
    if (age < 5) throw badRequest('dateOfBirth: please check the date', 'validation_error');
  }
  const passwordHash = await hashPassword(body.password);
  let user;
  try {
    const { rows } = await query(
      `INSERT INTO users (role, email, full_name, password_hash, date_of_birth)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [body.role, body.email, body.fullName, passwordHash, body.role === 'child' ? body.dateOfBirth : null],
    );
    user = rows[0];
  } catch (err) {
    if (err.code === '23505') {
      // Do not reveal whether the email exists.
      throw badRequest('Could not create the account with those details', 'registration_failed');
    }
    throw err;
  }
  if (user.role === 'child') await query('INSERT INTO sharing_settings (child_id) VALUES ($1) ON CONFLICT DO NOTHING', [user.id]);
  req.user = user;
  await audit(req, 'auth.register', { targetType: 'user', targetId: user.id, meta: { role: user.role } });
  const deviceHash = await recordDevice(req, user);
  const refresh = await issueRefreshToken(user.id, deviceHash);
  setRefreshCookie(res, refresh);
  res.status(201).json({ accessToken: signAccessToken(user), user: publicUser(user) });
}));

const loginSchema = z.object({ email: z.string().trim().toLowerCase().max(200), password: z.string().max(128) });

router.post('/login', wrap(async (req, res) => {
  const { email, password } = parse(loginSchema, req.body);
  const { rows } = await query('SELECT * FROM users WHERE lower(email) = $1', [email]);
  const user = rows[0];
  const generic = unauthorized('Incorrect email or password', 'bad_credentials');

  if (!user) {
    await verifyPassword(password, DUMMY_HASH); // keep timing similar
    throw generic;
  }
  if (user.locked_until && new Date(user.locked_until) > new Date()) {
    throw new HttpError(429, 'Too many failed attempts. Try again later or reset your password.', 'locked');
  }
  const ok = await verifyPassword(password, user.password_hash);
  if (!ok) {
    const failed = user.failed_attempts + 1;
    const lock = failed >= config.maxFailedLogins;
    await query(
      `UPDATE users SET failed_attempts = $2, locked_until = CASE WHEN $3 THEN now() + ($4 || ' minutes')::interval ELSE locked_until END WHERE id = $1`,
      [user.id, lock ? 0 : failed, lock, String(config.lockMinutes)],
    );
    req.user = user;
    await audit(req, lock ? 'auth.locked' : 'auth.login_failed', { targetType: 'user', targetId: user.id });
    throw generic;
  }
  if (user.status !== 'active') throw forbidden('This account is not active', 'account_inactive');
  await query('UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = $1', [user.id]);
  req.user = user;
  await audit(req, 'auth.login', { targetType: 'user', targetId: user.id });
  const deviceHash = await recordDevice(req, user);
  const refresh = await issueRefreshToken(user.id, deviceHash);
  setRefreshCookie(res, refresh);
  res.json({ accessToken: signAccessToken(user), user: publicUser(user) });
}));

// Exchange the httpOnly refresh cookie for a new access token. Refresh tokens rotate on every use;
// presenting an already-used token revokes the whole family (it suggests the token was stolen).
router.post('/refresh', wrap(async (req, res) => {
  if (req.get('x-requested-with') !== 'safezone') throw forbidden('Missing header', 'csrf');
  const token = req.cookies?.[REFRESH_COOKIE];
  if (!token) throw unauthorized('No session');
  const { rows } = await query('SELECT * FROM refresh_tokens WHERE token_hash = $1', [sha256(token)]);
  const row = rows[0];
  if (!row) { clearRefreshCookie(res); throw unauthorized('No session'); }
  if (row.revoked_at) {
    await revokeAllRefreshTokens(row.user_id);
    clearRefreshCookie(res);
    throw unauthorized('Session no longer valid');
  }
  if (new Date(row.expires_at) < new Date()) { clearRefreshCookie(res); throw unauthorized('Session expired'); }
  const { rows: users } = await query('SELECT * FROM users WHERE id = $1', [row.user_id]);
  const user = users[0];
  if (!user || user.status !== 'active') { clearRefreshCookie(res); throw unauthorized('Account not active'); }
  await query('UPDATE refresh_tokens SET revoked_at = now() WHERE id = $1', [row.id]);
  const next = await issueRefreshToken(user.id, row.device_hash);
  setRefreshCookie(res, next);
  res.json({ accessToken: signAccessToken(user), user: publicUser(user) });
}));

router.post('/logout', wrap(async (req, res) => {
  const token = req.cookies?.[REFRESH_COOKIE];
  if (token) await query('UPDATE refresh_tokens SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL', [sha256(token)]);
  clearRefreshCookie(res);
  res.json({ ok: true });
}));

// Account recovery. The response is always the same so attackers cannot discover which emails are registered.
router.post('/forgot-password', wrap(async (req, res) => {
  const { email } = parse(z.object({ email: z.string().trim().toLowerCase().email().max(200) }), req.body);
  const { rows } = await query("SELECT * FROM users WHERE lower(email) = $1 AND status = 'active'", [email]);
  const user = rows[0];
  if (user) {
    await query('UPDATE password_resets SET used_at = now() WHERE user_id = $1 AND used_at IS NULL', [user.id]);
    const token = randomToken(32);
    await query(
      `INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES ($1, $2, now() + interval '30 minutes')`,
      [user.id, sha256(token)],
    );
    const link = `${config.frontendOrigin}/reset-password?token=${token}`;
    await sendMail({ to: user.email, subject: 'Reset your SafeZone password', text: `Use this link within 30 minutes: ${link}` });
    req.user = user;
    await audit(req, 'auth.reset_requested', { targetType: 'user', targetId: user.id });
  }
  res.json({ ok: true, message: 'If that email is registered, a reset link has been sent.' });
}));

router.post('/reset-password', wrap(async (req, res) => {
  const { token, newPassword } = parse(z.object({ token: z.string().min(20).max(200), newPassword: z.string().max(128) }), req.body);
  const { rows } = await query(
    `SELECT r.id, r.user_id, u.email, u.full_name FROM password_resets r JOIN users u ON u.id = r.user_id
     WHERE r.token_hash = $1 AND r.used_at IS NULL AND r.expires_at > now() AND u.status = 'active'`,
    [sha256(token)],
  );
  const row = rows[0];
  if (!row) throw badRequest('This reset link is invalid or has expired', 'bad_reset_token');
  checkPasswordPolicy(newPassword, { email: row.email, name: row.full_name });
  const hash = await hashPassword(newPassword);
  await withTransaction(async (c) => {
    await c.query('UPDATE password_resets SET used_at = now() WHERE id = $1', [row.id]);
    await c.query('UPDATE users SET password_hash = $2, failed_attempts = 0, locked_until = NULL, updated_at = now() WHERE id = $1', [row.user_id, hash]);
    await c.query('UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [row.user_id]);
  });
  await notify({ recipientId: row.user_id, kind: 'system', title: 'Password changed', body: 'Your password was reset. If this was not you, contact an administrator.', dedupeKey: `pwreset:${row.id}` });
  req.user = { id: row.user_id, role: null };
  await audit(req, 'auth.password_reset', { targetType: 'user', targetId: row.user_id });
  res.json({ ok: true });
}));

export default router;
