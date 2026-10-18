import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import MapView from '../components/MapView.jsx';
import { Banner, ErrorNote, Field, Loading, Pill, useAction, useAsync, useInterval, usePageTitle } from '../components/ui.jsx';
import { get, post } from '../lib/api.js';
import { fmtTime, timeAgo } from '../lib/format.js';

function ChildCard({ link }) {
  const childId = link.other.id;
  const zones = useAsync(() => get(`/zones?childId=${childId}`), [childId]);
  const events = useAsync(() => get(`/zones/events/recent?childId=${childId}`).catch((e) => (e.status === 403 ? 'off' : Promise.reject(e))), [childId]);
  const checkin = useAsync(() => get(`/checkins/latest?childId=${childId}`), [childId]);
  useInterval(() => { zones.reload(); events.reload(); checkin.reload(); }, 15000);

  const paused = link.status === 'paused';
  const stateOf = (z) => (z.state?.current === 'inside' ? <Pill kind="ok">inside</Pill> : z.state?.current === 'outside' ? <Pill kind="info">outside</Pill> : <Pill>no data</Pill>);

  return (
    <section className="card stack" aria-labelledby={`c-${childId}`}>
      <div className="row between">
        <h2 id={`c-${childId}`} style={{ margin: 0 }}>{link.other.name}</h2>
        {paused ? <Pill kind="warn">Sharing paused</Pill> : <Pill kind="ok">Connected</Pill>}
      </div>
      {paused ? (
        <Banner kind="warn" title="Paused:">{link.other.name} paused sharing with you. You will not receive zone alerts or SOS alerts until she resumes it. You can still end the connection from here.</Banner>
      ) : (
        <>
          <div>
            <h3>Safe zones</h3>
            {zones.loading ? <Loading /> : zones.data?.length === 0 ? <p className="muted">No zones yet. <Link to="/zones">Add one</Link>.</p> : (
              <ul className="list">
                {zones.data.map((z) => <li key={z.id} className="row between"><span><strong>{z.name}</strong> <span className="muted small">{z.radiusM} m</span></span>{zones.data.some((x) => x.state) ? stateOf(z) : <Pill>zone sharing is off</Pill>}</li>)}
              </ul>
            )}
          </div>
          <div>
            <h3>Recent zone events</h3>
            {events.data === 'off' ? <p className="muted">{link.other.name} turned zone sharing off.</p> : events.loading ? <Loading /> : events.data?.length ? (
              <ul className="list">
                {events.data.slice(0, 5).map((e) => <li key={e.id}>{e.type === 'enter' ? 'Arrived at' : 'Left'} <strong>{e.zoneName}</strong> · <span title={fmtTime(e.occurredAt)}>{timeAgo(e.occurredAt)}</span></li>)}
              </ul>
            ) : <p className="muted">No events yet.</p>}
          </div>
          <div>
            <h3>Location she chose to share</h3>
            {checkin.data ? (
              <>
                <p>Shared {timeAgo(checkin.data.createdAt)} (visible until {fmtTime(checkin.data.expiresAt)}).</p>
                <MapView zones={zones.data || []} position={checkin.data} accuracyM={checkin.data.accuracyM} focus={{ lat: checkin.data.lat, lng: checkin.data.lng }} positionLabel="Shared location" label={`Location shared by ${link.other.name}`} />
              </>
            ) : <p className="muted">She has not shared a location. SafeZone does not track her.</p>}
          </div>
        </>
      )}
    </section>
  );
}

export default function GuardianHome() {
  usePageTitle('Home');
  const { user } = useAuth();
  const links = useAsync(() => get('/links'), []);
  const open = useAsync(() => get('/sos/open'), []);
  useInterval(() => { open.reload(); links.reload(); }, 8000);
  const act = useAction();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);

  const answer = (id, verb) => act.run(async () => { await post(`/links/${id}/${verb}`); links.reload(); });
  const kids = (links.data || []).filter((l) => l.status === 'active' || l.status === 'paused');
  const pending = (links.data || []).filter((l) => l.status === 'pending');

  return (
    <div className="stack">
      <h1>Hello, {user.fullName.split(' ')[0]}</h1>
      <ErrorNote error={act.error} />
      {(open.data || []).map((a) => (
        <Banner key={a.id} kind="danger" title="EMERGENCY:">
          {a.childName} pressed SOS {timeAgo(a.triggeredAt)}. Status: {a.status === 'acknowledged' ? 'someone has seen it' : 'not yet seen'}.{' '}
          <Link to={`/alerts/${a.id}`}><strong>Open alert</strong></Link>
        </Banner>
      ))}

      {pending.length > 0 && (
        <section className="card" aria-labelledby="pend-h">
          <h2 id="pend-h">Connection requests</h2>
          <ul className="list">
            {pending.map((l) => (
              <li key={l.id} className="row between">
                <span><strong>{l.other.name}</strong> <span className="muted small">{l.other.email}</span></span>
                {l.canRespond ? <span className="row"><button className="small" onClick={() => answer(l.id, 'accept')}>Accept</button><button className="small secondary" onClick={() => answer(l.id, 'decline')}>Decline</button></span> : <Pill kind="info">Waiting for her to accept</Pill>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {links.loading ? <Loading /> : kids.length === 0 ? (
        <Banner kind="info" title="Getting started:">Nobody is connected yet. Ask the young person to create a SafeZone account, then send a request below. She must accept before you can see anything.</Banner>
      ) : kids.map((l) => <ChildCard key={l.id} link={l} />)}

      <section className="card" aria-labelledby="add-h">
        <h2 id="add-h">Connect with a young person</h2>
        <form onSubmit={(e) => { e.preventDefault(); act.run(async () => { await post('/links', { email }); setSent(true); setEmail(''); links.reload(); }); }}>
          <Field label="Her SafeZone account email" id="kid" hint="She will get a request and decides whether to accept. You will see nothing until she does.">
            <div className="row"><input id="kid" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} style={{ flex: 1, minWidth: 220 }} /><button type="submit">Send request</button></div>
          </Field>
          {sent && <Banner kind="ok" live>If that person has a young person's account, they have been sent your request.</Banner>}
        </form>
        {kids.length > 0 && <p className="small muted">To stop receiving information about someone, you can end a connection at any time under Account.</p>}
      </section>
    </div>
  );
}
