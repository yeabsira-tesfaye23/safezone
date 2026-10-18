import { useState } from 'react';
import { Banner, ErrorNote, Field, Loading, Pill, useAction, useAsync, usePageTitle } from '../components/ui.jsx';
import { del, get, post, put } from '../lib/api.js';
import { fmtTime } from '../lib/format.js';

export default function PrivacySettings() {
  usePageTitle('Privacy & permissions');
  const me = useAsync(() => get('/me'), []);
  const links = useAsync(() => get('/links'), []);
  const contacts = useAsync(() => get('/contacts'), []);
  const act = useAction();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [pauseFor, setPauseFor] = useState(null);
  const [reason, setReason] = useState('');
  const [contact, setContact] = useState({ displayName: '', email: '', phone: '' });

  const sharing = me.data?.sharing;
  const saveSharing = (patch) => act.run(async () => { await put('/me/sharing', { ...sharing, ...patch }); me.reload(); });
  const linkAction = (id, verb, body) => act.run(async () => { await post(`/links/${id}/${verb}`, body); setPauseFor(null); setReason(''); links.reload(); });

  return (
    <div className="stack">
      <h1>Privacy &amp; permissions</h1>
      <p>You are in control. Here you decide who is connected to you and what they can see.</p>
      <ErrorNote error={act.error} />

      <section className="card stack" aria-labelledby="sh-h">
        <h2 id="sh-h">What is shared with connected guardians</h2>
        {!sharing ? <Loading /> : (
          <>
            <label className="switch"><input type="checkbox" checked={sharing.shareZoneEvents} onChange={(e) => saveSharing({ shareZoneEvents: e.target.checked })} /><span><strong>Zone alerts</strong><span className="hint" style={{ display: 'block' }}>Tell them when I arrive at or leave a safe zone.</span></span></label>
            <label className="switch"><input type="checkbox" checked={sharing.shareSosLocation} onChange={(e) => saveSharing({ shareSosLocation: e.target.checked })} /><span><strong>Include my location in SOS alerts</strong><span className="hint" style={{ display: 'block' }}>If this is off, an SOS still tells them you need help, but without where you are.</span></span></label>
            <p className="small muted">Nothing else about you is shared. There is no live tracking.</p>
          </>
        )}
      </section>

      <section className="card stack" aria-labelledby="co-h">
        <h2 id="co-h">People connected to me</h2>
        {links.loading ? <Loading /> : links.data?.length === 0 ? <p>Nobody is connected.</p> : (
          <ul className="list">
            {links.data.map((l) => (
              <li key={l.id}>
                <div className="row between">
                  <span><strong>{l.other.name}</strong> <span className="muted small">{l.other.email}</span></span>
                  {l.status === 'active' && <Pill kind="ok">Connected</Pill>}
                  {l.status === 'paused' && <Pill kind="warn">Paused</Pill>}
                  {l.status === 'pending' && <Pill kind="info">{l.canRespond ? 'Waiting for your answer' : 'Waiting for them'}</Pill>}
                </div>
                <div className="row" style={{ marginTop: '.5rem' }}>
                  {l.canRespond && <><button className="small" onClick={() => linkAction(l.id, 'accept')}>Accept</button><button className="small secondary" onClick={() => linkAction(l.id, 'decline')}>Decline</button></>}
                  {l.status === 'active' && <button className="small secondary" onClick={() => setPauseFor(l.id)}>Pause sharing</button>}
                  {l.status === 'paused' && <button className="small" onClick={() => linkAction(l.id, 'resume')}>Resume sharing</button>}
                  {l.status !== 'pending' || !l.canRespond ? <button className="small danger outline" onClick={() => { if (window.confirm(`End the connection with ${l.other.name}? They will no longer receive anything.`)) linkAction(l.id, 'revoke'); }}>End connection</button> : null}
                </div>
                {l.status === 'paused' && <p className="small muted">Paused {fmtTime(l.pausedAt)}. They were told sharing is paused, but not why.</p>}
                {pauseFor === l.id && (
                  <form className="note" style={{ marginTop: '.5rem' }} onSubmit={(e) => { e.preventDefault(); linkAction(l.id, 'pause', { reason }); }}>
                    <Field label="Why are you pausing? (kept private; only you and administrators can see it)" id={`r-${l.id}`}><input id={`r-${l.id}`} type="text" required minLength={3} maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
                    <div className="row"><button type="submit" className="small">Pause</button><button type="button" className="small secondary" onClick={() => setPauseFor(null)}>Cancel</button></div>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
        <form onSubmit={(e) => { e.preventDefault(); act.run(async () => { await post('/links', { email }); setSent(true); setEmail(''); links.reload(); }); }}>
          <Field label="Connect a guardian by their email" id="gem" hint="They must have a SafeZone guardian account and accept your request.">
            <div className="row"><input id="gem" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} style={{ flex: 1, minWidth: 220 }} /><button type="submit">Send request</button></div>
          </Field>
          {sent && <Banner kind="ok" live>If that person has a guardian account, they have been sent your request.</Banner>}
        </form>
      </section>

      <section className="card stack" aria-labelledby="ec-h">
        <h2 id="ec-h">My emergency contacts</h2>
        <p className="small muted">SOS alerts go to connected guardians and to contacts below who have a SafeZone guardian account. Phone numbers are used only for the call/text buttons on the SOS screen; SafeZone never texts them itself.</p>
        {contacts.loading ? <Loading /> : (
          <ul className="list">
            {contacts.data.length === 0 && <li className="muted">No contacts yet.</li>}
            {contacts.data.map((c) => (
              <li key={c.id} className="row between">
                <span><strong>{c.displayName}</strong> {c.phone && <span className="muted">{c.phone}</span>} {c.hasAccount ? <Pill kind="ok">gets SOS in the app</Pill> : <Pill>phone only</Pill>}</span>
                <button className="small danger outline" onClick={() => act.run(async () => { await del(`/contacts/${c.id}`); contacts.reload(); })}>Remove</button>
              </li>
            ))}
          </ul>
        )}
        <form onSubmit={(e) => {
          e.preventDefault();
          const body = { displayName: contact.displayName, ...(contact.email ? { email: contact.email } : {}), ...(contact.phone ? { phone: contact.phone } : {}) };
          act.run(async () => { await post('/contacts', body); setContact({ displayName: '', email: '', phone: '' }); contacts.reload(); });
        }}>
          <div className="grid two">
            <Field label="Name" id="cn"><input id="cn" type="text" required value={contact.displayName} onChange={(e) => setContact({ ...contact, displayName: e.target.value })} /></Field>
            <Field label="Phone (optional)" id="cp"><input id="cp" type="tel" value={contact.phone} onChange={(e) => setContact({ ...contact, phone: e.target.value })} /></Field>
          </div>
          <Field label="SafeZone guardian email (optional)" id="ce" hint="Fill in an email, a phone, or both."><input id="ce" type="email" value={contact.email} onChange={(e) => setContact({ ...contact, email: e.target.value })} /></Field>
          <button type="submit" disabled={!contact.email && !contact.phone}>Add contact</button>
        </form>
      </section>
    </div>
  );
}
