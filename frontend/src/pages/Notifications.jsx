import { Link, useOutletContext } from 'react-router-dom';
import { useState } from 'react';
import { Banner, ErrorNote, Loading, Pill, useAction, useAsync, useInterval, usePageTitle } from '../components/ui.jsx';
import { get, post } from '../lib/api.js';
import { fmtTime } from '../lib/format.js';

const KIND = { sos: ['danger', 'URGENT · SOS'], zone: ['info', 'Zone alert'], system: ['gray', 'Notice'] };

export default function Notifications() {
  usePageTitle('Alerts');
  const { refreshCounts } = useOutletContext() ?? {};
  const list = useAsync(() => get('/notifications?limit=100'), []);
  useInterval(list.reload, 8000);
  const act = useAction();
  const [perm, setPerm] = useState('Notification' in window ? Notification.permission : 'unsupported');

  const markRead = (id) => act.run(async () => { await post(`/notifications/${id}/read`); await list.reload(); refreshCounts?.(); });
  const markAll = () => act.run(async () => { await post('/notifications/read-all'); await list.reload(); refreshCounts?.(); });

  return (
    <div className="stack">
      <div className="row between"><h1>Alerts</h1><button className="secondary" onClick={markAll} disabled={!list.data?.unread}>Mark all as read</button></div>
      {perm === 'default' && (
        <Banner kind="info" title="Get a pop-up for emergencies:">
          Allow browser notifications so urgent alerts show up even when this tab is in the background.{' '}
          <button className="small" onClick={async () => setPerm(await Notification.requestPermission())}>Turn on pop-ups</button>
        </Banner>
      )}
      <p className="small muted">Alerts appear here while SafeZone is open. This prototype does not send phone push messages, so keep the app open or check often.</p>
      <ErrorNote error={act.error} />
      {list.loading ? <Loading /> : list.data.items.length === 0 ? <p className="muted">No alerts yet.</p> : (
        <ul className="list" style={{ display: 'grid', gap: '.75rem' }}>
          {list.data.items.map((n) => {
            const [pill, label] = KIND[n.kind] ?? KIND.system;
            return (
              <li key={n.id} style={{ border: 0, padding: 0 }}>
                <article className={`note ${n.urgent ? 'urgent' : n.kind === 'zone' ? 'zone' : ''} ${n.readAt ? '' : 'unread'}`}>
                  <div className="row between">
                    <span className="row"><Pill kind={pill}>{label}</Pill>{!n.readAt && <Pill kind="warn">New</Pill>}</span>
                    <time dateTime={n.createdAt} className="small muted">{fmtTime(n.createdAt)}</time>
                  </div>
                  <h2 style={{ fontSize: '1.1rem', margin: '.4rem 0 .2rem' }}>{n.title}</h2>
                  <p style={{ margin: 0 }}>{n.body}</p>
                  <div className="row" style={{ marginTop: '.5rem' }}>
                    {n.sourceType === 'sos' && n.sourceId && <Link className="btn small" to={`/alerts/${n.sourceId}`}>Open alert</Link>}
                    {!n.readAt && <button className="small secondary" onClick={() => markRead(n.id)}>Mark as read</button>}
                  </div>
                </article>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
