import { useParams } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import MapView from '../components/MapView.jsx';
import { Banner, ErrorNote, Loading, Pill, useAction, useAsync, useInterval, usePageTitle } from '../components/ui.jsx';
import { get, post } from '../lib/api.js';
import { fmtTime } from '../lib/format.js';

const STATUS = { received: ['warn', 'Received'], notified: ['danger', 'Sent, not yet seen'], no_recipients: ['danger', 'Nobody could be notified'], acknowledged: ['info', 'Seen by a guardian'], resolved: ['ok', 'Resolved'] };

export default function AlertDetail() {
  usePageTitle('SOS alert');
  const { id } = useParams();
  const { user } = useAuth();
  const alert = useAsync(() => get(`/sos/${id}`), [id]);
  useInterval(alert.reload, 8000);
  const act = useAction();
  const a = alert.data;
  if (alert.loading) return <Loading />;
  if (alert.error) return <ErrorNote error={alert.error} />;

  const run = (verb) => act.run(async () => { await post(`/sos/${id}/${verb}`); alert.reload(); });
  const [kind, label] = STATUS[a.status] ?? ['gray', a.status];
  return (
    <div className="stack">
      <h1>SOS alert{user.role !== 'child' ? ` from ${a.childName}` : ''}</h1>
      <div className="row"><Pill kind={kind}>{label}</Pill><span>Pressed {fmtTime(a.triggeredAt)} · received by server {fmtTime(a.serverReceivedAt)}</span></div>
      <Banner kind="danger" title="If she may be in danger:">contact local emergency services first. SafeZone only passes on what she sent; it cannot tell what is happening.</Banner>
      <ErrorNote error={act.error} />
      <section className="card" aria-labelledby="loc-h">
        <h2 id="loc-h">Location</h2>
        {a.location ? (
          <>
            <p>Approximate position at the time she pressed SOS{a.location.accuracyM ? ` (accurate to about ${a.location.accuracyM} m)` : ''}. It may be out of date.</p>
            <MapView tall position={a.location} accuracyM={a.location.accuracyM} positionLabel="Where SOS was pressed" focus={{ lat: a.location.lat, lng: a.location.lng, zoom: 16 }} label="Map showing where SOS was pressed" />
          </>
        ) : <p>{user.role === 'child' ? 'No location was attached to this alert.' : 'No location was attached to this alert (location was unavailable, or she turned location sharing for SOS off).'}</p>}
      </section>
      <div className="row">
        {user.role === 'guardian' && a.status !== 'resolved' && <button onClick={() => run('acknowledge')} disabled={act.busy || a.status === 'acknowledged'}>{a.status === 'acknowledged' ? 'You have confirmed you saw this' : 'I have seen this alert'}</button>}
        {user.role === 'child' && a.status !== 'resolved' && <button onClick={() => run('resolve')} disabled={act.busy}>I am safe now – mark as resolved</button>}
      </div>
    </div>
  );
}
