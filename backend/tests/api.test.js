import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { randomUUID } from 'node:crypto';
import { query } from '../src/db.js';
import { runRetention } from '../src/jobs/retention.js';
import { outbox } from '../src/lib/mail.js';
import { Client, PASSWORD, linkUp, makeAdmin, registerUser, startServer } from './helpers.js';

let srv;
before(async () => { srv = await startServer(); });
after(async () => { await srv.close(); });

describe('authentication', () => {
  it('registers, logs in, and never returns the password hash', async () => {
    const c = await registerUser(srv.base, 'guardian', 'Grace Guardian');
    const me = await c.get('/api/me');
    assert.equal(me.status, 200);
    assert.equal(me.body.role, 'guardian');
    assert.equal(JSON.stringify(me.body).includes('password'), false);
    const login = await new Client(srv.base).post('/api/auth/login', { email: c.email, password: PASSWORD }, { auth: false });
    assert.equal(login.status, 200);
  });

  it('stores passwords hashed, not in plain text', async () => {
    const c = await registerUser(srv.base, 'guardian');
    const { rows } = await query('SELECT password_hash FROM users WHERE id = $1', [c.user.id]);
    assert.match(rows[0].password_hash, /^\$2[aby]\$12\$/);
    assert.notEqual(rows[0].password_hash, PASSWORD);
  });

  it('rejects weak passwords, adults as children, and missing consent', async () => {
    const c = new Client(srv.base);
    const base = { email: `w-${randomUUID().slice(0, 6)}@example.test`, fullName: 'Weak Pw', role: 'guardian', acceptedPrivacyNotice: true };
    assert.equal((await c.post('/api/auth/register', { ...base, password: 'short' }, { auth: false })).status, 400);
    assert.equal((await c.post('/api/auth/register', { ...base, password: 'password1234' }, { auth: false })).status, 400);
    assert.equal((await c.post('/api/auth/register', { ...base, password: PASSWORD, acceptedPrivacyNotice: false }, { auth: false })).status, 400);
    const adult = await c.post('/api/auth/register', { ...base, role: 'child', dateOfBirth: '1990-01-01', password: PASSWORD }, { auth: false });
    assert.equal(adult.status, 400);
    assert.equal(adult.body.code, 'not_a_minor');
  });

  it('locks the account after repeated failures and gives the same error for unknown emails', async () => {
    const c = await registerUser(srv.base, 'guardian');
    const anon = new Client(srv.base);
    const unknown = await anon.post('/api/auth/login', { email: 'nobody@example.test', password: 'whatever-123' }, { auth: false });
    const wrong = await anon.post('/api/auth/login', { email: c.email, password: 'wrong-password-1' }, { auth: false });
    assert.equal(unknown.status, 401);
    assert.equal(wrong.status, 401);
    assert.equal(unknown.body.error, wrong.body.error);
    for (let i = 0; i < 5; i += 1) await anon.post('/api/auth/login', { email: c.email, password: 'wrong-password-1' }, { auth: false });
    const locked = await anon.post('/api/auth/login', { email: c.email, password: PASSWORD }, { auth: false });
    assert.equal(locked.status, 429);
  });

  it('rotates refresh tokens and revokes everything if an old one is replayed', async () => {
    const c = new Client(srv.base);
    const email = `r-${randomUUID().slice(0, 6)}@example.test`;
    await c.post('/api/auth/register', { email, password: PASSWORD, fullName: 'Rota Tion', role: 'guardian', acceptedPrivacyNotice: true }, { auth: false });
    const old = c.cookies.get('sz_refresh');
    const noHeader = await c.post('/api/auth/refresh', {}, { auth: false });
    assert.equal(noHeader.status, 403); // CSRF guard
    const r1 = await c.post('/api/auth/refresh', {}, { auth: false, headers: { 'x-requested-with': 'safezone' } });
    assert.equal(r1.status, 200);
    assert.notEqual(c.cookies.get('sz_refresh'), old);
    const thief = new Client(srv.base);
    thief.cookies.set('sz_refresh', old);
    const replay = await thief.post('/api/auth/refresh', {}, { auth: false, headers: { 'x-requested-with': 'safezone' } });
    assert.equal(replay.status, 401);
    const after = await c.post('/api/auth/refresh', {}, { auth: false, headers: { 'x-requested-with': 'safezone' } });
    assert.equal(after.status, 401); // the whole token family was revoked
  });

  it('supports password recovery without revealing whether an email exists', async () => {
    const c = await registerUser(srv.base, 'guardian');
    const anon = new Client(srv.base);
    const a = await anon.post('/api/auth/forgot-password', { email: c.email }, { auth: false });
    const b = await anon.post('/api/auth/forgot-password', { email: 'ghost@example.test' }, { auth: false });
    assert.deepEqual(a.body, b.body);
    const mail = outbox.filter((m) => m.to === c.email).at(-1);
    const token = mail.text.match(/token=([\w-]+)/)[1];
    const newPassword = 'Another-Strong-Pass-77';
    assert.equal((await anon.post('/api/auth/reset-password', { token, newPassword }, { auth: false })).status, 200);
    assert.equal((await anon.post('/api/auth/reset-password', { token, newPassword }, { auth: false })).status, 400); // single use
    assert.equal((await anon.post('/api/auth/login', { email: c.email, password: newPassword }, { auth: false })).status, 200);
  });

  it('deactivation blocks sign-in immediately', async () => {
    const c = await registerUser(srv.base, 'guardian');
    assert.equal((await c.post('/api/me/deactivate', { password: PASSWORD })).status, 200);
    assert.equal((await c.get('/api/me')).status, 403);
    assert.equal((await new Client(srv.base).post('/api/auth/login', { email: c.email, password: PASSWORD }, { auth: false })).status, 403);
  });
});

describe('roles, consent and links', () => {
  it('rejects requests without a token and enforces role boundaries', async () => {
    assert.equal((await new Client(srv.base).get('/api/me')).status, 401);
    const child = await registerUser(srv.base, 'child');
    const guardian = await registerUser(srv.base, 'guardian');
    const admin = await makeAdmin(srv.base);
    assert.equal((await child.post('/api/zones', { childId: child.user.id, name: 'x', lat: 1, lng: 1, radiusM: 200 })).status, 403);
    assert.equal((await guardian.post('/api/sos', { clientId: randomUUID() })).status, 403);
    assert.equal((await guardian.get('/api/admin/stats')).status, 403);
    assert.equal((await child.get('/api/admin/users')).status, 403);
    assert.equal((await admin.get('/api/zones')).status, 403);
    assert.equal((await admin.get('/api/sos')).status, 403);
    assert.equal((await admin.get(`/api/checkins/latest?childId=${child.user.id}`)).status, 403);
  });

  it('a guardian sees nothing until the child consents', async () => {
    const child = await registerUser(srv.base, 'child', 'Chloe');
    const guardian = await registerUser(srv.base, 'guardian');
    const unlinked = await guardian.get(`/api/zones?childId=${child.user.id}`);
    assert.equal(unlinked.status, 403);
    const req = await guardian.post('/api/links', { email: child.email });
    assert.equal(req.status, 202);
    assert.equal((await guardian.get(`/api/zones?childId=${child.user.id}`)).status, 403); // still pending
    const link = (await child.get('/api/links')).body[0];
    assert.equal(link.canRespond, true);
    assert.equal((await guardian.post(`/api/links/${link.id}/accept`)).status, 403); // guardian cannot self-accept
    assert.equal((await child.post(`/api/links/${link.id}/accept`)).status, 200);
    assert.equal((await guardian.get(`/api/zones?childId=${child.user.id}`)).status, 200);
  });

  it('linking cannot be used to discover which emails belong to children', async () => {
    const guardian = await registerUser(srv.base, 'guardian');
    const real = await registerUser(srv.base, 'child');
    const a = await guardian.post('/api/links', { email: real.email });
    const b = await guardian.post('/api/links', { email: 'nobody-here@example.test' });
    assert.deepEqual(a.body, b.body);
    assert.equal(a.status, b.status);
  });

  it('a guardian cannot see a different child, even with a valid link to another', async () => {
    const g = await registerUser(srv.base, 'guardian');
    const mine = await registerUser(srv.base, 'child');
    const other = await registerUser(srv.base, 'child');
    await linkUp(g, mine);
    assert.equal((await g.get(`/api/zones?childId=${mine.user.id}`)).status, 200);
    assert.equal((await g.get(`/api/zones?childId=${other.user.id}`)).status, 403);
    assert.equal((await g.get(`/api/zones/events/recent?childId=${other.user.id}`)).status, 403);
    assert.equal((await g.post('/api/zones', { childId: other.user.id, name: 'Sneaky', lat: 9, lng: 42, radiusM: 100 })).status, 403);
  });

  it('pausing stops alerts, hides the reason from the guardian and tells the guardian', async () => {
    const g = await registerUser(srv.base, 'guardian');
    const c = await registerUser(srv.base, 'child', 'Pia');
    const linkId = await linkUp(g, c);
    assert.equal((await c.post(`/api/links/${linkId}/pause`, { reason: 'I want some privacy' })).status, 200);
    const gl = (await g.get('/api/links')).body[0];
    assert.equal(gl.status, 'paused');
    assert.equal(gl.pausedReason, undefined);
    assert.equal((await g.get(`/api/zones?childId=${c.user.id}`)).status, 403);
    const notes = (await g.get('/api/notifications')).body.items;
    assert.ok(notes.some((n) => n.title === 'Sharing paused'));
    assert.equal(JSON.stringify(notes).includes('privacy'), false);
    assert.equal((await c.post(`/api/links/${linkId}/resume`)).status, 200);
    assert.equal((await g.get(`/api/zones?childId=${c.user.id}`)).status, 200);
  });

  it('either side can end a connection, and the other is told', async () => {
    const g = await registerUser(srv.base, 'guardian');
    const c = await registerUser(srv.base, 'child');
    const linkId = await linkUp(g, c);
    assert.equal((await c.post(`/api/links/${linkId}/revoke`)).status, 200);
    assert.equal((await g.get(`/api/zones?childId=${c.user.id}`)).status, 403);
    assert.ok((await g.get('/api/notifications')).body.items.some((n) => n.title === 'Connection ended'));
  });
});

describe('safe zones and geofence validation', () => {
  async function setup(name = 'Gina') {
    const g = await registerUser(srv.base, 'guardian', name);
    const c = await registerUser(srv.base, 'child', 'Kid ' + name);
    await linkUp(g, c);
    const zone = (await g.post('/api/zones', { childId: c.user.id, name: 'School', lat: 9.4167, lng: 42.0333, radiusM: 200 })).body;
    return { g, c, zone };
  }
  const reading = (c, zone, inside, accuracyM = 20) => c.post('/api/zones/readings', { readings: [{ zoneId: zone.id, inside, accuracyM }] });
  const result = async (c, zone, inside, acc) => (await reading(c, zone, inside, acc)).body.results[0];
  const zoneAlerts = async (g) => (await g.get('/api/notifications')).body.items.filter((n) => n.kind === 'zone');

  it('validates zone input and tells the child about new zones', async () => {
    const { g, c } = await setup('Zoe');
    assert.equal((await g.post('/api/zones', { childId: c.user.id, name: 'Too big', lat: 9, lng: 42, radiusM: 5000 })).status, 400);
    assert.equal((await g.post('/api/zones', { childId: c.user.id, name: 'Bad lat', lat: 99, lng: 42, radiusM: 200 })).status, 400);
    assert.ok((await c.get('/api/notifications')).body.items.some((n) => n.title === 'A safe zone was added'));
  });

  it('ignores low-accuracy readings, uses the first reading as a baseline, and needs confirmation', async () => {
    const { g, c, zone } = await setup('Gabe');
    assert.equal((await result(c, zone, true, 500)).result, 'ignored_low_accuracy');
    assert.equal((await result(c, zone, false)).result, 'baseline'); // no alert for where she already was
    assert.equal((await result(c, zone, true)).result, 'pending'); // one reading is not enough
    assert.equal((await zoneAlerts(g)).length, 0);
    const confirmed = await result(c, zone, true);
    assert.equal(confirmed.result, 'confirmed');
    assert.equal(confirmed.event, 'enter');
    const alerts = await zoneAlerts(g);
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].urgent, false);
    assert.match(alerts[0].body, /not an emergency/);
    assert.equal(alerts[0].deliveryStatus, 'delivered_in_app');
  });

  it('a GPS blip that reverts does not alert anyone', async () => {
    const { g, c, zone } = await setup('Gwen');
    await result(c, zone, false);
    assert.equal((await result(c, zone, true)).result, 'pending');
    assert.equal((await result(c, zone, false)).result, 'unchanged'); // candidate cleared
    assert.equal((await result(c, zone, true)).result, 'pending'); // starts over
    assert.equal((await zoneAlerts(g)).length, 0);
  });

  it('suppresses repeated alerts inside the cooldown and never duplicates a notification', async () => {
    const { g, c, zone } = await setup('Gil');
    await result(c, zone, false);
    await result(c, zone, true); await result(c, zone, true); // enter (alert 1)
    await result(c, zone, false); await result(c, zone, false); // exit (alert 2)
    await result(c, zone, true); const again = await result(c, zone, true); // enter again within the cooldown
    assert.equal(again.result, 'confirmed');
    assert.equal(again.notifiedGuardians, 0);
    assert.equal((await zoneAlerts(g)).length, 2);
    const events = (await c.get('/api/zones/events/recent')).body;
    assert.equal(events.length, 3);
    assert.equal(events.filter((e) => e.notified).length, 2);
  });

  it('respects the child\'s sharing switch and never sends coordinates in events', async () => {
    const { g, c, zone } = await setup('Gus');
    await c.put('/api/me/sharing', { shareZoneEvents: false, shareSosLocation: true });
    await result(c, zone, false); await result(c, zone, true); await result(c, zone, true);
    assert.equal((await zoneAlerts(g)).length, 0);
    assert.equal((await g.get(`/api/zones?childId=${c.user.id}`)).body[0].state, undefined); // zones visible, live state hidden
    assert.equal((await g.get(`/api/zones/events/recent?childId=${c.user.id}`)).status, 403);
    await c.put('/api/me/sharing', { shareZoneEvents: true, shareSosLocation: true });
    const events = (await g.get(`/api/zones/events/recent?childId=${c.user.id}`)).body;
    assert.equal(JSON.stringify(events).includes('lat'), false);
  });

  it('a child cannot submit readings for another child\'s zone', async () => {
    const { zone } = await setup('Gia');
    const intruder = await registerUser(srv.base, 'child');
    const r = await result(intruder, zone, true);
    assert.equal(r.result, 'unknown_zone');
  });
});

describe('emergency SOS', () => {
  async function setup() {
    const g = await registerUser(srv.base, 'guardian', 'Sam Guardian');
    const c = await registerUser(srv.base, 'child', 'Sara Child');
    await linkUp(g, c);
    return { g, c };
  }

  it('notifies guardians urgently, records status, and is idempotent for retries', async () => {
    const { g, c } = await setup();
    const clientId = randomUUID();
    const first = await c.post('/api/sos', { clientId, lat: 9.41, lng: 42.03, accuracyM: 15 });
    assert.equal(first.status, 201);
    assert.equal(first.body.status, 'notified');
    assert.equal(first.body.recipientsCount, 1);
    assert.equal(first.body.locationIncluded, true);
    const retry = await c.post('/api/sos', { clientId, lat: 9.41, lng: 42.03 });
    assert.equal(retry.body.duplicate, true);
    assert.equal(retry.body.id, first.body.id);
    const urgent = (await g.get('/api/notifications')).body.items.filter((n) => n.kind === 'sos');
    assert.equal(urgent.length, 1);
    assert.equal(urgent[0].urgent, true);
    assert.equal(/9\.41|42\.03/.test(urgent[0].body), false); // no coordinates in notification text
    assert.equal((await g.get('/api/notifications')).body.urgentUnread, 1);
  });

  it('is honest when nobody could be notified', async () => {
    const lonely = await registerUser(srv.base, 'child');
    const r = await lonely.post('/api/sos', { clientId: randomUUID(), lat: 9, lng: 42 });
    assert.equal(r.status, 201);
    assert.equal(r.body.status, 'no_recipients');
    assert.equal(r.body.recipientsCount, 0);
  });

  it('drops the location when the child turned that off, and still alerts', async () => {
    const { g, c } = await setup();
    await c.put('/api/me/sharing', { shareZoneEvents: true, shareSosLocation: false });
    const r = await c.post('/api/sos', { clientId: randomUUID(), lat: 9.5, lng: 42.1 });
    assert.equal(r.body.locationIncluded, false);
    const detail = await g.get(`/api/sos/${r.body.id}`);
    assert.equal(detail.body.location, null);
    const { rows } = await query('SELECT lat, lng FROM sos_alerts WHERE id = $1', [r.body.id]);
    assert.equal(rows[0].lat, null);
  });

  it('shows the location to authorized guardians only, and audits it', async () => {
    const { g, c } = await setup();
    const sos = await c.post('/api/sos', { clientId: randomUUID(), lat: 9.43, lng: 42.05, accuracyM: 12 });
    const detail = await g.get(`/api/sos/${sos.body.id}`);
    assert.equal(detail.status, 200);
    assert.equal(detail.body.location.lat, 9.43);
    const stranger = await registerUser(srv.base, 'guardian');
    assert.equal((await stranger.get(`/api/sos/${sos.body.id}`)).status, 404);
    const admin = await makeAdmin(srv.base);
    assert.equal((await admin.get(`/api/sos/${sos.body.id}`)).status, 404);
    const { rows } = await query(`SELECT count(*)::int AS n FROM audit_logs WHERE action = 'sos.view' AND target_id = $1`, [sos.body.id]);
    assert.equal(rows[0].n, 1);
    const logged = await query(`SELECT meta FROM audit_logs WHERE target_id = $1`, [sos.body.id]);
    assert.equal(JSON.stringify(logged.rows).includes('9.43'), false); // audit never holds coordinates
  });

  it('lets an emergency contact who is not a linked guardian receive the alert', async () => {
    const c = await registerUser(srv.base, 'child');
    const aunt = await registerUser(srv.base, 'guardian', 'Auntie');
    assert.equal((await c.post('/api/contacts', { displayName: 'Auntie', email: aunt.email })).status, 201);
    const sos = await c.post('/api/sos', { clientId: randomUUID(), lat: 9, lng: 42 });
    assert.equal(sos.body.recipientsCount, 1);
    assert.equal((await aunt.post(`/api/sos/${sos.body.id}/acknowledge`)).status, 200);
    assert.ok((await c.get('/api/notifications')).body.items.some((n) => n.title === 'Someone saw your alert'));
    assert.equal((await c.post(`/api/sos/${sos.body.id}/resolve`)).status, 200);
  });

  it('check-ins are explicit and visible only to linked guardians', async () => {
    const { g, c } = await setup();
    const other = await registerUser(srv.base, 'guardian');
    assert.equal((await g.get(`/api/checkins/latest?childId=${c.user.id}`)).body, null);
    await c.post('/api/checkins', { lat: 9.4, lng: 42.02, accuracyM: 30 });
    assert.equal((await g.get(`/api/checkins/latest?childId=${c.user.id}`)).body.lat, 9.4);
    assert.equal((await other.get(`/api/checkins/latest?childId=${c.user.id}`)).status, 403);
  });
});

describe('incident reports', () => {
  it('encrypts descriptions at rest and limits who can read them', async () => {
    const g = await registerUser(srv.base, 'guardian');
    const c = await registerUser(srv.base, 'child', 'Rita');
    await linkUp(g, c);
    const text = 'Someone followed me home after school on Tuesday.';
    const created = await c.post('/api/reports', { category: 'harassment', description: text });
    assert.equal(created.status, 201);
    const { rows } = await query('SELECT description_enc FROM incident_reports WHERE id = $1', [created.body.id]);
    assert.equal(rows[0].description_enc.includes('followed'), false);
    assert.equal((await c.get('/api/reports')).body[0].description, text);
    assert.equal((await g.get('/api/reports')).body.length, 0); // admin_only by default
    const admin = await makeAdmin(srv.base);
    const list = await admin.get('/api/admin/reports');
    assert.equal(JSON.stringify(list.body).includes('followed'), false); // list shows no content
    const detail = await admin.get(`/api/admin/reports/${created.body.id}`);
    assert.equal(detail.body.description, text);
    const audited = await query(`SELECT 1 FROM audit_logs WHERE action = 'report.read' AND target_id = $1`, [created.body.id]);
    assert.equal(audited.rowCount, 1);
    assert.equal((await g.get(`/api/admin/reports/${created.body.id}`)).status, 403);
    assert.equal((await admin.patch(`/api/admin/reports/${created.body.id}`, { status: 'closed', note: 'Followed up with the school.' })).status, 200);
    assert.ok((await c.get('/api/notifications')).body.items.some((n) => n.title === 'Your report was updated'));
  });

  it('shares with guardians only when the child chooses to', async () => {
    const g = await registerUser(srv.base, 'guardian');
    const c = await registerUser(srv.base, 'child');
    await linkUp(g, c);
    await c.post('/api/reports', { category: 'unsafe_place', description: 'The alley by the shop is dark and men shout there.', shareWithGuardians: true });
    assert.equal((await g.get('/api/reports')).body.length, 1);
  });

  it('rejects empty or oversized reports', async () => {
    const c = await registerUser(srv.base, 'child');
    assert.equal((await c.post('/api/reports', { category: 'harassment', description: 'short' })).status, 400);
    assert.equal((await c.post('/api/reports', { category: 'harassment', description: 'x'.repeat(2500) })).status, 400);
  });
});

describe('privacy, audit and retention', () => {
  it('audit logs are append-only, even for direct SQL', async () => {
    await registerUser(srv.base, 'guardian');
    await assert.rejects(query(`UPDATE audit_logs SET action = 'tampered'`), /append-only/);
    await assert.rejects(query(`DELETE FROM audit_logs`), /retention job/);
  });

  it('the retention job deletes old data and keeps recent data', async () => {
    const g = await registerUser(srv.base, 'guardian');
    const c = await registerUser(srv.base, 'child');
    await linkUp(g, c);
    const zone = (await g.post('/api/zones', { childId: c.user.id, name: 'Home', lat: 9, lng: 42, radiusM: 100 })).body;
    await query(`INSERT INTO location_events (zone_id, child_id, event_type, occurred_at) VALUES ($1, $2, 'enter', now() - interval '40 days'), ($1, $2, 'exit', now())`, [zone.id, c.user.id]);
    await query(`INSERT INTO sos_alerts (child_id, client_id, triggered_at) VALUES ($1, $2, now() - interval '100 days')`, [c.user.id, randomUUID()]);
    await query(`INSERT INTO audit_logs (action, created_at) VALUES ('old.thing', now() - interval '13 months')`);
    const res = await runRetention();
    assert.equal(res.locationEvents, 1);
    assert.equal(res.sosAlerts, 1);
    assert.ok(res.auditLogs >= 1);
    assert.equal((await query('SELECT count(*)::int AS n FROM location_events WHERE child_id = $1', [c.user.id])).rows[0].n, 1);
  });

  it('a child can delete her location data; open reports are kept for review', async () => {
    const g = await registerUser(srv.base, 'guardian');
    const c = await registerUser(srv.base, 'child');
    await linkUp(g, c);
    await c.post('/api/sos', { clientId: randomUUID(), lat: 9, lng: 42 });
    await c.post('/api/checkins', { lat: 9, lng: 42 });
    await c.post('/api/reports', { category: 'other', description: 'This report is still being reviewed.' });
    assert.equal((await c.del('/api/me/data', { password: 'wrong-password-123' })).status, 401);
    const del = await c.del('/api/me/data', { password: PASSWORD });
    assert.equal(del.status, 200);
    assert.equal(del.body.deleted.sosAlerts, 1);
    assert.equal(del.body.deleted.checkins, 1);
    assert.equal(del.body.deleted.reportsKeptForReview, 1);
    assert.equal((await query('SELECT count(*)::int AS n FROM sos_alerts WHERE child_id = $1', [c.user.id])).rows[0].n, 0);
  });

  it('anonymizes deactivated accounts after the grace period', async () => {
    const c = await registerUser(srv.base, 'guardian');
    await c.post('/api/me/deactivate', { password: PASSWORD });
    await query(`UPDATE users SET deactivated_at = now() - interval '40 days' WHERE id = $1`, [c.user.id]);
    const res = await runRetention();
    assert.ok(res.anonymizedUsers >= 1);
    const { rows } = await query('SELECT email, full_name FROM users WHERE id = $1', [c.user.id]);
    assert.match(rows[0].email, /^deleted-/);
    assert.equal(rows[0].full_name, 'Deleted user');
  });

  it('sets security headers, disables caching of API data, and never reveals stack traces', async () => {
    const c = await registerUser(srv.base, 'guardian');
    const r = await c.get('/api/me');
    assert.equal(r.headers.get('cache-control'), 'no-store');
    assert.ok(r.headers.get('content-security-policy'));
    assert.equal(r.headers.get('x-powered-by'), null);
    const bad = await c.get('/api/zones?childId=not-a-uuid');
    assert.equal(bad.status, 400);
    assert.equal(JSON.stringify(bad.body).includes('node_modules'), false);
  });
});

describe('administrator', () => {
  it('manages accounts, sees misuse signals, and cannot manage other admins or itself', async () => {
    const admin = await makeAdmin(srv.base);
    const g = await registerUser(srv.base, 'guardian', 'Controlling G');
    const c = await registerUser(srv.base, 'child');
    const linkId = await linkUp(g, c);
    await c.post(`/api/links/${linkId}/pause`, { reason: 'They check on me all the time' });
    const signals = (await admin.get('/api/admin/signals')).body;
    const mine = signals.find((s) => s.guardianId === g.user.id);
    assert.equal(mine.pausedNow, 1);
    assert.ok(mine.pauseReasons[0].includes('all the time'));
    assert.equal((await admin.patch(`/api/admin/users/${admin.user.id}`, { status: 'suspended' })).status, 400);
    assert.equal((await admin.patch(`/api/admin/users/${g.user.id}`, { status: 'suspended' })).status, 200);
    assert.equal((await g.get('/api/me')).status, 403);
    const users = (await admin.get('/api/admin/users?role=guardian')).body.items;
    assert.ok(users.every((u) => u.role === 'guardian'));
    assert.equal(JSON.stringify(users).includes('password'), false);
    const stats = (await admin.get('/api/admin/stats')).body;
    assert.ok(Array.isArray(stats.users));
  });
});
