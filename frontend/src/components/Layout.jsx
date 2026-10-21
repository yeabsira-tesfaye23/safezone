import { useCallback, useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { get } from '../lib/api.js';
import { flushQueue } from '../lib/sosQueue.js';
import { GeofenceProvider } from './Geofence.jsx';
import { ThemeToggle, useInterval } from './ui.jsx';

const NAV = {
  child: [['/', 'Home'], ['/sos', 'SOS'], ['/zones', 'My zones'], ['/report', 'Report a problem'], ['/notifications', 'Alerts'], ['/privacy-settings', 'Privacy & permissions']],
  guardian: [['/', 'Home'], ['/zones', 'Safe zones'], ['/notifications', 'Alerts'], ['/reports', 'Shared reports'], ['/account', 'Account']],
  admin: [['/', 'Dashboard'], ['/notifications', 'Alerts'], ['/account', 'Account']],
};

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [counts, setCounts] = useState({ unread: 0, urgentUnread: 0, latestUrgent: null });

  const poll = useCallback(async () => {
    try {
      const data = await get('/notifications?limit=10');
      const urgent = data.items.find((n) => n.urgent && !n.readAt && n.kind === 'sos');
      setCounts((prev) => {
        // Show a system notification once per new urgent alert, if the user allowed notifications.
        if (urgent && urgent.id !== prev.latestUrgent && 'Notification' in window && Notification.permission === 'granted') {
          try { new Notification(urgent.title, { body: 'Open SafeZone now.', requireInteraction: true }); } catch { /* not supported */ }
        }
        return { unread: data.unread, urgentUnread: data.urgentUnread, latestUrgent: urgent?.id ?? null, urgent };
      });
    } catch { /* offline: keep the last known counts */ }
  }, []);

  useEffect(() => { poll(); }, [poll]);
  useInterval(poll, 6000);
  // A child's queued SOS alerts are retried here, so they go out as soon as the connection returns.
  useInterval(() => { if (user.role === 'child') flushQueue().then((d) => d.length && poll()); }, 10000);
  useEffect(() => {
    if (user.role !== 'child') return undefined;
    const onOnline = () => flushQueue().then(poll);
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [user.role, poll]);

  const urgent = counts.urgent;
  const shell = (
    <>
      <a className="skip" href="#main">Skip to content</a>
      {urgent && user.role !== 'child' && (
        <div className="urgent-bar" role="alert">
          URGENT: {urgent.title}. <Link to={`/alerts/${urgent.sourceId}`}>Open the alert</Link>
        </div>
      )}
      <header className="topbar">
        <div className="topbar-inner">
          <Link to="/" className="brand">SafeZone</Link>
          <nav className="nav" aria-label="Main">
            {NAV[user.role].map(([to, label]) => (
              <NavLink key={to} to={to} end={to === '/'}>
                {label}
                {to === '/notifications' && counts.unread > 0 && <span className="badge-count" aria-label={`${counts.unread} unread`}>{counts.unread}</span>}
              </NavLink>
            ))}
          </nav>
          <div className="who">
            <ThemeToggle />
            <span>{user.fullName} ({user.role})</span>
            <button className="secondary small" onClick={async () => { await logout(); navigate('/login'); }}>Sign out</button>
          </div>
        </div>
      </header>
      <main id="main" tabIndex={-1}>
        <Outlet context={{ refreshCounts: poll }} />
      </main>
    </>
  );
  // Zone checking runs on the child's device for as long as the app is open.
  return user.role === 'child' ? <GeofenceProvider>{shell}</GeofenceProvider> : shell;
}
