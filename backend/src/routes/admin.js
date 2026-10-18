import { Router } from 'express';
import { query } from '../db.js';
import { audit } from '../lib/audit.js';
import { decrypt, encrypt } from '../lib/crypto.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { notify } from '../lib/notify.js';
import { parse, uuid, z } from '../lib/validate.js';
import { authenticate, requireRole, wrap } from '../middleware/auth.js';

// Administrators manage accounts, review incident reports and watch security signals.
// There is deliberately NO route here that returns zone events, check-ins, SOS coordinates or any other location.
const router = Router();
router.use(authenticate, requireRole('admin'));

router.get('/stats', wrap(async (_req, res) => {
  const users = (await query(`SELECT role, status, count(*)::int AS n FROM users GROUP BY role, status`)).rows;
  const reports = (await query(`SELECT status, count(*)::int AS n FROM incident_reports GROUP BY status`)).rows;
  const sos = (await query(`SELECT count(*)::int AS n FROM sos_alerts WHERE triggered_at > now() - interval '30 days'`)).rows[0].n;
  const links = (await query(`SELECT status, count(*)::int AS n FROM guardian_links GROUP BY status`)).rows;
  res.json({ users, reports, sosLast30Days: sos, links });
}));

const usersQuery = z.object({
  q: z.string().trim().max(100).optional(),
  role: z.enum(['child', 'guardian', 'admin']).optional(),
  status: z.enum(['active', 'deactivated', 'suspended']).optional(),
  page: z.coerce.number().int().min(1).default(1),
});

router.get('/users', wrap(async (req, res) => {
  const f = parse(usersQuery, req.query);
  const size = 25;
  const params = [];
  const where = [];
  if (f.q) { params.push(`%${f.q.toLowerCase()}%`); where.push(`(lower(email) LIKE $${params.length} OR lower(full_name) LIKE $${params.length})`); }
  if (f.role) { params.push(f.role); where.push(`role = $${params.length}`); }
  if (f.status) { params.push(f.status); where.push(`status = $${params.length}`); }
  params.push(size, (f.page - 1) * size);
  const { rows } = await query(
    `SELECT id, role, email, full_name, status, guardian_verified, created_at FROM users
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  await audit(req, 'admin.users_list', { dedupeMinutes: 10 });
  res.json({ page: f.page, items: rows.map((u) => ({ id: u.id, role: u.role, email: u.email, fullName: u.full_name, status: u.status, guardianVerified: u.guardian_verified, createdAt: u.created_at })) });
}));

router.patch('/users/:id', wrap(async (req, res) => {
  const id = parse(uuid, req.params.id);
  const b = parse(z.object({ status: z.enum(['active', 'deactivated', 'suspended']).optional(), guardianVerified: z.boolean().optional() }), req.body);
  if (id === req.user.id) throw badRequest('You cannot change your own account here', 'self_change');
  const { rows } = await query('SELECT * FROM users WHERE id = $1', [id]);
  const u = rows[0];
  if (!u) throw notFound('User not found');
  if (u.role === 'admin') throw forbidden('Administrator accounts are managed outside the app', 'admin_protected');
  if (b.guardianVerified !== undefined && u.role !== 'guardian') throw badRequest('Only guardians are verified', 'validation_error');
  await query(
    `UPDATE users SET status = coalesce($2, status), guardian_verified = coalesce($3, guardian_verified),
       deactivated_at = CASE WHEN $2 IN ('deactivated', 'suspended') THEN now() ELSE deactivated_at END, updated_at = now() WHERE id = $1`,
    [id, b.status ?? null, b.guardianVerified ?? null],
  );
  if (b.status && b.status !== 'active') {
    await query('UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [id]);
    await query(`UPDATE guardian_links SET status = 'revoked', ended_at = now(), updated_at = now() WHERE (child_id = $1 OR guardian_id = $1) AND status IN ('pending', 'active', 'paused')`, [id]);
  }
  await audit(req, 'admin.user_update', { targetType: 'user', targetId: id, meta: b });
  res.json({ ok: true });
}));

const reportsQuery = z.object({ status: z.enum(['submitted', 'in_review', 'closed']).optional(), page: z.coerce.number().int().min(1).default(1) });

// The list shows no description text: opening a report is a separate, audited action.
router.get('/reports', wrap(async (req, res) => {
  const f = parse(reportsQuery, req.query);
  const size = 25;
  const { rows } = await query(
    `SELECT r.id, r.category, r.status, r.visibility, r.created_at, r.occurred_at, u.full_name AS child_name
     FROM incident_reports r JOIN users u ON u.id = r.child_id
     WHERE ($1::text IS NULL OR r.status = $1) ORDER BY r.created_at DESC LIMIT $2 OFFSET $3`,
    [f.status ?? null, size, (f.page - 1) * size],
  );
  res.json({ page: f.page, items: rows.map((r) => ({ id: r.id, category: r.category, status: r.status, visibility: r.visibility, createdAt: r.created_at, occurredAt: r.occurred_at, childName: r.child_name })) });
}));

router.get('/reports/:id', wrap(async (req, res) => {
  const id = parse(uuid, req.params.id);
  const { rows } = await query(
    `SELECT r.*, u.full_name AS child_name FROM incident_reports r JOIN users u ON u.id = r.child_id WHERE r.id = $1`, [id]);
  const r = rows[0];
  if (!r) throw notFound('Report not found');
  await audit(req, 'report.read', { targetType: 'report', targetId: r.id });
  res.json({
    id: r.id, category: r.category, description: decrypt(r.description_enc), occurredAt: r.occurred_at, status: r.status,
    visibility: r.visibility, childName: r.child_name, createdAt: r.created_at, adminNote: decrypt(r.admin_note_enc), closedAt: r.closed_at,
  });
}));

router.patch('/reports/:id', wrap(async (req, res) => {
  const id = parse(uuid, req.params.id);
  const b = parse(z.object({ status: z.enum(['in_review', 'closed']), note: z.string().trim().max(2000).optional() }), req.body);
  const { rows } = await query('SELECT * FROM incident_reports WHERE id = $1', [id]);
  const r = rows[0];
  if (!r) throw notFound('Report not found');
  await query(
    `UPDATE incident_reports SET status = $2, admin_note_enc = coalesce($3, admin_note_enc), reviewed_by = $4,
       closed_at = CASE WHEN $2 = 'closed' THEN now() ELSE NULL END, updated_at = now() WHERE id = $1`,
    [id, b.status, b.note ? encrypt(b.note) : null, req.user.id],
  );
  await notify({
    recipientId: r.child_id, kind: 'system', title: 'Your report was updated',
    body: b.status === 'closed' ? 'An administrator finished reviewing your report.' : 'An administrator is reviewing your report.',
    sourceType: 'report', sourceId: id, dedupeKey: `reportstatus:${id}:${b.status}`,
  });
  await audit(req, 'report.review', { targetType: 'report', targetId: id, meta: { status: b.status } });
  res.json({ ok: true });
}));

router.get('/audit', wrap(async (req, res) => {
  const f = parse(z.object({ action: z.string().max(60).optional(), actorId: uuid.optional(), page: z.coerce.number().int().min(1).default(1) }), req.query);
  const size = 50;
  const { rows } = await query(
    `SELECT a.id, a.action, a.actor_role, a.target_type, a.target_id, a.ip, a.meta, a.created_at, u.full_name AS actor_name
     FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id
     WHERE ($1::text IS NULL OR a.action = $1) AND ($2::uuid IS NULL OR a.actor_id = $2)
     ORDER BY a.id DESC LIMIT $3 OFFSET $4`,
    [f.action ?? null, f.actorId ?? null, size, (f.page - 1) * size],
  );
  res.json({ page: f.page, items: rows.map((a) => ({ id: a.id, action: a.action, actorName: a.actor_name, actorRole: a.actor_role, targetType: a.target_type, targetId: a.target_id, ip: a.ip, meta: a.meta, createdAt: a.created_at })) });
}));

// Misuse signals: guardians whose connections are often paused or ended by the child. Shows counts and the
// reasons children gave. Never any location.
router.get('/signals', wrap(async (req, res) => {
  const { rows } = await query(
    `SELECT g.id, g.full_name, g.email,
       count(*) FILTER (WHERE l.status = 'paused')::int AS paused_now,
       count(*) FILTER (WHERE l.status = 'revoked' AND l.ended_at > now() - interval '30 days')::int AS ended_30d,
       count(*)::int AS total_links,
       coalesce(array_agg(l.paused_reason) FILTER (WHERE l.paused_reason IS NOT NULL), '{}') AS pause_reasons
     FROM users g JOIN guardian_links l ON l.guardian_id = g.id
     WHERE g.role = 'guardian' GROUP BY g.id
     HAVING count(*) FILTER (WHERE l.status = 'paused') + count(*) FILTER (WHERE l.status = 'revoked' AND l.ended_at > now() - interval '30 days') >= 1
     ORDER BY 4 DESC, 5 DESC LIMIT 50`,
  );
  await audit(req, 'admin.signals_view', { dedupeMinutes: 10 });
  res.json(rows.map((r) => ({ guardianId: r.id, fullName: r.full_name, email: r.email, pausedNow: r.paused_now, endedLast30Days: r.ended_30d, totalLinks: r.total_links, pauseReasons: r.pause_reasons })));
}));

export default router;
