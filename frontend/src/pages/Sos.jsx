import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getCurrentPosition } from '../components/Geofence.jsx';
import { Banner, Loading, useAsync, usePageTitle } from '../components/ui.jsx';
import { ApiError, get, post } from '../lib/api.js';
import { fmtTime } from '../lib/format.js';
import { enqueue, flushQueue, sendSos } from '../lib/sosQueue.js';

const EMERGENCY_NUMBER = import.meta.env.VITE_EMERGENCY_NUMBER || '';

// States: idle -> countdown -> sending -> sent | queued | no_recipients | failed
export default function Sos() {
  usePageTitle('SOS');
  const [phase, setPhase] = useState('idle');
  const [secs, setSecs] = useState(3);
  const [result, setResult] = useState(null);
  const [pending, setPending] = useState(null); // the alert being sent/queued, for the fallback message
  const contacts = useAsync(() => get('/contacts'), []);

  const startCountdown = () => { setSecs(3); setPhase('countdown'); };
  const cancel = () => setPhase('idle');

  // The countdown gives a few seconds to cancel an accidental press.
  useEffect(() => {
    if (phase !== 'countdown') return undefined;
    if (secs <= 0) { send(); return undefined; }
    const t = setTimeout(() => setSecs((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [phase, secs]); // eslint-disable-line react-hooks/exhaustive-deps

  async function send() {
    setPhase('sending');
    const clientId = crypto.randomUUID();
    const triggeredAt = new Date().toISOString();
    const pos = await getCurrentPosition(6000); // may be null: the alert is still sent without a location
    const item = { clientId, triggeredAt, ...(pos ? { lat: pos.lat, lng: pos.lng, accuracyM: pos.accuracyM } : {}) };
    setPending({ ...item, hasLocation: Boolean(pos) });
    try {
      const r = await sendSos(item);
      setResult(r);
      setPhase(r.status === 'no_recipients' ? 'no_recipients' : 'sent');
    } catch (err) {
      if (err instanceof ApiError && err.status === 0) { enqueue(item); setPhase('queued'); }
      else if (err instanceof ApiError && err.status >= 500) { enqueue(item); setPhase('queued'); }
      else { setResult(err); setPhase('failed'); }
    }
  }

  // While queued, keep retrying and switch to "sent" only when the server confirms.
  useEffect(() => {
    if (phase !== 'queued') return undefined;
    const id = setInterval(async () => {
      const delivered = await flushQueue();
      if (delivered.length) { setResult(delivered[0]); setPhase(delivered[0].status === 'no_recipients' ? 'no_recipients' : 'sent'); }
    }, 5000);
    return () => clearInterval(id);
  }, [phase]);

  const phones = (contacts.data || []).filter((c) => c.phone);
  const smsText = encodeURIComponent(`I need help. I pressed SOS in SafeZone at ${new Date().toLocaleTimeString()}.${pending?.hasLocation ? ` My location: https://www.openstreetmap.org/?mlat=${pending.lat}&mlon=${pending.lng}#map=17/${pending.lat}/${pending.lng}` : ''}`);

  const fallback = (
    <section className="card stack" aria-labelledby="fb-h">
      <h2 id="fb-h">Also reach someone another way</h2>
      <p>These open your phone's call or text app. <strong>You</strong> send the message; SafeZone cannot tell if it was delivered.</p>
      {EMERGENCY_NUMBER && <a className="btn danger" href={`tel:${EMERGENCY_NUMBER}`}>Call emergency services ({EMERGENCY_NUMBER})</a>}
      {!EMERGENCY_NUMBER && <p>Call your local emergency number.</p>}
      {contacts.loading ? <Loading /> : phones.length === 0 ? <p className="muted">No phone numbers saved. Add some in <Link to="/privacy-settings">Privacy &amp; permissions</Link>.</p> : (
        <ul className="list">
          {phones.map((c) => (
            <li key={c.id} className="row">
              <strong>{c.displayName}</strong>
              <a className="btn secondary small" href={`tel:${c.phone}`}>Call</a>
              <a className="btn secondary small" href={`sms:${c.phone}?body=${smsText}`}>Text</a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );

  return (
    <div className="stack">
      <h1>SOS</h1>
      <div className="sos-status" aria-live="assertive" aria-atomic="true">
        {phase === 'idle' && <p>Press the button if you need help. We will give you 3 seconds to cancel if it was a mistake.</p>}
        {phase === 'countdown' && <p className="sos-countdown"><strong>Sending SOS in {secs}…</strong></p>}
        {phase === 'sending' && <Banner kind="warn" live title="Sending:">Getting your location and contacting the server. Please wait.</Banner>}
        {phase === 'sent' && result && (
          <Banner kind="ok" title="SOS sent:">
            The server received your alert at {fmtTime(result.serverReceivedAt)} and created an urgent alert for <strong>{result.recipientsCount}</strong> {result.recipientsCount === 1 ? 'person' : 'people'} in SafeZone.
            {' '}{result.locationIncluded ? 'Your location was included.' : 'No location was included.'}
            {' '}They see it when they open SafeZone, so also call or text someone below.
          </Banner>
        )}
        {phase === 'no_recipients' && (
          <Banner kind="danger" title="Alert saved, but nobody was notified:">
            You have no connected guardian or emergency contact who uses SafeZone. <strong>Call or text someone now.</strong> <Link to="/privacy-settings">Add contacts</Link>
          </Banner>
        )}
        {phase === 'queued' && (
          <Banner kind="danger" title="NOT SENT YET:">
            There is no connection to the server. Your alert is saved on this device and we keep trying. <strong>Nobody has been told yet.</strong> Call or text someone now.
          </Banner>
        )}
        {phase === 'failed' && <Banner kind="danger" title="Could not send:">{result?.message || 'Something went wrong.'} <strong>Call or text someone now.</strong></Banner>}
      </div>

      {(phase === 'idle' || phase === 'countdown') && (
        <div className="center">
          {phase === 'idle'
            ? <button className="sos-button" onClick={startCountdown} aria-label="Send SOS emergency alert">SOS<small>Tap to send</small></button>
            : <button className="sos-button" onClick={cancel} style={{ background: 'var(--surface)', color: 'var(--danger)', borderColor: 'var(--danger)' }}>CANCEL<small>Tap to stop</small></button>}
          {phase === 'countdown' && <p><button className="link" onClick={send}>Send now without waiting</button></p>}
        </div>
      )}

      {['sent', 'no_recipients', 'queued', 'failed'].includes(phase) && (
        <>
          <div className="row">
            {phase === 'sent' && result?.id && <Link className="btn secondary" to={`/alerts/${result.id}`}>See alert status / mark as resolved</Link>}
            {(phase === 'sent' || phase === 'no_recipients' || phase === 'failed') && <button className="secondary" onClick={() => { setPhase('idle'); setResult(null); }}>Back</button>}
          </div>
          {fallback}
        </>
      )}
      {phase === 'idle' && <p className="small muted center">SafeZone is a helper, not a replacement for local emergency services.</p>}
    </div>
  );
}
