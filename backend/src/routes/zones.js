import { Router } from 'express';
import { config } from '../config.js';
import { query, withTransaction } from '../db.js';
import { activeGuardianIds, authorizeChildData, getLink, getSharing } from '../lib/access.js';
import { audit } from '../lib/audit.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { notify } from '../lib/notify.js';
import { lat, lng, parse, uuid, z } from '../lib/validate.js';
import { authenticate, requireRole, wrap } from '../middleware/auth.js';

const router = Router();
router.use(authenticate);

const zoneShape = (z, state) => ({
  id: z.id, childId: z.child_id, name: z.name, lat: z.center_lat, lng: z.center_lng,
  radiusM: z.radius_m, active: z.active, createdAt: z.created_at,
  state: state ? { current: state.confirmed_state, since: state.confirmed_at } : undefined,
});

async function requireGuardianOf(req, childId) {
  if (req.user.role !== 'guardian') throw forbidden('Only guardians manage safe zones', 'wrong_role');
  const link = await getLink(req.user.id, childId);
  if (!link || link.status !== 'active') throw forbidden('No active, consented link with this child');
  return link;
}

// Child: own zones with current state. Guardian: zones for one linked child; state only if the child shares it.
router.get('/', wrap(async (req, res) => {
  if (req.user.role === 'admin') throw forbidden('Administrators cannot view location data', 'wrong_role');
  const childId = req.user.role === 'child' ? req.user.id : parse(uuid, req.query.childId);
  let withState = true;
  if (req.user.role === 'guardian') {
    await requireGuardianOf(req, childId);
    withState = (await getSharing(childId)).share_zone_events;
  }
  const { rows } = await query(
    `SELECT z.*, s.confirmed_state, s.confirmed_at FROM safe_zones z
     LEFT JOIN zone_states s ON s.zone_id = z.id WHERE z.child_id = $1 ORDER BY z.created_at`,
    [childId],
  );
  if (req.user.role === 'guardian') await audit(req, 'zones.view', { targetType: 'user', targetId: childId, dedupeMinutes: 10 });
  res.json(rows.map((r) => zoneShape(r, withState ? r : null)));
}));

const createSchema = z.object({
  childId: uuid, name: z.string().trim().min(1).max(60), lat, lng,
  radiusM: z.number().int().min(100).max(500),
});

router.post('/', requireRole('guardian'), wrap(async (req, res) => {
  const body = parse(createSchema, req.body);
  await requireGuardianOf(req, body.childId);
  const { rows } = await query(
    `INSERT INTO safe_zones (child_id, created_by, name, center_lat, center_lng, radius_m) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [body.childId, req.user.id, body.name, body.lat, body.lng, body.radiusM],
  );
  await notify({
    recipientId: body.childId, kind: 'system', title: 'A safe zone was added',
    body: `${req.user.full_name} added the safe zone "${body.name}" (${body.radiusM} m). You can see it under Zones.`, dedupeKey: `zonenew:${rows[0].id}`,
  });
  await audit(req, 'zone.create', { targetType: 'zone', targetId: rows[0].id });
  res.status(201).json(zoneShape(rows[0]));
}));

const patchSchema = z.object({
  name: z.string().trim().min(1).max(60).optional(), lat: lat.optional(), lng: lng.optional(),
  radiusM: z.number().int().min(100).max(500).optional(), active: z.boolean().optional(),
});

async function loadZoneForGuardian(req) {
  const id = parse(uuid, req.params.id);
  const { rows } = await query('SELECT * FROM safe_zones WHERE id = $1', [id]);
  const zone = rows[0];
  if (!zone) throw notFound('Zone not found');
  await requireGuardianOf(req, zone.child_id);
  return zone;
}

router.patch('/:id', requireRole('guardian'), wrap(async (req, res) => {
  const zone = await loadZoneForGuardian(req);
  const b = parse(patchSchema, req.body);
  const moved = b.lat !== undefined || b.lng !== undefined || b.radiusM !== undefined || b.active === true;
  const { rows } = await withTransaction(async (c) => {
    const r = await c.query(
      `UPDATE safe_zones SET name = coalesce($2, name), center_lat = coalesce($3, center_lat), center_lng = coalesce($4, center_lng),
         radius_m = coalesce($5, radius_m), active = coalesce($6, active), updated_at = now() WHERE id = $1 RETURNING *`,
      [zone.id, b.name ?? null, b.lat ?? null, b.lng ?? null, b.radiusM ?? null, b.active ?? null],
    );
    // A changed shape invalidates what we knew, so start from a fresh baseline instead of firing a false alert.
    if (moved) await c.query('DELETE FROM zone_states WHERE zone_id = $1', [zone.id]);
    return r;
  });
  await notify({ recipientId: zone.child_id, kind: 'system', title: 'A safe zone was changed', body: `${req.user.full_name} changed the zone "${rows[0].name}".`, dedupeKey: `zonechg:${zone.id}:${Date.now()}` });
  await audit(req, 'zone.update', { targetType: 'zone', targetId: zone.id });
  res.json(zoneShape(rows[0]));
}));

router.delete('/:id', requireRole('guardian'), wrap(async (req, res) => {
  const zone = await loadZoneForGuardian(req);
  await query('DELETE FROM safe_zones WHERE id = $1', [zone.id]);
  await notify({ recipientId: zone.child_id, kind: 'system', title: 'A safe zone was removed', body: `${req.user.full_name} removed the zone "${zone.name}".`, dedupeKey: `zonedel:${zone.id}` });
  await audit(req, 'zone.delete', { targetType: 'zone', targetId: zone.id });
  res.json({ ok: true });
}));

// ---- Device readings -------------------------------------------------------------------------
// The child's device decides locally whether it is inside or outside each zone and sends ONLY that
// boolean plus the GPS accuracy. Raw coordinates never leave the phone for geofencing.

const readingsSchema = z.object({
  readings: z.array(z.object({ zoneId: uuid, inside: z.boolean(), accuracyM: z.number().min(0).max(100000) })).min(1).max(20),
});

export async function processReading(client, zone, inside, accuracyM) {
  if (accuracyM > config.maxAccuracyM) return { zoneId: zone.id, result: 'ignored_low_accuracy' };
  const state = inside ? 'inside' : 'outside';
  await client.query('INSERT INTO zone_states (zone_id, child_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [zone.id, zone.child_id]);
  const { rows } = await client.query('SELECT * FROM zone_states WHERE zone_id = $1 FOR UPDATE', [zone.id]);
  const s = rows[0];

  // First reading ever: becomes the baseline. We do not alert about where the child already was.
  if (!s.confirmed_state) {
    await client.query(`UPDATE zone_states SET confirmed_state = $2, confirmed_at = now() WHERE zone_id = $1`, [zone.id, state]);
    return { zoneId: zone.id, result: 'baseline', state };
  }
  if (s.confirmed_state === state) {
    if (s.cand_state) await client.query('UPDATE zone_states SET cand_state = NULL, cand_count = 0, cand_first_at = NULL WHERE zone_id = $1', [zone.id]);
    return { zoneId: zone.id, result: 'unchanged', state };
  }

  // The reading differs from the confirmed state. Require several consistent readings over time.
  const fresh = s.cand_state === state && s.cand_first_at && (Date.now() - new Date(s.cand_first_at).getTime()) / 1000 <= config.confirmMaxSeconds;
  const count = fresh ? s.cand_count + 1 : 1;
  const firstAt = fresh ? s.cand_first_at : new Date();
  const elapsed = (Date.now() - new Date(firstAt).getTime()) / 1000;
  if (count < config.confirmReadings || elapsed < config.confirmMinSeconds) {
    await client.query('UPDATE zone_states SET cand_state = $2, cand_count = $3, cand_first_at = $4 WHERE zone_id = $1', [zone.id, state, count, firstAt]);
    return { zoneId: zone.id, result: 'pending', state: s.confirmed_state, readings: count };
  }

  // Confirmed: record the event, then notify unless a cooldown or the child's sharing choices say otherwise.
  const type = inside ? 'enter' : 'exit';
  await client.query(
    `UPDATE zone_states SET confirmed_state = $2, confirmed_at = now(), cand_state = NULL, cand_count = 0, cand_first_at = NULL WHERE zone_id = $1`,
    [zone.id, state],
  );
  const ev = (await client.query(
    `INSERT INTO location_events (zone_id, child_id, event_type, accuracy_m) VALUES ($1, $2, $3, $4) RETURNING id`,
    [zone.id, zone.child_id, type, Math.round(accuracyM)],
  )).rows[0];
  const cool = await client.query(
    `SELECT 1 FROM location_events WHERE zone_id = $1 AND event_type = $2 AND notified AND id <> $3
     AND occurred_at > now() - ($4 || ' seconds')::interval LIMIT 1`,
    [zone.id, type, ev.id, String(config.cooldownSeconds)],
  );
  let notified = 0;
  if (!cool.rowCount) {
    const sharing = await getSharing(zone.child_id);
    if (sharing.share_zone_events) {
      const child = (await client.query('SELECT full_name FROM users WHERE id = $1', [zone.child_id])).rows[0];
      for (const guardianId of await activeGuardianIds(zone.child_id)) {
        const created = await notify({
          recipientId: guardianId, kind: 'zone', urgent: false,
          title: type === 'enter' ? `${child.full_name} arrived at ${zone.name}` : `${child.full_name} left ${zone.name}`,
          body: `Routine zone alert. ${child.full_name}'s phone reported ${type === 'enter' ? 'entering' : 'leaving'} the safe zone "${zone.name}" (${zone.radius_m} m radius), and ${config.confirmReadings} consistent readings confirmed it. This is not an emergency and does not mean anything is wrong.`,
          sourceType: 'location_event', sourceId: ev.id, dedupeKey: `zone:${ev.id}`,
        }, client);
        if (created) notified += 1;
      }
    }
  }
  if (notified > 0) await client.query('UPDATE location_events SET notified = true WHERE id = $1', [ev.id]);
  return { zoneId: zone.id, result: 'confirmed', event: type, state, notifiedGuardians: notified };
}

router.post('/readings', requireRole('child'), wrap(async (req, res) => {
  const { readings } = parse(readingsSchema, req.body);
  const out = [];
  for (const r of readings) {
    const { rows } = await query('SELECT * FROM safe_zones WHERE id = $1 AND child_id = $2 AND active', [r.zoneId, req.user.id]);
    if (!rows[0]) { out.push({ zoneId: r.zoneId, result: 'unknown_zone' }); continue; }
    out.push(await withTransaction((c) => processReading(c, rows[0], r.inside, r.accuracyM)));
  }
  res.json({ results: out });
}));

// Recent validated enter/exit events (no coordinates).
router.get('/events/recent', wrap(async (req, res) => {
  if (req.user.role === 'admin') throw forbidden('Administrators cannot view location data', 'wrong_role');
  const childId = req.user.role === 'child' ? req.user.id : parse(uuid, req.query.childId);
  await authorizeChildData(req.user, childId, 'zones');
  const { rows } = await query(
    `SELECT e.id, e.event_type, e.occurred_at, e.accuracy_m, e.notified, z.name AS zone_name
     FROM location_events e JOIN safe_zones z ON z.id = e.zone_id WHERE e.child_id = $1 ORDER BY e.occurred_at DESC LIMIT 50`,
    [childId],
  );
  if (req.user.role === 'guardian') await audit(req, 'events.view', { targetType: 'user', targetId: childId, dedupeMinutes: 10 });
  res.json(rows.map((r) => ({ id: r.id, type: r.event_type, zoneName: r.zone_name, occurredAt: r.occurred_at, accuracyM: r.accuracy_m, notified: r.notified })));
}));

export default router;
