import { Link } from 'react-router-dom';
import { useState } from 'react';
import { useAuth } from '../auth.jsx';
import { getCurrentPosition, useGeofence } from '../components/Geofence.jsx';
import { Banner, ErrorNote, Loading, Pill, useAction, useAsync, usePageTitle } from '../components/ui.jsx';
import { get, post } from '../lib/api.js';
import { fmtTime, timeAgo } from '../lib/format.js';
import { queuedCount } from '../lib/sosQueue.js';

export default function ChildHome() {
  usePageTitle('Home');
  const { user } = useAuth();
  const geo = useGeofence();
  const links = useAsync(() => get('/links'), []);
  const events = useAsync(() => get('/zones/events/recent'), []);
  const me = useAsync(() => get('/me'), []);
  const checkin = useAction();
  const [shared, setShared] = useState(null);

  const active = (links.data || []).filter((l) => l.status === 'active');
  const paused = (links.data || []).filter((l) => l.status === 'paused');
  const pending = (links.data || []).filter((l) => l.canRespond);
  const queued = queuedCount();

  const doCheckin = () => checkin.run(async () => {
    const pos = geo.position ?? (await getCurrentPosition());
    if (!pos) throw new Error('Could not get your location. Check that location is allowed for this site.');
    const r = await post('/checkins', { lat: pos.lat, lng: pos.lng, accuracyM: pos.accuracyM });
    setShared(r.sharedWith);
  });

  return (
    <div className="stack">
      <h1>Hi, {user.fullName.split(' ')[0]}</h1>

      {queued > 0 && <Banner kind="danger" title="Not sent yet:">{queued} SOS alert{queued > 1 ? 's are' : ' is'} waiting for an internet connection. {'It'} will be sent automatically when you are back online. <Link to="/sos">Open SOS</Link></Banner>}
      {pending.length > 0 && <Banner kind="warn" title="Needs your answer:">Someone asked to connect with you. <Link to="/privacy-settings">Review the request</Link>.</Banner>}

      <section className="card center" aria-labelledby="sos-h">
        <h2 id="sos-h">Need help right now?</h2>
        <Link to="/sos" className="btn sos-mini" style={{ minWidth: 240, minHeight: 64, fontSize: '1.3rem' }}>Open the SOS button</Link>
        <p className="small muted" style={{ marginTop: '.75rem' }}>SafeZone does not replace local emergency services. If you are in danger, call them too.</p>
      </section>

      <div className="grid two">
        <section className="card" aria-labelledby="share-h">
          <h2 id="share-h">Who can see what</h2>
          {links.loading ? <Loading /> : (
            <>
              {active.length === 0 && paused.length === 0 && <p>Nobody is connected to you right now, so nobody can see anything about you. <Link to="/privacy-settings">Connect a guardian</Link></p>}
              <ul className="list">
                {active.map((l) => <li key={l.id}><strong>{l.other.name}</strong> <Pill kind="ok">Connected</Pill></li>)}
                {paused.map((l) => <li key={l.id}><strong>{l.other.name}</strong> <Pill kind="warn">Paused by you</Pill></li>)}
              </ul>
              {me.data?.sharing && (
                <p className="small muted">
                  Zone alerts: <strong>{me.data.sharing.shareZoneEvents ? 'shared' : 'off'}</strong>. Location in SOS alerts: <strong>{me.data.sharing.shareSosLocation ? 'included' : 'not included'}</strong>.{' '}
                  <Link to="/privacy-settings">Change</Link>
                </p>
              )}
              <p className="small muted">Your location is only sent when you press SOS or choose to share it. It is never tracked all the time.</p>
            </>
          )}
        </section>

        <section className="card" aria-labelledby="zones-h">
          <h2 id="zones-h">My safe zones</h2>
          {geo.zones.length === 0 ? <p>No safe zones yet. A guardian can add them.</p> : (
            <ul className="list">
              {geo.zones.map((z) => (
                <li key={z.id} className="row between">
                  <span><strong>{z.name}</strong> <span className="muted small">{z.radiusM} m</span></span>
                  {z.state?.current === 'inside' ? <Pill kind="ok">You are inside</Pill> : z.state?.current === 'outside' ? <Pill kind="info">You are outside</Pill> : <Pill>Not checked yet</Pill>}
                </li>
              ))}
            </ul>
          )}
          <p className="small">Zone checking on this device: <strong>{geo.monitoring ? 'ON' : 'OFF'}</strong>. <Link to="/zones">{geo.monitoring ? 'See the map' : 'Turn it on'}</Link></p>
        </section>
      </div>

      <section className="card" aria-labelledby="ci-h">
        <h2 id="ci-h">Let my guardians know where I am</h2>
        <p>This shares your location <strong>one time</strong>. They can see it for 24 hours.</p>
        <button onClick={doCheckin} disabled={checkin.busy || active.length === 0}>{checkin.busy ? 'Sharing…' : 'Share my location now'}</button>
        {active.length === 0 && <p className="hint">Connect a guardian first.</p>}
        {shared !== null && <Banner kind="ok" live title="Shared:">Your location was shared with {shared} guardian{shared === 1 ? '' : 's'}.</Banner>}
        <ErrorNote error={checkin.error} />
      </section>

      <section className="card" aria-labelledby="ev-h">
        <h2 id="ev-h">Recent zone events</h2>
        {events.loading ? <Loading /> : events.data?.length ? (
          <ul className="list">
            {events.data.slice(0, 8).map((e) => (
              <li key={e.id}>
                {e.type === 'enter' ? 'Arrived at' : 'Left'} <strong>{e.zoneName}</strong> · <span title={fmtTime(e.occurredAt)}>{timeAgo(e.occurredAt)}</span>{' '}
                {e.notified ? <Pill kind="info">guardian told</Pill> : <Pill>no alert sent</Pill>}
              </li>
            ))}
          </ul>
        ) : <p className="muted">Nothing yet. Events appear when your phone confirms you entered or left a zone.</p>}
      </section>
    </div>
  );
}
