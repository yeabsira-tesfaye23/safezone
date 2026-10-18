import { Router } from 'express';
import { query } from '../db.js';
import { activeGuardianIds, authorizeChildData } from '../lib/access.js';
import { audit } from '../lib/audit.js';
import { forbidden } from '../lib/errors.js';
import { notify } from '../lib/notify.js';
import { lat, lng, parse, uuid, z } from '../lib/validate.js';
import { authenticate, requireRole, wrap } from '../middleware/auth.js';

const router = Router();
router.use(authenticate);

// A check-in is the child choosing to share where she is right now. It is the only way a guardian sees a
// position outside of an SOS, and it expires after 24 hours.
router.post('/', requireRole('child'), wrap(async (req, res) => {
  const b = parse(z.object({ lat, lng, accuracyM: z.number().min(0).max(100000).optional() }), req.body);
  const { rows } = await query(
    `INSERT INTO checkins (child_id, lat, lng, accuracy_m, expires_at) VALUES ($1, $2, $3, $4, now() + interval '24 hours') RETURNING id, expires_at`,
    [req.user.id, b.lat, b.lng, b.accuracyM ? Math.round(b.accuracyM) : null],
  );
  const guardians = await activeGuardianIds(req.user.id);
  for (const gid of guardians) {
    await notify({
      recipientId: gid, kind: 'system', title: `${req.user.full_name} shared their location`,
      body: 'She chose to share her current location with you. It is visible for 24 hours.', sourceType: 'checkin', sourceId: rows[0].id, dedupeKey: `checkin:${rows[0].id}`,
    });
  }
  await audit(req, 'checkin.create', { targetType: 'checkin', targetId: rows[0].id });
  res.status(201).json({ id: rows[0].id, expiresAt: rows[0].expires_at, sharedWith: guardians.length });
}));

router.get('/latest', wrap(async (req, res) => {
  if (req.user.role === 'admin') throw forbidden('Administrators cannot view location data', 'wrong_role');
  const childId = req.user.role === 'child' ? req.user.id : parse(uuid, req.query.childId);
  await authorizeChildData(req.user, childId);
  const { rows } = await query(
    'SELECT id, lat, lng, accuracy_m, created_at, expires_at FROM checkins WHERE child_id = $1 AND expires_at > now() ORDER BY created_at DESC LIMIT 1',
    [childId],
  );
  if (!rows[0]) return res.json(null);
  if (req.user.role === 'guardian') await audit(req, 'checkin.view', { targetType: 'checkin', targetId: rows[0].id, dedupeMinutes: 10 });
  res.json({ id: rows[0].id, lat: rows[0].lat, lng: rows[0].lng, accuracyM: rows[0].accuracy_m, createdAt: rows[0].created_at, expiresAt: rows[0].expires_at });
}));

export default router;
