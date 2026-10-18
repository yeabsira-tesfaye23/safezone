import { Router } from 'express';
import { query, withTransaction } from '../db.js';
import { getSharing } from '../lib/access.js';
import { audit } from '../lib/audit.js';
import { badRequest, unauthorized } from '../lib/errors.js';
import { notify } from '../lib/notify.js';
import { checkPasswordPolicy, hashPassword, verifyPassword } from '../lib/password.js';
import { clearRefreshCookie, revokeAllRefreshTokens } from '../lib/tokens.js';
import { parse, z } from '../lib/validate.js';
import { authenticate, requireRole, wrap } from '../middleware/auth.js';

const router = Router();
router.use(authenticate);

const present = (u) => ({
  id: u.id, role: u.role, email: u.email, fullName: u.full_name,
  guardianVerified: u.guardian_verified, dateOfBirth: u.date_of_birth,
});

router.get('/', wrap(async (req, res) => {
  const out = present(req.user);
  if (req.user.role === 'child') {
    const s = await getSharing(req.user.id);
    out.sharing = { shareZoneEvents: s.share_zone_events, shareSosLocation: s.share_sos_location };
  }
  res.json(out);
}));

router.patch('/', wrap(async (req, res) => {
  const { fullName } = parse(z.object({ fullName: z.string().trim().min(2).max(100) }), req.body);
  await query('UPDATE users SET full_name = $2, updated_at = now() WHERE id = $1', [req.user.id, fullName]);
  res.json({ ...present(req.user), fullName });
}));

// The child decides what is shared. These switches are enforced on the server for every guardian request.
router.put('/sharing', requireRole('child'), wrap(async (req, res) => {
  const body = parse(z.object({ shareZoneEvents: z.boolean(), shareSosLocation: z.boolean() }), req.body);
  await query(
    `INSERT INTO sharing_settings (child_id, share_zone_events, share_sos_location, updated_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (child_id) DO UPDATE SET share_zone_events = $2, share_sos_location = $3, updated_at = now()`,
    [req.user.id, body.shareZoneEvents, body.shareSosLocation],
  );
  await audit(req, 'sharing.update', { targetType: 'user', targetId: req.user.id, meta: body });
  res.json(body);
}));

router.post('/change-password', wrap(async (req, res) => {
  const { currentPassword, newPassword } = parse(z.object({ currentPassword: z.string().max(128), newPassword: z.string().max(128) }), req.body);
  const { rows } = await query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
  if (!(await verifyPassword(currentPassword, rows[0].password_hash))) throw unauthorized('Current password is incorrect', 'bad_credentials');
  checkPasswordPolicy(newPassword, { email: req.user.email, name: req.user.full_name });
  await query('UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1', [req.user.id, await hashPassword(newPassword)]);
  await revokeAllRefreshTokens(req.user.id);
  clearRefreshCookie(res);
  await notify({ recipientId: req.user.id, kind: 'system', title: 'Password changed', body: 'Your password was changed and all other sessions were signed out.', dedupeKey: `pwchange:${Date.now()}` });
  await audit(req, 'account.password_change', { targetType: 'user', targetId: req.user.id });
  res.json({ ok: true, mustSignInAgain: true });
}));

// Deactivation: sign-in stops immediately, active links end, data is anonymized later by the retention job.
router.post('/deactivate', wrap(async (req, res) => {
  const { password } = parse(z.object({ password: z.string().max(128) }), req.body);
  const { rows } = await query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
  if (!(await verifyPassword(password, rows[0].password_hash))) throw unauthorized('Password is incorrect', 'bad_credentials');
  await withTransaction(async (c) => {
    await c.query(`UPDATE users SET status = 'deactivated', deactivated_at = now(), updated_at = now() WHERE id = $1`, [req.user.id]);
    await c.query(
      `UPDATE guardian_links SET status = 'revoked', ended_at = now(), updated_at = now()
       WHERE (child_id = $1 OR guardian_id = $1) AND status IN ('pending', 'active', 'paused')`,
      [req.user.id],
    );
    await c.query('UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [req.user.id]);
  });
  await audit(req, 'account.deactivate', { targetType: 'user', targetId: req.user.id });
  clearRefreshCookie(res);
  res.json({ ok: true });
}));

// Delete my stored location data and notifications now. Reports that are still open are kept (legal hold)
// so an administrator can finish reviewing them; closed reports are deleted.
router.delete('/data', wrap(async (req, res) => {
  const { password } = parse(z.object({ password: z.string().max(128) }), req.body);
  const { rows } = await query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
  if (!(await verifyPassword(password, rows[0].password_hash))) throw unauthorized('Password is incorrect', 'bad_credentials');
  const id = req.user.id;
  const summary = await withTransaction(async (c) => {
    const out = {};
    out.notifications = (await c.query('DELETE FROM notifications WHERE recipient_id = $1', [id])).rowCount;
    if (req.user.role === 'child') {
      out.locationEvents = (await c.query('DELETE FROM location_events WHERE child_id = $1', [id])).rowCount;
      out.sosAlerts = (await c.query('DELETE FROM sos_alerts WHERE child_id = $1', [id])).rowCount;
      out.checkins = (await c.query('DELETE FROM checkins WHERE child_id = $1', [id])).rowCount;
      await c.query('UPDATE zone_states SET confirmed_state = NULL, confirmed_at = NULL, cand_state = NULL, cand_count = 0, cand_first_at = NULL WHERE child_id = $1', [id]);
      out.reportsDeleted = (await c.query(`DELETE FROM incident_reports WHERE child_id = $1 AND status = 'closed'`, [id])).rowCount;
      out.reportsKeptForReview = (await c.query(`SELECT count(*)::int AS n FROM incident_reports WHERE child_id = $1`, [id])).rows[0].n;
    }
    return out;
  });
  await audit(req, 'account.data_delete', { targetType: 'user', targetId: id, meta: summary });
  res.json({ ok: true, deleted: summary });
}));

export default router;
