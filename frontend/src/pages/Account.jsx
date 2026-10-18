import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { Banner, ErrorNote, Field, Loading, Pill, useAction, useAsync, usePageTitle } from '../components/ui.jsx';
import { del, get, post } from '../lib/api.js';

export default function Account() {
  usePageTitle('Account');
  const { user, endSession } = useAuth();
  const navigate = useNavigate();
  const links = useAsync(() => (user.role === 'guardian' ? get('/links') : Promise.resolve([])), [user.role]);
  const pw = useAction();
  const dead = useAction();
  const wipe = useAction();
  const conn = useAction();
  const [form, setForm] = useState({ currentPassword: '', newPassword: '' });
  const [changed, setChanged] = useState(false);
  const [deactPw, setDeactPw] = useState('');
  const [wipePw, setWipePw] = useState('');
  const [wiped, setWiped] = useState(null);

  return (
    <div className="stack">
      <h1>Account</h1>
      <section className="card"><h2>You</h2><p><strong>{user.fullName}</strong><br />{user.email} · {user.role}{user.role === 'guardian' && <> · {user.guardianVerified ? <Pill kind="ok">verified</Pill> : <Pill>not verified</Pill>}</>}</p></section>

      {user.role === 'guardian' && (
        <section className="card stack" aria-labelledby="cn-h">
          <h2 id="cn-h">My connections</h2>
          <ErrorNote error={conn.error} />
          {links.loading ? <Loading /> : links.data.length === 0 ? <p className="muted">No connections.</p> : (
            <ul className="list">
              {links.data.map((l) => (
                <li key={l.id} className="row between">
                  <span><strong>{l.other.name}</strong> <Pill kind={l.status === 'active' ? 'ok' : l.status === 'paused' ? 'warn' : 'info'}>{l.status}</Pill></span>
                  <button className="small danger outline" onClick={() => { if (window.confirm(`End your connection with ${l.other.name}? You will stop receiving anything about her.`)) conn.run(async () => { await post(`/links/${l.id}/revoke`); links.reload(); }); }}>End connection</button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section className="card" aria-labelledby="pw-h">
        <h2 id="pw-h">Change password</h2>
        <form onSubmit={(e) => { e.preventDefault(); pw.run(async () => { await post('/me/change-password', form); setChanged(true); setTimeout(() => { endSession(); navigate('/login'); }, 1500); }); }}>
          <ErrorNote error={pw.error} />
          {changed && <Banner kind="ok" live>Password changed. All sessions were signed out. Redirecting to sign in…</Banner>}
          <Field label="Current password" id="cp"><input id="cp" type="password" autoComplete="current-password" required value={form.currentPassword} onChange={(e) => setForm({ ...form, currentPassword: e.target.value })} /></Field>
          <Field label="New password" id="np" hint="At least 10 characters."><input id="np" type="password" autoComplete="new-password" required minLength={10} value={form.newPassword} onChange={(e) => setForm({ ...form, newPassword: e.target.value })} /></Field>
          <button type="submit" disabled={pw.busy}>Change password</button>
        </form>
      </section>

      {user.role !== 'admin' && (
        <section className="card" aria-labelledby="wipe-h">
          <h2 id="wipe-h">Delete my stored data</h2>
          <p>{user.role === 'child' ? 'Deletes your zone events, SOS alerts, shared locations and alerts now. Incident reports that are still being reviewed are kept until the review is finished, then deleted automatically.' : 'Deletes your alerts and notices now.'} Your account stays active.</p>
          <form onSubmit={(e) => { e.preventDefault(); wipe.run(async () => { const r = await del('/me/data', { password: wipePw }); setWiped(r.deleted); setWipePw(''); }); }}>
            <ErrorNote error={wipe.error} />
            {wiped && <Banner kind="ok" live title="Deleted:">{Object.entries(wiped).map(([k, v]) => `${k}: ${v}`).join(' · ')}</Banner>}
            <Field label="Confirm with your password" id="wp"><input id="wp" type="password" autoComplete="current-password" required value={wipePw} onChange={(e) => setWipePw(e.target.value)} /></Field>
            <button type="submit" className="danger outline" disabled={wipe.busy}>Delete my data</button>
          </form>
        </section>
      )}

      <section className="card" aria-labelledby="de-h">
        <h2 id="de-h">Deactivate account</h2>
        <p>You will be signed out everywhere, all connections end, and your personal details are removed after 30 days.</p>
        <form onSubmit={(e) => { e.preventDefault(); if (!window.confirm('Deactivate your account?')) return; dead.run(async () => { await post('/me/deactivate', { password: deactPw }); endSession(); navigate('/login'); }); }}>
          <ErrorNote error={dead.error} />
          <Field label="Confirm with your password" id="dp"><input id="dp" type="password" autoComplete="current-password" required value={deactPw} onChange={(e) => setDeactPw(e.target.value)} /></Field>
          <button type="submit" className="danger" disabled={dead.busy}>Deactivate my account</button>
        </form>
      </section>
    </div>
  );
}
