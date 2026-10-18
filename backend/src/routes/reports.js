import { Router } from 'express';
import { query } from '../db.js';
import { audit } from '../lib/audit.js';
import { decrypt, encrypt } from '../lib/crypto.js';
import { forbidden } from '../lib/errors.js';
import { notify } from '../lib/notify.js';
import { parse, z } from '../lib/validate.js';
import { authenticate, requireRole, wrap } from '../middleware/auth.js';

const router = Router();
router.use(authenticate);

const schema = z.object({
  category: z.enum(['harassment', 'suspicious_behavior', 'unsafe_place', 'other']),
  description: z.string().trim().min(10).max(2000),
  occurredAt: z.string().datetime().optional(),
  shareWithGuardians: z.boolean().default(false),
});

// Only what is needed: a category, what happened in the child's own words, and optionally when. No coordinates,
// no names of accused people are required, and nothing here ever labels anyone as an offender.
router.post('/', requireRole('child'), wrap(async (req, res) => {
  const b = parse(schema, req.body);
  const { rows } = await query(
    `INSERT INTO incident_reports (child_id, category, description_enc, occurred_at, visibility)
     VALUES ($1, $2, $3, $4, $5) RETURNING id, status, created_at, visibility`,
    [req.user.id, b.category, encrypt(b.description), b.occurredAt ?? null, b.shareWithGuardians ? 'admin_and_guardians' : 'admin_only'],
  );
  const admins = await query(`SELECT id FROM users WHERE role = 'admin' AND status = 'active'`);
  for (const a of admins.rows) {
    await notify({ recipientId: a.id, kind: 'system', title: 'New incident report', body: 'A new incident report is waiting for review.', sourceType: 'report', sourceId: rows[0].id, dedupeKey: `report:${rows[0].id}` });
  }
  await audit(req, 'report.create', { targetType: 'report', targetId: rows[0].id });
  res.status(201).json({ id: rows[0].id, status: rows[0].status, createdAt: rows[0].created_at, visibility: rows[0].visibility });
}));

const present = (r) => ({
  id: r.id, category: r.category, description: decrypt(r.description_enc), occurredAt: r.occurred_at,
  visibility: r.visibility, status: r.status, createdAt: r.created_at,
});

// Child: her own reports. Guardian: only reports a child chose to share with guardians. Admins use /api/admin/reports.
router.get('/', wrap(async (req, res) => {
  if (req.user.role === 'admin') throw forbidden('Use the administrator review screen', 'wrong_role');
  if (req.user.role === 'child') {
    const { rows } = await query('SELECT * FROM incident_reports WHERE child_id = $1 ORDER BY created_at DESC', [req.user.id]);
    return res.json(rows.map(present));
  }
  const { rows } = await query(
    `SELECT r.*, u.full_name AS child_name FROM incident_reports r JOIN users u ON u.id = r.child_id
     WHERE r.visibility = 'admin_and_guardians'
       AND r.child_id IN (SELECT child_id FROM guardian_links WHERE guardian_id = $1 AND status = 'active')
     ORDER BY r.created_at DESC`,
    [req.user.id],
  );
  await audit(req, 'report.guardian_view', { targetType: 'report', targetId: null, dedupeMinutes: 10 });
  res.json(rows.map((r) => ({ ...present(r), childName: r.child_name })));
}));

export default router;
