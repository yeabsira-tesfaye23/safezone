import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Map tiles need a real browser; replace the map with a stub so we test everything around it.
vi.mock('../components/MapView.jsx', () => ({ default: ({ label }) => <div role="region" aria-label={label} /> }));

const zone = { id: 'z1', childId: 'c1', name: 'School', lat: 9.4, lng: 42.0, radiusM: 200, active: true, state: { current: 'outside' } };
const data = {
  '/links': [
    { id: 'l1', status: 'active', initiatedBy: 'guardian', other: { id: 'c1', name: 'Demo Child', email: 'child@x.test' }, canRespond: false },
    { id: 'l2', status: 'pending', initiatedBy: 'child', other: { id: 'c2', name: 'New Kid', email: 'k@x.test' }, canRespond: true },
  ],
  '/me': { id: 'c1', role: 'child', fullName: 'Demo Child', email: 'child@x.test', sharing: { shareZoneEvents: true, shareSosLocation: true } },
  '/zones': [zone],
  '/zones?childId=c1': [zone],
  '/zones/events/recent': [{ id: 'e1', type: 'enter', zoneName: 'School', occurredAt: new Date().toISOString(), notified: true }],
  '/zones/events/recent?childId=c1': [{ id: 'e1', type: 'exit', zoneName: 'School', occurredAt: new Date().toISOString(), notified: false }],
  '/checkins/latest?childId=c1': { id: 'k1', lat: 9.4, lng: 42.0, accuracyM: 20, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 3600e3).toISOString() },
  '/sos/open': [{ id: 's1', childName: 'Demo Child', status: 'notified', triggeredAt: new Date().toISOString() }],
  '/sos/s1': { id: 's1', childName: 'Demo Child', status: 'notified', triggeredAt: new Date().toISOString(), serverReceivedAt: new Date().toISOString(), location: { lat: 9.4, lng: 42.0, accuracyM: 12 }, hasLocation: true },
  '/contacts': [{ id: 'ct1', displayName: 'Auntie', phone: '+251911000000', hasAccount: false }],
  '/reports': [{ id: 'r1', category: 'harassment', description: 'Test text', status: 'submitted', visibility: 'admin_only', createdAt: new Date().toISOString(), childName: 'Demo Child' }],
  '/notifications?limit=100': { items: [
    { id: 'n1', kind: 'sos', urgent: true, title: 'EMERGENCY: Demo pressed SOS', body: 'Open it', sourceType: 'sos', sourceId: 's1', createdAt: new Date().toISOString(), readAt: null },
    { id: 'n2', kind: 'zone', urgent: false, title: 'Demo left School', body: 'Routine zone alert.', createdAt: new Date().toISOString(), readAt: null },
  ], unread: 2, urgentUnread: 1 },
  '/admin/stats': { users: [{ role: 'child', status: 'active', n: 3 }], reports: [{ status: 'submitted', n: 1 }], sosLast30Days: 2, links: [{ status: 'active', n: 1 }] },
  '/admin/users': { page: 1, items: [{ id: 'g1', role: 'guardian', email: 'g@x.test', fullName: 'Gee', status: 'active', guardianVerified: false, createdAt: new Date().toISOString() }] },
  '/admin/reports': { page: 1, items: [{ id: 'r1', category: 'harassment', status: 'submitted', visibility: 'admin_only', createdAt: new Date().toISOString(), childName: 'Demo Child' }] },
  '/admin/signals': [{ guardianId: 'g1', fullName: 'Gee', email: 'g@x.test', pausedNow: 1, endedLast30Days: 0, totalLinks: 1, pauseReasons: ['too many check-ins'] }],
  '/admin/audit?page=1': { page: 1, items: [{ id: 1, action: 'report.read', actorName: 'Admin', actorRole: 'admin', targetType: 'report', targetId: 'abcdef123', ip: '::1', createdAt: new Date().toISOString() }] },
};

vi.mock('../lib/api.js', async () => {
  const lookup = (path) => { const k = Object.keys(data).find((x) => path === x || path.startsWith(x + '&') || path.split('?')[0] === x); return data[path] ?? (k ? data[k] : undefined); };
  const get = vi.fn(async (path) => { const v = lookup(path); if (v === undefined) throw Object.assign(new Error(`no mock for ${path}`), { status: 404 }); return v; });
  const post = vi.fn(async () => ({}));
  return { get, post, put: post, patch: post, del: post, api: get, ApiError: class extends Error {}, setAccessToken() {}, refreshSession: async () => null, setSessionEndHandler() {}, deviceId: () => 'dev' };
});

let currentUser;
vi.mock('../auth.jsx', () => ({ useAuth: () => ({ user: currentUser, logout: vi.fn(), endSession: vi.fn(), loading: false }), AuthProvider: ({ children }) => children }));

import { GeofenceProvider } from '../components/Geofence.jsx';
import Account from '../pages/Account.jsx';
import Admin from '../pages/Admin.jsx';
import AlertDetail from '../pages/AlertDetail.jsx';
import ChildHome from '../pages/ChildHome.jsx';
import ChildZones from '../pages/ChildZones.jsx';
import GuardianHome from '../pages/GuardianHome.jsx';
import GuardianReports from '../pages/GuardianReports.jsx';
import GuardianZones from '../pages/GuardianZones.jsx';
import Login from '../pages/Login.jsx';
import Notifications from '../pages/Notifications.jsx';
import PrivacyNotice from '../pages/PrivacyNotice.jsx';
import PrivacySettings from '../pages/PrivacySettings.jsx';
import Register from '../pages/Register.jsx';
import Report from '../pages/Report.jsx';
import Sos from '../pages/Sos.jsx';

const child = { id: 'c1', role: 'child', fullName: 'Demo Child', email: 'child@x.test' };
const guardian = { id: 'g1', role: 'guardian', fullName: 'Demo Guardian', email: 'g@x.test', guardianVerified: true };
const admin = { id: 'a1', role: 'admin', fullName: 'Admin', email: 'a@x.test' };

function show(ui, { path = '/', route = '/' } = {}) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <GeofenceProvider><Routes><Route path={route} element={ui} /></Routes></GeofenceProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => { localStorage.clear(); });

describe('every screen renders with realistic data', () => {
  it('login, register, privacy notice', () => {
    currentUser = null;
    show(<Login />); expect(screen.getByRole('button', { name: 'Sign in' })).toBeTruthy();
    cleanup2(); show(<Register />); expect(screen.getByRole('button', { name: /create account/i })).toBeTruthy();
    cleanup2(); show(<PrivacyNotice />); expect(screen.getByText(/Administrators cannot see locations/)).toBeTruthy();
  });

  it('child home shows zones, connections and the SOS entry point', async () => {
    currentUser = child; show(<ChildHome />);
    await waitFor(() => expect(screen.getByText('Connected')).toBeTruthy());
    expect(screen.getByText('Open the SOS button')).toBeTruthy();
    expect(screen.getByText(/Someone asked to connect/)).toBeTruthy(); // pending request surfaced
    await waitFor(() => expect(screen.getByText('You are outside')).toBeTruthy());
  });

  it('child zones, SOS, report, privacy settings', async () => {
    currentUser = child;
    show(<ChildZones />); await waitFor(() => expect(screen.getByText('Check my zones on this device')).toBeTruthy());
    cleanup2(); show(<Sos />); expect(screen.getByRole('button', { name: /send sos emergency alert/i })).toBeTruthy();
    cleanup2(); show(<Report />); await waitFor(() => expect(screen.getByText('My reports')).toBeTruthy());
    cleanup2(); show(<PrivacySettings />); await waitFor(() => expect(screen.getByText('Zone alerts')).toBeTruthy());
    expect(screen.getByText('Auntie')).toBeTruthy();
  });

  it('guardian home, zones, shared reports', async () => {
    currentUser = guardian;
    show(<GuardianHome />); await waitFor(() => expect(screen.getByText(/pressed SOS/)).toBeTruthy());
    expect(screen.getByText('Connection requests')).toBeTruthy();
    cleanup2(); show(<GuardianZones />); await waitFor(() => expect(screen.getByText('Safe zones')).toBeTruthy());
    cleanup2(); show(<GuardianReports />); await waitFor(() => expect(screen.getByText(/Test text/)).toBeTruthy());
  });

  it('alert detail, notifications, account', async () => {
    currentUser = guardian;
    show(<AlertDetail />, { path: '/alerts/s1', route: '/alerts/:id' });
    await waitFor(() => expect(screen.getByText(/SOS alert from Demo Child/)).toBeTruthy());
    expect(screen.getByRole('button', { name: /i have seen this alert/i })).toBeTruthy();
    cleanup2(); show(<Notifications />); await waitFor(() => expect(screen.getByText('URGENT · SOS')).toBeTruthy());
    cleanup2(); show(<Account />); expect(screen.getByText('Deactivate account')).toBeTruthy();
  });

  it('administrator dashboard tabs', async () => {
    currentUser = admin; show(<Admin />);
    await waitFor(() => expect(screen.getByText('Active children')).toBeTruthy());
    for (const [tab, text] of [['Accounts', 'Verify guardian'], ['Incident reports', 'Open (logged)'], ['Misuse signals', 'too many check-ins'], ['Audit log', 'report.read']]) {
      screen.getByRole('tab', { name: tab }).click();
      await waitFor(() => expect(screen.getAllByText(text).length).toBeGreaterThan(0));
    }
  });
});

import { cleanup } from '@testing-library/react';
const cleanup2 = () => cleanup();
