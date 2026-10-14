import { useState } from 'react';
import { MapContainer, TileLayer, Marker, Circle, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import { useApi } from '../../hooks/useApi';
import {
  PageHeader, Card, Table, AsyncBlock, EmptyState, Banner,
  Input, Field, Button, Select, Stamp,
} from '../../components';

// Leaflet's default marker images do not resolve under a bundler.
// Point them at the CDN copies instead of shipping the assets.
const icon = (color) => L.divIcon({
  className: '',
  html: `<div style="width:14px;height:14px;border-radius:50%;background:${color};
          border:2px solid #FFFCF6;box-shadow:0 0 0 1px rgba(0,0,0,.2)"></div>`,
  iconSize: [14, 14],
  iconAnchor: [7, 7],
});

const originIcon = icon('#9C3B28');
const nurseIcon = icon('#2D5A4C');

function Recenter({ lat, lng }) {
  const map = useMap();
  map.setView([lat, lng], map.getZoom(), { animate: true });
  return null;
}

export default function MapScreen() {
  const [q, setQ] = useState('');
  const [clinic, setClinic] = useState(null);
  const [radius, setRadius] = useState('5000');
  const [live, setLive] = useState(true);

  const { data: search } = useApi(
    `/clinics?limit=8${q ? `&q=${encodeURIComponent(q)}` : ''}`
  );

  const path = clinic
    ? `/nurses/near?clinic_id=${clinic.id}&radius=${radius}`
    : null;

  // Polls quietly so the list does not flash back to a spinner.
  const { data, loading, error } = useApi(path, {
    skip: !clinic,
    pollMs: live ? 5000 : 0,
  });

  const nurses = data?.data ?? [];
  const origin = data?.origin;

  return (
    <>
      <PageHeader
        title="Map"
        subtitle="Workflow 3 — $geoNear finds active nurses within the radius, grouped so each nurse appears once at their nearest position."
      />

      <Card>
        <div className="row mb-4">
          <div className="grow">
            <Field label="Origin clinic">
              {clinic ? (
                <div className="row row--between" style={{
                  border: '1px solid var(--line-strong)', borderRadius: 'var(--r)',
                  padding: 'var(--s-2) var(--s-3)', background: 'var(--surface)',
                }}>
                  <span>{clinic.name}</span>
                  <Button variant="quiet" small onClick={() => { setClinic(null); setQ(''); }}>
                    Change
                  </Button>
                </div>
              ) : (
                <Input placeholder="Search clinics…" value={q}
                       onChange={(e) => setQ(e.target.value)} />
              )}
            </Field>
          </div>
          <div style={{ width: 150 }}>
            <label className="field__label">Radius</label>
            <Select
              value={radius}
              onChange={(e) => setRadius(e.target.value)}
              options={[
                { value: '2000', label: '2 km' },
                { value: '5000', label: '5 km' },
                { value: '10000', label: '10 km' },
                { value: '25000', label: '25 km' },
              ]}
            />
          </div>
          <div>
            <label className="field__label">Updates</label>
            <Button variant="secondary" onClick={() => setLive((v) => !v)}>
              {live ? 'Live · every 5s' : 'Paused'}
            </Button>
          </div>
        </div>

        {!clinic && (
          <>
            <div className="table-wrap mb-4">
              <table className="table">
                <tbody>
                  {(search?.data ?? []).map((c) => (
                    <tr key={c.id} className="is-clickable" onClick={() => setClinic(c)}>
                      <td>{c.name}</td>
                      <td className="stamp">
                        {Number(c.latitude).toFixed(3)}, {Number(c.longitude).toFixed(3)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <EmptyState
              title="Choose an origin"
              text="Pick a clinic to search for nurses around it."
            />
          </>
        )}

        {clinic && (
          <div className="grid grid--side">
            <div>
              {origin ? (
                <MapContainer
                  center={[origin.lat, origin.lng]}
                  zoom={12}
                  className="map"
                  scrollWheelZoom={false}
                >
                  <TileLayer
                    attribution='&copy; OpenStreetMap contributors'
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                  />
                  <Recenter lat={origin.lat} lng={origin.lng} />
                  <Circle
                    center={[origin.lat, origin.lng]}
                    radius={Number(radius)}
                    pathOptions={{ color: '#2D5A4C', fillOpacity: 0.05, weight: 1 }}
                  />
                  <Marker position={[origin.lat, origin.lng]} icon={originIcon}>
                    <Popup>{clinic.name}</Popup>
                  </Marker>
                  {nurses.map((n) => (
                    <Marker
                      key={n.nurse_id}
                      // GeoJSON is [lng, lat]; Leaflet wants [lat, lng].
                      position={[n.location.coordinates[1], n.location.coordinates[0]]}
                      icon={nurseIcon}
                    >
                      <Popup>
                        <strong>{n.name ?? n.nurse_id}</strong><br />
                        {(n.distance_m / 1000).toFixed(2)} km away<br />
                        {n.phone}
                      </Popup>
                    </Marker>
                  ))}
                </MapContainer>
              ) : (
                <div className="map state" style={{ display: 'grid', placeItems: 'center' }}>
                  Loading map…
                </div>
              )}
            </div>

            <div>
              <AsyncBlock
                loading={loading && nurses.length === 0}
                error={error}
                isEmpty={nurses.length === 0}
                empty={
                  <EmptyState
                    title="No active nurses in range"
                    text="Try a wider radius or another clinic. An empty result also appears once the ping TTL has expired."
                  />
                }
              >
                <Table columns={['Nurse', 'Based at', { label: 'Distance', align: 'right' }]}>
                  {nurses.map((n) => (
                    <tr key={n.nurse_id}>
                      <td>
                        {n.name ?? n.nurse_id}
                        <div className="stamp">last seen <Stamp value={n.created_at} /></div>
                      </td>
                      <td className="stamp">{n.home_clinic_name ?? '—'}</td>
                      <td className="num">{(n.distance_m / 1000).toFixed(2)} km</td>
                    </tr>
                  ))}
                </Table>
              </AsyncBlock>

              {nurses.length > 0 && (
                <Banner variant="info">
                  Nurse pings expire after 24 hours. Re-run the Mongo seeder before a demo if
                  this list empties.
                </Banner>
              )}
            </div>
          </div>
        )}
      </Card>
    </>
  );
}
