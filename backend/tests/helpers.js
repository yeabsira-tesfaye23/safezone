import { randomUUID } from 'node:crypto';
import { createApp } from '../src/app.js';
import { pool, query } from '../src/db.js';
import { migrate } from '../src/migrate.js';

export const PASSWORD = 'Correct-Horse-Battery-9';

export async function startServer() {
  await migrate();
  await query(`TRUNCATE users, audit_logs RESTART IDENTITY CASCADE`);
  const server = await new Promise((resolve) => { const s = createApp().listen(0, () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, close: () => new Promise((r) => server.close(() => pool.end().then(r))) };
}

// A tiny API client that keeps its own cookies and access token, like a browser tab would.
export class Client {
  constructor(base) { this.base = base; this.token = null; this.cookies = new Map(); this.deviceId = randomUUID(); }

  async call(method, path, body, { auth = true, headers = {} } = {}) {
    const h = { 'content-type': 'application/json', 'x-device-id': this.deviceId, ...headers };
    if (auth && this.token) h.authorization = `Bearer ${this.token}`;
    if (this.cookies.size) h.cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    const res = await fetch(this.base + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' });
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const [pair] = c.split(';');
      const [k, ...v] = pair.split('=');
      if (/max-age=0|expires=thu, 01 jan 1970/i.test(c) || v.join('=') === '') this.cookies.delete(k); else this.cookies.set(k, v.join('='));
    }
    let json = null;
    try { json = await res.json(); } catch { /* empty body */ }
    return { status: res.status, body: json, headers: res.headers };
  }
  get = (p, o) => this.call('GET', p, undefined, o);
  post = (p, b, o) => this.call('POST', p, b ?? {}, o);
  put = (p, b, o) => this.call('PUT', p, b, o);
  patch = (p, b, o) => this.call('PATCH', p, b, o);
  del = (p, b, o) => this.call('DELETE', p, b, o);
}

let counter = 0;
export async function registerUser(base, role, name) {
  const c = new Client(base);
  counter += 1;
  const email = `${role}${counter}-${randomUUID().slice(0, 6)}@example.test`;
  const body = { email, password: PASSWORD, fullName: name ?? `${role} ${counter}`, role, acceptedPrivacyNotice: true };
  if (role === 'child') body.dateOfBirth = '2012-03-04';
  const r = await c.post('/api/auth/register', body, { auth: false });
  if (r.status !== 201) throw new Error(`register failed: ${r.status} ${JSON.stringify(r.body)}`);
  c.token = r.body.accessToken;
  c.user = r.body.user;
  c.email = email;
  return c;
}

export async function makeAdmin(base) {
  const c = new Client(base);
  const email = `admin-${randomUUID().slice(0, 6)}@example.test`;
  const { hashPassword } = await import('../src/lib/password.js');
  const { rows } = await query(`INSERT INTO users (role, email, full_name, password_hash) VALUES ('admin', $1, 'Admin', $2) RETURNING id`, [email, await hashPassword(PASSWORD)]);
  const r = await c.post('/api/auth/login', { email, password: PASSWORD }, { auth: false });
  c.token = r.body.accessToken;
  c.user = { id: rows[0].id, role: 'admin' };
  return c;
}

// Connect a guardian to a child through the real consent flow.
export async function linkUp(guardian, child) {
  await guardian.post('/api/links', { email: child.email });
  const pending = (await child.get('/api/links')).body.find((l) => l.canRespond);
  await child.post(`/api/links/${pending.id}/accept`);
  return pending.id;
}
