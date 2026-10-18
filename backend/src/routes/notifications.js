import { Router } from 'express';
import { query } from '../db.js';
import { notFound } from '../lib/errors.js';
import { parse, uuid } from '../lib/validate.js';
import { authenticate, wrap } from '../middleware/auth.js';

const router = Router();
router.use(authenticate);

const shape = (n) => ({
  id: n.id, kind: n.kind, urgent: n.urgent, title: n.title, body: n.body, sourceType: n.source_type, sourceId: n.source_id,
  deliveryStatus: n.delivery_status, createdAt: n.created_at, readAt: n.read_at,
});

router.get('/', wrap(async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 100);
  const unreadOnly = req.query.unread === 'true';
  const { rows } = await query(
    `SELECT * FROM notifications WHERE recipient_id = $1 ${unreadOnly ? 'AND read_at IS NULL' : ''} ORDER BY created_at DESC LIMIT $2`,
    [req.user.id, limit],
  );
  const counts = (await query(
    `SELECT count(*) FILTER (WHERE read_at IS NULL)::int AS unread, count(*) FILTER (WHERE read_at IS NULL AND urgent)::int AS urgent_unread
     FROM notifications WHERE recipient_id = $1`,
    [req.user.id],
  )).rows[0];
  res.json({ items: rows.map(shape), unread: counts.unread, urgentUnread: counts.urgent_unread });
}));

router.post('/read-all', wrap(async (req, res) => {
  await query('UPDATE notifications SET read_at = now() WHERE recipient_id = $1 AND read_at IS NULL', [req.user.id]);
  res.json({ ok: true });
}));

router.post('/:id/read', wrap(async (req, res) => {
  const id = parse(uuid, req.params.id);
  const { rowCount } = await query('UPDATE notifications SET read_at = coalesce(read_at, now()) WHERE id = $1 AND recipient_id = $2', [id, req.user.id]);
  if (!rowCount) throw notFound();
  res.json({ ok: true });
}));

export default router;
