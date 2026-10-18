import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { get, post } from '../lib/api.js';
import { isInside } from '../lib/geo.js';

// Runs on the CHILD's device. It compares the phone's position with each safe zone locally and tells the server only
// "inside" or "outside" plus the GPS accuracy. Coordinates are never sent for geofencing.
const GeofenceContext = createContext(null);
export const useGeofence = () => useContext(GeofenceContext);

const SEND_EVERY_MS = 10000;
const store = {
  get: (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } },
};

export function GeofenceProvider({ children }) {
  const [zones, setZones] = useState([]);
  const [monitoring, setMonitoringState] = useState(() => store.get('sz_monitoring', false));
  const [mode, setModeState] = useState(() => store.get('sz_mode', 'gps')); // 'gps' or 'sim' (simulated, for testing)
  const [simPos, setSimPos] = useState(() => store.get('sz_simpos', null));
  const [gps, setGps] = useState(null); // { lat, lng, accuracyM }
  const [gpsError, setGpsError] = useState(null);
  const [lastResults, setLastResults] = useState([]);
  const lastSent = useRef({});
  const busy = useRef(false);

  const loadZones = useCallback(async () => {
    try { setZones(await get('/zones')); } catch { /* keep the previous list when offline */ }
  }, []);
  useEffect(() => { loadZones(); const id = setInterval(loadZones, 30000); return () => clearInterval(id); }, [loadZones]);

  const setMonitoring = (v) => { setMonitoringState(v); store.set('sz_monitoring', v); };
  const setMode = (v) => { setModeState(v); store.set('sz_mode', v); };
  const moveSim = (p) => { const next = { lat: p.lat, lng: p.lng, accuracyM: 15 }; setSimPos(next); store.set('sz_simpos', next); };

  // Real GPS: only while monitoring is on and the mode is GPS.
  useEffect(() => {
    if (!monitoring || mode !== 'gps') return undefined;
    if (!('geolocation' in navigator)) { setGpsError('This browser cannot read your location.'); return undefined; }
    const id = navigator.geolocation.watchPosition(
      (p) => { setGpsError(null); setGps({ lat: p.coords.latitude, lng: p.coords.longitude, accuracyM: p.coords.accuracy }); },
      (e) => setGpsError(e.code === 1 ? 'Location permission is off. Turn it on in your browser to use zone alerts.' : 'Could not get your location right now.'),
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [monitoring, mode]);

  const position = mode === 'sim' ? simPos : gps;

  const evaluate = useCallback(async () => {
    if (!monitoring || !position || busy.current) return;
    if (position.accuracyM > 100) return; // too inaccurate to decide; the server would ignore it anyway
    const now = Date.now();
    const readings = [];
    for (const z of zones) {
      if (!z.active) continue;
      const inside = isInside(position, z);
      const known = z.state?.current ?? null;
      const differs = known === null || (inside ? 'inside' : 'outside') !== known;
      if (differs && now - (lastSent.current[z.id] ?? 0) >= SEND_EVERY_MS) {
        readings.push({ zoneId: z.id, inside, accuracyM: position.accuracyM });
        lastSent.current[z.id] = now;
      }
    }
    if (!readings.length) return;
    busy.current = true;
    try {
      const { results } = await post('/zones/readings', { readings });
      setLastResults(results);
      await loadZones();
    } catch { /* offline: try again on the next tick */ } finally { busy.current = false; }
  }, [monitoring, position, zones, loadZones]);

  useEffect(() => { evaluate(); }, [evaluate]);
  // Keep re-checking (simulated positions do not change by themselves, and confirmation needs a second reading).
  useEffect(() => {
    if (!monitoring) return undefined;
    const id = setInterval(evaluate, 5000);
    return () => clearInterval(id);
  }, [monitoring, evaluate]);

  const value = useMemo(() => ({
    zones, loadZones, monitoring, setMonitoring, mode, setMode, simPos, moveSim, position, gpsError, lastResults,
  }), [zones, loadZones, monitoring, mode, simPos, position, gpsError, lastResults]); // eslint-disable-line react-hooks/exhaustive-deps

  return <GeofenceContext.Provider value={value}>{children}</GeofenceContext.Provider>;
}

// One-shot "where am I now" used by SOS and check-in. Resolves null if unavailable (permission, timeout).
export function getCurrentPosition(timeoutMs = 8000) {
  return new Promise((resolve) => {
    if (!('geolocation' in navigator)) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracyM: p.coords.accuracy }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 5000 },
    );
  });
}
