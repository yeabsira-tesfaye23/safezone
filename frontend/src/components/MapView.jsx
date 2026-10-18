import 'leaflet/dist/leaflet.css';
import { useEffect } from 'react';
import { Circle, CircleMarker, MapContainer, TileLayer, Tooltip, useMap, useMapEvents } from 'react-leaflet';

const DEFAULT_CENTER = [9.4167, 42.0333];

function Clicks({ onClick }) {
  useMapEvents({ click: (e) => onClick?.({ lat: e.latlng.lat, lng: e.latlng.lng }) });
  return null;
}

function Focus({ focus }) {
  const map = useMap();
  useEffect(() => { if (focus) map.setView([focus.lat, focus.lng], focus.zoom ?? 15); }, [focus?.lat, focus?.lng, focus?.zoom, map]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

// Map of safe zones (teal circles), an optional draft zone (dashed amber), and a position marker.
// Tiles come from OpenStreetMap. Colour is never the only signal: every shape has a tooltip label.
export default function MapView({ zones = [], draft, position, accuracyM, focus, onClick, tall, label = 'Map of safe zones', positionLabel = 'Position' }) {
  const first = focus || draft || zones[0] || position;
  const center = first ? [first.lat, first.lng] : DEFAULT_CENTER;
  return (
    <div className={`map ${tall ? 'tall' : ''}`} role="region" aria-label={label}>
      <MapContainer center={center} zoom={15} style={{ height: '100%', width: '100%' }} scrollWheelZoom>
        <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' url="https://tile.openstreetmap.org/{z}/{x}/{y}.png" maxZoom={19} />
        {zones.map((z) => (
          <Circle key={z.id} center={[z.lat, z.lng]} radius={z.radiusM} pathOptions={{ color: z.active === false ? '#6b7785' : '#0f5c58', fillOpacity: 0.18, weight: 3 }}>
            <Tooltip sticky>{z.name} · {z.radiusM} m{z.state?.current ? ` · ${z.state.current}` : ''}</Tooltip>
          </Circle>
        ))}
        {draft && (
          <Circle center={[draft.lat, draft.lng]} radius={draft.radiusM} pathOptions={{ color: '#8a5a00', dashArray: '8 6', fillOpacity: 0.12, weight: 3 }}>
            <Tooltip permanent>New zone</Tooltip>
          </Circle>
        )}
        {position && (
          <>
            {accuracyM ? <Circle center={[position.lat, position.lng]} radius={accuracyM} pathOptions={{ color: '#1d4f91', weight: 1, fillOpacity: 0.08 }} /> : null}
            <CircleMarker center={[position.lat, position.lng]} radius={9} pathOptions={{ color: '#fff', weight: 3, fillColor: '#1d4f91', fillOpacity: 1 }}>
              <Tooltip permanent direction="top">{positionLabel}</Tooltip>
            </CircleMarker>
          </>
        )}
        <Focus focus={focus} />
        <Clicks onClick={onClick} />
      </MapContainer>
    </div>
  );
}
