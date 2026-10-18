import { useGeofence } from '../components/Geofence.jsx';
import MapView from '../components/MapView.jsx';
import { Banner, Pill, usePageTitle } from '../components/ui.jsx';
import { distanceM } from '../lib/geo.js';

const RESULT_TEXT = {
  baseline: 'Saved your starting position (no alert).',
  unchanged: 'Same as before.',
  pending: 'Waiting for another reading to confirm.',
  confirmed: 'Confirmed.',
  ignored_low_accuracy: 'GPS was not accurate enough, so it was ignored.',
  unknown_zone: 'Zone no longer exists.',
};

export default function ChildZones() {
  usePageTitle('My zones');
  const g = useGeofence();
  const sim = g.mode === 'sim';
  const nameOf = (id) => g.zones.find((z) => z.id === id)?.name ?? 'zone';

  return (
    <div className="stack">
      <h1>My safe zones</h1>
      <p>Your phone checks if you are inside these places and tells your guardians only when you arrive or leave. It sends "inside" or "outside", not where you are.</p>

      <section className="card stack" aria-labelledby="mon-h">
        <h2 id="mon-h">Zone checking</h2>
        <label className="switch">
          <input type="checkbox" checked={g.monitoring} onChange={(e) => g.setMonitoring(e.target.checked)} />
          <span><strong>Check my zones on this device</strong><span className="hint" style={{ display: 'block' }}>Works while this page or app is open. A browser cannot check in the background like a phone app can.</span></span>
        </label>
        <fieldset style={{ border: 0, padding: 0 }}>
          <legend><strong>Where does the location come from?</strong></legend>
          <label className="choice"><input type="radio" name="mode" checked={!sim} onChange={() => g.setMode('gps')} /><span><strong>This device's GPS</strong>Uses your real location. Your browser will ask permission.</span></label>
          <label className="choice"><input type="radio" name="mode" checked={sim} onChange={() => g.setMode('sim')} /><span><strong>Test mode (simulated location)</strong>For demos and testing. Click the map to pretend you are there. Nothing real is used.</span></label>
        </fieldset>
        {g.gpsError && !sim && <Banner kind="warn" title="Location:">{g.gpsError}</Banner>}
        {g.monitoring && !g.position && <Banner kind="info" live title="Waiting:">{sim ? 'Click the map to place the test location.' : 'Waiting for your first location reading…'}</Banner>}
        {g.position && g.position.accuracyM > 100 && <Banner kind="warn" live title="Weak GPS:">Accuracy is about {Math.round(g.position.accuracyM)} m, which is too weak to decide. No alerts will be sent until it improves.</Banner>}
      </section>

      <section className="card" aria-labelledby="map-h">
        <h2 id="map-h">Map</h2>
        <MapView
          tall zones={g.zones} position={g.position} accuracyM={g.position?.accuracyM}
          onClick={sim ? g.moveSim : undefined} positionLabel={sim ? 'Test location' : 'You'}
          focus={g.zones[0] && !g.position ? { lat: g.zones[0].lat, lng: g.zones[0].lng } : undefined}
          label="Map showing your safe zones and your position"
        />
        <div className="legend"><span>Teal circles: safe zones</span><span>Blue dot: {sim ? 'test location' : 'your position'}</span></div>
      </section>

      <section className="card" aria-labelledby="st-h">
        <h2 id="st-h">Status</h2>
        {g.zones.length === 0 ? <p>No zones yet.</p> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Zone</th><th>Radius</th><th>Confirmed state</th><th>Distance now</th></tr></thead>
              <tbody>
                {g.zones.map((z) => (
                  <tr key={z.id}>
                    <td><strong>{z.name}</strong></td><td>{z.radiusM} m</td>
                    <td>{z.state?.current === 'inside' ? <Pill kind="ok">inside</Pill> : z.state?.current === 'outside' ? <Pill kind="info">outside</Pill> : <Pill>unknown</Pill>}</td>
                    <td>{g.position ? `${Math.round(distanceM(g.position, z))} m from centre` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {g.lastResults.length > 0 && (
          <div aria-live="polite">
            <h3 style={{ marginTop: '1rem' }}>Last checks sent</h3>
            <ul className="list small">
              {g.lastResults.map((r, i) => <li key={i}><strong>{nameOf(r.zoneId)}</strong>: {RESULT_TEXT[r.result] ?? r.result}{r.event ? ` (${r.event === 'enter' ? 'arrived' : 'left'})` : ''}</li>)}
            </ul>
          </div>
        )}
      </section>
    </div>
  );
}
