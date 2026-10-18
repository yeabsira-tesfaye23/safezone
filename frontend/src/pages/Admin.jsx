import { useState } from 'react';
import { Banner, ErrorNote, Field, Loading, Pill, useAction, useAsync, usePageTitle } from '../components/ui.jsx';
import { get, patch } from '../lib/api.js';
import { categoryLabel, fmtTime } from '../lib/format.js';

const TABS = [['overview', 'Overview'], ['users', 'Accounts'], ['reports', 'Incident reports'], ['signals', 'Misuse signals'], ['audit', 'Audit log']];

export default function Admin() {
  usePageTitle('Administrator');
  const [tab, setTab] = useState('overview');
  return (
    <div className="stack">
      <h1>Administrator dashboard</h1>
      <Banner kind="info" title="By design:">Administrators manage accounts, review incident reports and watch for misuse. Administrators cannot see any child's location, zone events or SOS coordinates. Every report you open is recorded in the audit log.</Banner>
      <div className="tabs" role="tablist" aria-label="Administrator sections">
        {TABS.map(([k, label]) => <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{label}</button>)}
      </div>
      {tab === 'overview' && <Overview />}
      {tab === 'users' && <Users />}
      {tab === 'reports' && <Reports />}
      {tab === 'signals' && <Signals />}
      {tab === 'audit' && <Audit />}
    </div>
  );
}

function Overview() {
  const s = useAsync(() => get('/admin/stats'), []);
  if (s.loading) return <Loading />;
  const count = (rows, f) => rows.filter(f).reduce((a, r) => a + r.n, 0);
  const d = s.data;
  const cards = [
    ['Active children', count(d.users, (r) => r.role === 'child' && r.status === 'active')],
    ['Active guardians', count(d.users, (r) => r.role === 'guardian' && r.status === 'active')],
    ['Reports waiting', count(d.reports, (r) => r.status === 'submitted')],
    ['Reports in review', count(d.reports, (r) => r.status === 'in_review')],
    ['SOS alerts (30 days)', d.sosLast30Days],
    ['Active connections', count(d.links, (r) => r.status === 'active')],
  ];
  return <div className="grid two">{cards.map(([label, n]) => <div className="card" key={label}><div className="stat">{n}</div><div>{label}</div></div>)}</div>;
}

function Users() {
  const [q, setQ] = useState('');
  const [role, setRole] = useState('');
  const users = useAsync(() => get(`/admin/users?${new URLSearchParams({ ...(q && { q }), ...(role && { role }) })}`), [q, role]);
  const act = useAction();
  const update = (id, body) => act.run(async () => { await patch(`/admin/users/${id}`, body); users.reload(); });
  return (
    <section className="card stack">
      <div className="row">
        <div style={{ flex: 1, minWidth: 200 }}><label htmlFor="sq">Search name or email</label><input id="sq" type="search" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <div><label htmlFor="sr">Role</label><select id="sr" value={role} onChange={(e) => setRole(e.target.value)}><option value="">All</option><option value="child">Child</option><option value="guardian">Guardian</option><option value="admin">Admin</option></select></div>
      </div>
      <ErrorNote error={act.error} />
      {users.loading ? <Loading /> : (
        <div className="table-wrap"><table>
          <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Joined</th><th>Actions</th></tr></thead>
          <tbody>{users.data.items.map((u) => (
            <tr key={u.id}>
              <td>{u.fullName}</td><td>{u.email}</td><td>{u.role}{u.role === 'guardian' && (u.guardianVerified ? ' ✓ verified' : ' (unverified)')}</td>
              <td><Pill kind={u.status === 'active' ? 'ok' : 'warn'}>{u.status}</Pill></td><td>{fmtTime(u.createdAt)}</td>
              <td className="row">
                {u.role === 'guardian' && <button className="small secondary" onClick={() => update(u.id, { guardianVerified: !u.guardianVerified })}>{u.guardianVerified ? 'Remove verification' : 'Verify guardian'}</button>}
                {u.role !== 'admin' && (u.status === 'active'
                  ? <button className="small danger outline" onClick={() => { if (window.confirm(`Suspend ${u.fullName}? They are signed out and their connections end.`)) update(u.id, { status: 'suspended' }); }}>Suspend</button>
                  : <button className="small secondary" onClick={() => update(u.id, { status: 'active' })}>Reactivate</button>)}
              </td>
            </tr>))}</tbody>
        </table></div>
      )}
    </section>
  );
}

function Reports() {
  const [status, setStatus] = useState('');
  const list = useAsync(() => get(`/admin/reports${status ? `?status=${status}` : ''}`), [status]);
  const [open, setOpen] = useState(null);
  const [detail, setDetail] = useState(null);
  const [note, setNote] = useState('');
  const act = useAction();

  const view = (id) => act.run(async () => { const d = await get(`/admin/reports/${id}`); setDetail(d); setNote(d.adminNote || ''); setOpen(id); });
  const setStatusFor = (st) => act.run(async () => { await patch(`/admin/reports/${open}`, { status: st, ...(note ? { note } : {}) }); setOpen(null); setDetail(null); list.reload(); });

  return (
    <section className="card stack">
      <div><label htmlFor="rs">Show</label><select id="rs" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All</option><option value="submitted">Waiting</option><option value="in_review">In review</option><option value="closed">Closed</option></select></div>
      <ErrorNote error={act.error} />
      {list.loading ? <Loading /> : list.data.items.length === 0 ? <p className="muted">No reports.</p> : (
        <div className="table-wrap"><table>
          <thead><tr><th>Received</th><th>From</th><th>Category</th><th>Status</th><th>Shown to guardians</th><th /></tr></thead>
          <tbody>{list.data.items.map((r) => (
            <tr key={r.id}><td>{fmtTime(r.createdAt)}</td><td>{r.childName}</td><td>{categoryLabel[r.category]}</td>
              <td><Pill kind={r.status === 'closed' ? 'ok' : r.status === 'in_review' ? 'warn' : 'info'}>{r.status.replace('_', ' ')}</Pill></td>
              <td>{r.visibility === 'admin_and_guardians' ? 'Yes' : 'No'}</td>
              <td><button className="small" onClick={() => view(r.id)}>Open (logged)</button></td></tr>))}</tbody>
        </table></div>
      )}
      {open && detail && (
        <div className="note" role="dialog" aria-modal="false" aria-labelledby="rd-h">
          <h2 id="rd-h">{categoryLabel[detail.category]} · {detail.childName}</h2>
          <p className="small muted">Sent {fmtTime(detail.createdAt)}{detail.occurredAt ? ` · happened ${fmtTime(detail.occurredAt)}` : ''}. Reading this was recorded in the audit log.</p>
          <p style={{ whiteSpace: 'pre-wrap' }}>{detail.description}</p>
          <p className="small muted">SafeZone does not identify or accuse anyone from location data. Treat this as the young person's own account.</p>
          <Field label="Your note (encrypted, visible only to administrators)" id="an"><textarea id="an" style={{ minHeight: 90 }} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
          <div className="row"><button className="small" onClick={() => setStatusFor('in_review')}>Mark in review</button><button className="small" onClick={() => setStatusFor('closed')}>Close report</button><button className="small secondary" onClick={() => { setOpen(null); setDetail(null); }}>Close window</button></div>
        </div>
      )}
    </section>
  );
}

function Signals() {
  const s = useAsync(() => get('/admin/signals'), []);
  return (
    <section className="card stack">
      <p>Guardians whose connections are often paused or ended by the young person. This can point to controlling behaviour. It is a prompt to look closer, not proof. No locations are shown.</p>
      {s.loading ? <Loading /> : s.data.length === 0 ? <p className="muted">No signals right now.</p> : (
        <div className="table-wrap"><table>
          <thead><tr><th>Guardian</th><th>Paused now</th><th>Ended (30 days)</th><th>Total links</th><th>Reasons given by children</th></tr></thead>
          <tbody>{s.data.map((g) => <tr key={g.guardianId}><td>{g.fullName}<br /><span className="muted small">{g.email}</span></td><td>{g.pausedNow}</td><td>{g.endedLast30Days}</td><td>{g.totalLinks}</td><td>{g.pauseReasons.length ? <ul style={{ margin: 0, paddingLeft: '1.1rem' }}>{g.pauseReasons.map((r, i) => <li key={i}>{r}</li>)}</ul> : '—'}</td></tr>)}</tbody>
        </table></div>
      )}
    </section>
  );
}

function Audit() {
  const [page, setPage] = useState(1);
  const [action, setAction] = useState('');
  const a = useAsync(() => get(`/admin/audit?page=${page}${action ? `&action=${encodeURIComponent(action)}` : ''}`), [page, action]);
  return (
    <section className="card stack">
      <div className="row">
        <div><label htmlFor="aa">Filter by action</label><select id="aa" value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }}>
          <option value="">All</option>
          {['auth.login', 'auth.login_failed', 'auth.locked', 'report.read', 'report.review', 'sos.view', 'checkin.view', 'zones.view', 'events.view', 'link.pause', 'link.revoke', 'admin.user_update', 'sharing.update', 'account.data_delete'].map((x) => <option key={x}>{x}</option>)}
        </select></div>
      </div>
      {a.loading ? <Loading /> : (
        <div className="table-wrap"><table>
          <thead><tr><th>Time</th><th>Who</th><th>Action</th><th>Target</th><th>IP</th></tr></thead>
          <tbody>{a.data.items.map((r) => <tr key={r.id}><td>{fmtTime(r.createdAt)}</td><td>{r.actorName ?? '—'} <span className="muted small">{r.actorRole}</span></td><td>{r.action}</td><td className="small">{r.targetType ? `${r.targetType} ${String(r.targetId ?? '').slice(0, 8)}` : ''}</td><td className="small">{r.ip}</td></tr>)}</tbody>
        </table></div>
      )}
      <div className="row"><button className="small secondary" disabled={page === 1} onClick={() => setPage(page - 1)}>Newer</button><span>Page {page}</span><button className="small secondary" disabled={a.data && a.data.items.length < 50} onClick={() => setPage(page + 1)}>Older</button></div>
    </section>
  );
}
