import { Link } from 'react-router-dom';
import { usePageTitle } from '../components/ui.jsx';

export default function PrivacyNotice() {
  usePageTitle('Privacy notice');
  return (
    <div className="auth-wrap" style={{ maxWidth: 760 }}>
      <h1>Privacy notice</h1>
      <div className="card stack">
        <p>This notice is written to be read by young people and parents alike. This is a university project prototype: use test data only.</p>
        <h2>What SafeZone does</h2>
        <p>Guardians draw safe places (like home or school). The young person's phone checks, on the phone itself, whether she is inside or outside each place. Only the answer "inside" or "outside", plus how accurate the GPS was, is sent to the server. Her coordinates are not sent for this.</p>
        <p>She can press SOS to send an alert, and can choose to share her location once ("check-in"). Those are the only times a location is sent.</p>
        <h2>What SafeZone does not do</h2>
        <ul>
          <li>It does not track anyone continuously or keep a history of where she has been.</li>
          <li>It cannot tell if abuse or a crime has happened, and it never labels anyone as an offender.</li>
          <li>It cannot guarantee that an alert is read in time. In an emergency, contact local emergency services.</li>
        </ul>
        <h2>Who can see what</h2>
        <ul>
          <li><strong>The young person:</strong> everything about herself, and who has access.</li>
          <li><strong>A guardian:</strong> only after she accepts the connection, and only what she shares: zone arrivals/departures and SOS alerts. A guardian never sees why she paused sharing.</li>
          <li><strong>Administrators:</strong> accounts and incident reports. Administrators cannot see locations.</li>
        </ul>
        <h2>Incident reports</h2>
        <p>Reports are encrypted in storage. By default only the person who wrote it and administrators can read it. She can choose to also show it to her guardians.</p>
        <h2>How long data is kept</h2>
        <ul>
          <li>Zone arrival/departure events: 30 days. SOS alerts: 90 days. Check-ins: 7 days. Notifications: 90 days.</li>
          <li>Closed incident reports: 1 year. Audit records: 12 months.</li>
          <li>You can delete your location data at any time from Account. Reports still under review are kept until they are closed.</li>
        </ul>
        <h2>Security</h2>
        <p>Passwords are stored as one-way hashes. Every time someone views sensitive information, a record is kept that an administrator can review.</p>
        <p><Link to="/login">Back to sign in</Link></p>
      </div>
    </div>
  );
}
