import { Router } from 'express';
import { query } from '../db.js';
import { audit } from '../lib/audit.js';
import { badRequest, notFound } from '../lib/errors.js';
import { parse, uuid, z } from '../lib/validate.js';
import { authenticate, requireRole, wrap } from '../middleware/auth.js';

const router = Router();
router.use(authenticate, requireRole('child'));

// Emergency contacts are chosen by the child. A contact can be a registered guardian account (receives SOS in
// the app) and/or a phone number (used only for the "send an SMS yourself" fallback; the server never texts it).
router.get('/', wrap(async (req, res) => {
  const { rows } = await query(
    `SELECT c.id, c.display_name, c.phone, c.contact_user_id IS NOT NULL AS has_account
     FROM emergency_contacts c WHERE c.child_id = $1 ORDER BY c.created_at`,
    [req.user.id],
  );
  res.json(rows.map((r) => ({ id: r.id, displayName: r.display_name, phone: r.phone, hasAccount: r.has_account })));
}));

const schema = z.object({
  displayName: z.string().trim().min(1).max(80),
  email: z.string().trim().toLowerCase().email().max(200).optional(),
  phone: z.string().trim().regex(/^\+?[0-9 ()-]{6,20}$/, 'enter digits, optionally starting with +').optional(),
});

router.post('/', wrap(async (req, res) => {
  const body = parse(schema, req.body);
  if (!body.email && !body.phone) throw badRequest('Enter an email of a SafeZone guardian, a phone number, or both', 'validation_error');
  let contactUserId = null;
  if (body.email) {
    const { rows } = await query(`SELECT id FROM users WHERE lower(email) = $1 AND role = 'guardian' AND status = 'active'`, [body.email]);
    if (!rows[0]) throw badRequest('No guardian account uses that email. You can still add the phone number.', 'no_such_guardian');
    contactUserId = rows[0].id;
  }
  const { rows } = await query(
    `INSERT INTO emergency_contacts (child_id, contact_user_id, display_name, phone) VALUES ($1, $2, $3, $4) RETURNING id`,
    [req.user.id, contactUserId, body.displayName, body.phone ?? null],
  );
  await audit(req, 'contact.add', { targetType: 'contact', targetId: rows[0].id });
  res.status(201).json({ id: rows[0].id });
}));

router.delete('/:id', wrap(async (req, res) => {
  const id = parse(uuid, req.params.id);
  const { rowCount } = await query('DELETE FROM emergency_contacts WHERE id = $1 AND child_id = $2', [id, req.user.id]);
  if (!rowCount) throw notFound();
  await audit(req, 'contact.remove', { targetType: 'contact', targetId: id });
  res.json({ ok: true });
}));

export default router;
