import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

// Runs in its own process. Imports are hoisted, so the flag is set first and the app is loaded after it.
process.env.REQUIRE_EMAIL_VERIFICATION = 'true';
const { query } = await import('../src/db.js');
const { outbox } = await import('../src/lib/mail.js');
const { Client, PASSWORD, startServer } = await import('./helpers.js');

let srv;
before(async () => { srv = await startServer(); });
after(async () => { await srv.close(); });

const tokenFrom = (msg) => /token=([A-Za-z0-9_-]+)/.exec(msg.text)[1];

describe('email verification', () => {
  const email = 'verify.me@example.test';
  const body = { email, password: PASSWORD, fullName: 'Vera Fy', role: 'guardian', acceptedPrivacyNotice: true };

  it('creates the account but gives no session until the email is confirmed', async () => {
    const c = new Client(srv.base);
    const r = await c.post('/api/auth/register', body, { auth: false });
    assert.equal(r.status, 201);
    assert.equal(r.body.needsVerification, true);
    assert.equal(r.body.accessToken, undefined);
    assert.equal(c.cookies.size, 0);
    assert.equal(outbox.at(-1).to, email);
  });

  it('refuses sign-in before confirmation, and allows it after', async () => {
    const c = new Client(srv.base);
    const bad = await c.post('/api/auth/login', { email, password: PASSWORD }, { auth: false });
    assert.equal(bad.status, 403);
    assert.equal(bad.body.code, 'email_not_verified');

    const msg = outbox.filter((m) => m.to === email).at(-1);
    const ok = await c.post('/api/auth/verify-email', { token: tokenFrom(msg) }, { auth: false });
    assert.equal(ok.status, 200);
    const again = await c.post('/api/auth/verify-email', { token: tokenFrom(msg) }, { auth: false });
    assert.equal(again.status, 400, 'a link works only once');

    const login = await c.post('/api/auth/login', { email, password: PASSWORD }, { auth: false });
    assert.equal(login.status, 200);
    assert.equal(login.body.user.emailVerified, true);
  });

  it('resend gives the same answer for unknown addresses and sends a fresh link to waiting ones', async () => {
    const c = new Client(srv.base);
    const waiting = { ...body, email: 'waiting@example.test' };
    await c.post('/api/auth/register', waiting, { auth: false });
    const before = outbox.length;
    const unknown = await c.post('/api/auth/resend-verification', { email: 'nobody@example.test' }, { auth: false });
    assert.equal(unknown.status, 200);
    assert.equal(outbox.length, before, 'nothing sent to an unknown address');
    const known = await c.post('/api/auth/resend-verification', { email: waiting.email }, { auth: false });
    assert.equal(known.status, 200);
    assert.equal(outbox.length, before + 1);
    const { rows } = await query('SELECT count(*)::int AS n FROM email_verifications WHERE used_at IS NULL AND user_id = (SELECT id FROM users WHERE email = $1)', [waiting.email]);
    assert.equal(rows[0].n, 1, 'older links are invalidated');
  });
});
