import { Router } from 'express';
import { query, withTransaction } from '../db.js';
import { activeGuardianIds, getLink, getSharing } from '../lib/access.js';
import { audit } from '../lib/audit.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { notify } from '../lib/notify.js';
import { lat, lng, parse, uuid, z } from '../lib/validate.js';
import { authenticate, requireRole, wrap } from '../middleware/auth.js';

const router = Router();
router.use(authenticate);

const sosSchema = z.object({
  clientId: uuid, // generated on the phone; lets a queued alert be retried without creating duplicates
  lat: lat.optional(),
  lng: lng.optional(),
  accuracyM: z.number().min(0).max(100000).optional(),
  triggeredAt: z.string().datetime().optional(),
});

async function recipientsFor(childId) {
  const ids = new Set(await activeGuardianIds(childId));
  const { rows } = await query(
    `SELECT c.contact_user_id FROM emergency_contacts c JOIN users u ON u.id = c.contact_user_id
     WHERE c.child_id = $1 AND u.status = 'active'`,
    [childId],
  );
  rows.forEach((r) => ids.add(r.contact_user_id));
  return [...ids];
}

const out = (a, { withLocation }) => ({
  id: a.id, childId: a.child_id, status: a.status, triggeredAt: a.triggered_at, serverReceivedAt: a.server_received_at,
  recipientsCount: a.recipients_count, acknowledgedAt: a.acknowledged_at, resolvedAt: a.resolved_at,
  hasLocation: a.lat !== null && a.lat !== undefined,
  location: withLocation && a.lat !== null ? { lat: a.lat, lng: a.lng, accuracyM: a.accuracy_m } : null,
});

// The child presses SOS. The response tells the truth about what happened on the server:
// "notified" means in-app alerts were created for N people. It does not mean a human has read them.
router.post('/', requireRole('child'), wrap(async (req, res) => {
  const b = parse(sosSchema, req.body);
  const sharing = await getSharing(req.user.id);
  const hasCoords = b.lat !== undefined && b.lng !== undefined;
  const keepLocation = hasCoords && sharing.share_sos_location; // switched off by the child: coordinates are dropped, not stored
  const now = Date.now();
  let triggered = b.triggeredAt ? new Date(b.triggeredAt).getTime() : now;
  if (!(triggered <= now + 60000 && triggered >= now - 24 * 3600 * 1000)) triggered = now;

  const inserted = await query(
    `INSERT INTO sos_alerts (child_id, client_id, lat, lng, accuracy_m, triggered_at)
     VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (child_id, client_id) DO NOTHING RETURNING *`,
    [req.user.id, b.clientId, keepLocation ? b.lat : null, keepLocation ? b.lng : null, keepLocation && b.accuracyM ? Math.round(b.accuracyM) : null, new Date(triggered)],
  );
  if (!inserted.rowCount) {
    const { rows } = await query('SELECT * FROM sos_alerts WHERE child_id = $1 AND client_id = $2', [req.user.id, b.clientId]);
    return res.json({ ...out(rows[0], { withLocation: false }), duplicate: true, locationIncluded: rows[0].lat !== null });
  }
  let alert = inserted.rows[0];

  const recipients = await recipientsFor(req.user.id);
  let delivered = 0;
  for (const rid of recipients) {
    const created = await notify({
      recipientId: rid, kind: 'sos', urgent: true,
      title: `EMERGENCY: ${req.user.full_name} pressed SOS`,
      body: `${req.user.full_name} sent an emergency alert${keepLocation ? ' with her location' : ' (no location attached)'}. Open the alert now. If she may be in danger, contact local emergency services.`,
      sourceType: 'sos', sourceId: alert.id, dedupeKey: `sos:${alert.id}`,
    });
    if (created) delivered += 1;
  }
  const status = delivered > 0 ? 'notified' : 'no_recipients';
  const upd = await query('UPDATE sos_alerts SET status = $2, recipients_count = $3 WHERE id = $1 RETURNING *', [alert.id, status, delivered]);
  alert = upd.rows[0];
  await audit(req, 'sos.create', { targetType: 'sos', targetId: alert.id, meta: { recipients: delivered, withLocation: keepLocation } });
  res.status(201).json({ ...out(alert, { withLocation: false }), duplicate: false, locationIncluded: keepLocation });
}));

// Is this user currently allowed to see this child's alerts?
async function canSeeAlerts(user, childId) {
  if (user.role === 'child') return user.id === childId;
  if (user.role !== 'guardian') return false;
  const link = await getLink(user.id, childId);
  if (link?.status === 'active') return true;
  const { rowCount } = await query('SELECT 1 FROM emergency_contacts WHERE child_id = $1 AND contact_user_id = $2', [childId, user.id]);
  return rowCount > 0;
}

router.get('/', wrap(async (req, res) => {
  if (req.user.role === 'admin') throw forbidden('Administrators cannot view SOS alerts', 'wrong_role');
  const childId = req.user.role === 'child' ? req.user.id : parse(uuid, req.query.childId);
  if (!(await canSeeAlerts(req.user, childId))) throw forbidden();
  const { rows } = await query('SELECT * FROM sos_alerts WHERE child_id = $1 ORDER BY triggered_at DESC LIMIT 30', [childId]);
  res.json(rows.map((a) => out(a, { withLocation: false })));
}));

// Alerts that need attention across all my children (guardian home screen).
router.get('/open', requireRole('guardian'), wrap(async (req, res) => {
  const { rows } = await query(
    `SELECT a.*, u.full_name AS child_name FROM sos_alerts a JOIN users u ON u.id = a.child_id
     WHERE a.status IN ('notified', 'acknowledged') AND a.triggered_at > now() - interval '48 hours'
       AND (a.child_id IN (SELECT child_id FROM guardian_links WHERE guardian_id = $1 AND status = 'active')
         OR a.child_id IN (SELECT child_id FROM emergency_contacts WHERE contact_user_id = $1))
     ORDER BY a.triggered_at DESC`,
    [req.user.id],
  );
  res.json(rows.map((a) => ({ ...out(a, { withLocation: false }), childName: a.child_name })));
}));

router.get('/:id', wrap(async (req, res) => {
  const id = parse(uuid, req.params.id);
  const { rows } = await query('SELECT a.*, u.full_name AS child_name FROM sos_alerts a JOIN users u ON u.id = a.child_id WHERE a.id = $1', [id]);
  const a = rows[0];
  if (!a || !(await canSeeAlerts(req.user, a.child_id))) throw notFound('Alert not found');
  if (req.user.role !== 'child') await audit(req, 'sos.view', { targetType: 'sos', targetId: a.id, dedupeMinutes: 5 });
  res.json({ ...out(a, { withLocation: true }), childName: a.child_name });
}));

router.post('/:id/acknowledge', requireRole('guardian'), wrap(async (req, res) => {
  const id = parse(uuid, req.params.id);
  const { rows } = await query('SELECT * FROM sos_alerts WHERE id = $1', [id]);
  const a = rows[0];
  if (!a || !(await canSeeAlerts(req.user, a.child_id))) throw notFound('Alert not found');
  if (a.status === 'resolved') throw badRequest('Already resolved', 'bad_state');
  await query(`UPDATE sos_alerts SET status = 'acknowledged', acknowledged_at = coalesce(acknowledged_at, now()), acknowledged_by = coalesce(acknowledged_by, $2) WHERE id = $1`, [a.id, req.user.id]);
  await notify({ recipientId: a.child_id, kind: 'sos', urgent: false, title: 'Someone saw your alert', body: `${req.user.full_name} acknowledged your SOS alert.`, sourceType: 'sos', sourceId: a.id, dedupeKey: `sosack:${a.id}:${req.user.id}` });
  await audit(req, 'sos.acknowledge', { targetType: 'sos', targetId: a.id });
  res.json({ ok: true });
}));

router.post('/:id/resolve', requireRole('child'), wrap(async (req, res) => {
  const id = parse(uuid, req.params.id);
  const { rows } = await query('SELECT * FROM sos_alerts WHERE id = $1 AND child_id = $2', [id, req.user.id]);
  const a = rows[0];
  if (!a) throw notFound('Alert not found');
  await query(`UPDATE sos_alerts SET status = 'resolved', resolved_at = now() WHERE id = $1`, [a.id]);
  for (const rid of await recipientsFor(req.user.id)) {
    await notify({ recipientId: rid, kind: 'sos', urgent: false, title: `${req.user.full_name} marked the alert resolved`, body: 'She says she is safe now.', sourceType: 'sos', sourceId: a.id, dedupeKey: `sosres:${a.id}:${rid}` });
  }
  await audit(req, 'sos.resolve', { targetType: 'sos', targetId: a.id });
  res.json({ ok: true });
}));

export default router;
