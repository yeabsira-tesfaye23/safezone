import { useEffect, useState } from 'react';
import MapView from '../components/MapView.jsx';
import { Banner, ErrorNote, Field, Loading, Pill, useAction, useAsync, usePageTitle } from '../components/ui.jsx';
import { del, get, patch, post } from '../lib/api.js';

export default function GuardianZones() {
  usePageTitle('Safe zones');
  const links = useAsync(() => get('/links'), []);
  const kids = (links.data || []).filter((l) => l.status === 'active');
  const [childId, setChildId] = useState('');
  useEffect(() => { if (!childId && kids[0]) setChildId(kids[0].other.id); }, [kids, childId]);
  const zones = useAsync(() => (childId ? get(`/zones?childId=${childId}`) : Promise.resolve([])), [childId]);
  const act = useAction();
  const [draft, setDraft] = useState(null); // { lat, lng, radiusM }
  const [name, setName] = useState('');
  const [focus, setFocus] = useState(null);
  const [edit, setEdit] = useState(null); // { id, name, radiusM }

  const save = (e) => {
    e.preventDefault();
    act.run(async () => {
      await post('/zones', { childId, name, lat: draft.lat, lng: draft.lng, radiusM: draft.radiusM });
      setDraft(null); setName(''); zones.reload();
    });
  };
  const childName = kids.find((k) => k.other.id === childId)?.other.name;

  if (links.loading) return <Loading />;
  if (kids.length === 0) return <Banner kind="info" title="No connected child:">You can create safe zones after a young person accepts your connection request. Go to Home to send one.</Banner>;

  return (
    <div className="stack">
      <h1>Safe zones</h1>
      <p>A safe zone is a circle around a place like home or school. {childName ? `${childName}'s` : 'Her'} phone checks it on the device, and you get a routine alert when she arrives or leaves. She is told when zones are added or changed.</p>
      {kids.length > 1 && (
        <Field label="Zones for" id="who"><select id="who" value={childId} onChange={(e) => { setChildId(e.target.value); setDraft(null); }}>{kids.map((k) => <option key={k.other.id} value={k.other.id}>{k.other.name}</option>)}</select></Field>
      )}
      <ErrorNote error={act.error} />

      <section className="card" aria-labelledby="map-h">
        <h2 id="map-h">Map</h2>
        <p className="small muted">Click the map to place a new zone. Zones from OpenStreetMap map data; GPS is not exact, so keep circles at least 100 m wide.</p>
        <MapView tall zones={zones.data || []} draft={draft} focus={focus} onClick={(p) => setDraft((d) => ({ radiusM: d?.radiusM ?? 200, ...p }))} label="Map for placing safe zones" />
        {draft && (
          <form onSubmit={save} className="note" style={{ marginTop: '1rem' }}>
            <h3>New zone</h3>
            <Field label="Name" id="zn"><input id="zn" type="text" required maxLength={60} value={name} onChange={(e) => setName(e.target.value)} placeholder="Home, School, Grandma's house…" /></Field>
            <Field label={`Radius: ${draft.radiusM} m`} id="zr" hint="100 to 500 metres.">
              <input id="zr" type="range" min="100" max="500" step="10" value={draft.radiusM} onChange={(e) => setDraft({ ...draft, radiusM: Number(e.target.value) })} style={{ width: '100%', minHeight: 40 }} />
            </Field>
            <div className="row"><button type="submit" disabled={act.busy}>Save zone</button><button type="button" className="secondary" onClick={() => setDraft(null)}>Cancel</button></div>
          </form>
        )}
      </section>

      <section className="card" aria-labelledby="list-h">
        <h2 id="list-h">Zones for {childName}</h2>
        {zones.loading ? <Loading /> : zones.data.length === 0 ? <p className="muted">No zones yet. Click the map to add one.</p> : (
          <ul className="list">
            {zones.data.map((z) => (
              <li key={z.id}>
                <div className="row between">
                  <span><strong>{z.name}</strong> <span className="muted small">{z.radiusM} m</span> {!z.active && <Pill kind="warn">turned off</Pill>}</span>
                  <span className="row">
                    <button className="small secondary" onClick={() => setFocus({ lat: z.lat, lng: z.lng, zoom: 16 })}>Show on map</button>
                    <button className="small secondary" onClick={() => setEdit({ id: z.id, name: z.name, radiusM: z.radiusM })}>Edit</button>
                    <button className="small secondary" onClick={() => act.run(async () => { await patch(`/zones/${z.id}`, { active: !z.active }); zones.reload(); })}>{z.active ? 'Turn off' : 'Turn on'}</button>
                    <button className="small danger outline" onClick={() => { if (window.confirm(`Delete the zone "${z.name}"?`)) act.run(async () => { await del(`/zones/${z.id}`); zones.reload(); }); }}>Delete</button>
                  </span>
                </div>
                {edit?.id === z.id && (
                  <form className="note" style={{ marginTop: '.5rem' }} onSubmit={(e) => { e.preventDefault(); act.run(async () => { await patch(`/zones/${z.id}`, { name: edit.name, radiusM: edit.radiusM }); setEdit(null); zones.reload(); }); }}>
                    <Field label="Name" id="en"><input id="en" type="text" required value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
                    <Field label={`Radius: ${edit.radiusM} m`} id="er"><input id="er" type="range" min="100" max="500" step="10" value={edit.radiusM} onChange={(e) => setEdit({ ...edit, radiusM: Number(e.target.value) })} style={{ width: '100%' }} /></Field>
                    <div className="row"><button type="submit" className="small">Save</button><button type="button" className="small secondary" onClick={() => setEdit(null)}>Cancel</button></div>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
