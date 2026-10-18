import { Router } from 'express';
import { config } from '../config.js';
import { query } from '../db.js';
import { audit } from '../lib/audit.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { notify } from '../lib/notify.js';
import { parse, uuid, z } from '../lib/validate.js';
import { authenticate, requireRole, wrap } from '../middleware/auth.js';

const router = Router();
router.use(authenticate, requireRole('child', 'guardian'));

const shape = (l, viewer) => ({
  id: l.id,
  status: l.status,
  initiatedBy: l.initiated_by,
  createdAt: l.created_at,
  pausedAt: l.paused_at,
  // The pause reason is private to the child (and admins); a guardian never receives it.
  pausedReason: viewer === 'child' ? l.paused_reason : undefined,
  other: { id: l.other_id, name: l.other_name, email: l.other_email },
  canRespond: l.status === 'pending' && l.initiated_by !== viewer,
});

router.get('/', wrap(async (req, res) => {
  const isChild = req.user.role === 'child';
  const { rows } = await query(
    `SELECT l.*, o.id AS other_id, o.full_name AS other_name, o.email AS other_email
     FROM guardian_links l JOIN users o ON o.id = ${isChild ? 'l.guardian_id' : 'l.child_id'}
     WHERE ${isChild ? 'l.child_id' : 'l.guardian_id'} = $1 AND l.status IN ('pending', 'active', 'paused')
     ORDER BY l.created_at DESC`,
    [req.user.id],
  );
  res.json(rows.map((l) => shape(l, req.user.role)));
}));

// Ask to connect. The answer is identical whether or not the person exists, so this cannot be used to
// search for children.
router.post('/', wrap(async (req, res) => {
  const { email } = parse(z.object({ email: z.string().trim().toLowerCase().email().max(200) }), req.body);
  if (req.user.role === 'guardian' && config.requireGuardianVerification && !req.user.guardian_verified) {
    throw forbidden('Your guardian account must be verified by an administrator first', 'guardian_unverified');
  }
  const targetRole = req.user.role === 'child' ? 'guardian' : 'child';
  const { rows } = await query(`SELECT id, full_name FROM users WHERE lower(email) = $1 AND role = $2 AND status = 'active'`, [email, targetRole]);
  const target = rows[0];
  if (target) {
    const childId = req.user.role === 'child' ? req.user.id : target.id;
    const guardianId = req.user.role === 'child' ? target.id : req.user.id;
    const ins = await query(
      `INSERT INTO guardian_links (child_id, guardian_id, initiated_by) VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING RETURNING id`,
      [childId, guardianId, req.user.role],
    );
    if (ins.rowCount) {
      await notify({
        recipientId: target.id, kind: 'system', urgent: false,
        title: 'New connection request',
        body: `${req.user.full_name} asked to connect on SafeZone. Open Privacy and permissions to accept or decline.`,
        sourceType: 'link', sourceId: ins.rows[0].id, dedupeKey: `linkreq:${ins.rows[0].id}`,
      });
      await audit(req, 'link.request', { targetType: 'link', targetId: ins.rows[0].id });
    }
  }
  res.status(202).json({ ok: true, message: 'If that person has a matching SafeZone account, they have been sent your request.' });
}));

async function loadLink(req) {
  const id = parse(uuid, req.params.id);
  const { rows } = await query('SELECT * FROM guardian_links WHERE id = $1', [id]);
  const link = rows[0];
  const mine = link && (req.user.role === 'child' ? link.child_id === req.user.id : link.guardian_id === req.user.id);
  if (!mine) throw notFound('Connection not found');
  return link;
}
const otherParty = (link, role) => (role === 'child' ? link.guardian_id : link.child_id);

router.post('/:id/accept', wrap(async (req, res) => {
  const link = await loadLink(req);
  if (link.status !== 'pending') throw badRequest('This request is not pending', 'bad_state');
  if (link.initiated_by === req.user.role) throw forbidden('The other person must accept your request', 'cannot_self_accept');
  if (req.user.role === 'guardian' && config.requireGuardianVerification && !req.user.guardian_verified) {
    throw forbidden('Your guardian account must be verified by an administrator first', 'guardian_unverified');
  }
  // The child's consent is always recorded: either she started the request or she is accepting it now.
  await query(`UPDATE guardian_links SET status = 'active', child_consented_at = now(), updated_at = now() WHERE id = $1`, [link.id]);
  await notify({ recipientId: otherParty(link, req.user.role), kind: 'system', title: 'Connection accepted', body: `${req.user.full_name} accepted the connection.`, dedupeKey: `linkacc:${link.id}` });
  await audit(req, 'link.accept', { targetType: 'link', targetId: link.id });
  res.json({ ok: true });
}));

router.post('/:id/decline', wrap(async (req, res) => {
  const link = await loadLink(req);
  if (link.status !== 'pending' || link.initiated_by === req.user.role) throw badRequest('Nothing to decline', 'bad_state');
  await query(`UPDATE guardian_links SET status = 'declined', ended_at = now(), updated_at = now() WHERE id = $1`, [link.id]);
  await audit(req, 'link.decline', { targetType: 'link', targetId: link.id });
  res.json({ ok: true });
}));

// Either side can end a connection at any time. The other side is told.
router.post('/:id/revoke', wrap(async (req, res) => {
  const link = await loadLink(req);
  if (!['pending', 'active', 'paused'].includes(link.status)) throw badRequest('Already ended', 'bad_state');
  await query(`UPDATE guardian_links SET status = 'revoked', ended_at = now(), updated_at = now() WHERE id = $1`, [link.id]);
  await notify({
    recipientId: otherParty(link, req.user.role), kind: 'system', title: 'Connection ended',
    body: `${req.user.full_name} ended the connection. No more information is shared through it.`, dedupeKey: `linkend:${link.id}`,
  });
  await audit(req, 'link.revoke', { targetType: 'link', targetId: link.id, meta: { by: req.user.role } });
  res.json({ ok: true });
}));

// The child can pause sharing with one guardian. The pause is logged, the guardian is told it is paused
// (without the reason), and administrators can see the pattern to detect controlling behaviour.
router.post('/:id/pause', requireRole('child'), wrap(async (req, res) => {
  const link = await loadLink(req);
  if (link.status !== 'active') throw badRequest('Only an active connection can be paused', 'bad_state');
  const { reason } = parse(z.object({ reason: z.string().trim().min(3).max(200) }), req.body);
  await query(`UPDATE guardian_links SET status = 'paused', paused_at = now(), paused_reason = $2, updated_at = now() WHERE id = $1`, [link.id, reason]);
  await notify({ recipientId: link.guardian_id, kind: 'system', title: 'Sharing paused', body: `${req.user.full_name} paused sharing with you. You will not receive zone alerts or SOS alerts until it is resumed.`, dedupeKey: `linkpause:${link.id}:${Date.now()}` });
  await audit(req, 'link.pause', { targetType: 'link', targetId: link.id });
  res.json({ ok: true });
}));

router.post('/:id/resume', requireRole('child'), wrap(async (req, res) => {
  const link = await loadLink(req);
  if (link.status !== 'paused') throw badRequest('This connection is not paused', 'bad_state');
  await query(`UPDATE guardian_links SET status = 'active', paused_at = NULL, paused_reason = NULL, updated_at = now() WHERE id = $1`, [link.id]);
  await notify({ recipientId: link.guardian_id, kind: 'system', title: 'Sharing resumed', body: `${req.user.full_name} resumed sharing with you.`, dedupeKey: `linkresume:${link.id}:${Date.now()}` });
  await audit(req, 'link.resume', { targetType: 'link', targetId: link.id });
  res.json({ ok: true });
}));

export default router;
