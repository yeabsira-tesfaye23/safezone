import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth.jsx';
import Layout from './components/Layout.jsx';
import Account from './pages/Account.jsx';
import Admin from './pages/Admin.jsx';
import AlertDetail from './pages/AlertDetail.jsx';
import ChildHome from './pages/ChildHome.jsx';
import ChildZones from './pages/ChildZones.jsx';
import GuardianHome from './pages/GuardianHome.jsx';
import GuardianReports from './pages/GuardianReports.jsx';
import GuardianZones from './pages/GuardianZones.jsx';
import Login from './pages/Login.jsx';
import Notifications from './pages/Notifications.jsx';
import PrivacyNotice from './pages/PrivacyNotice.jsx';
import PrivacySettings from './pages/PrivacySettings.jsx';
import { ForgotPassword, ResetPassword } from './pages/Recovery.jsx';
import Register from './pages/Register.jsx';
import Report from './pages/Report.jsx';
import Sos from './pages/Sos.jsx';

function Guard({ roles, children }) {
  const { user } = useAuth();
  return roles.includes(user.role) ? children : <Navigate to="/" replace />;
}
const Home = () => {
  const { user } = useAuth();
  return user.role === 'child' ? <ChildHome /> : user.role === 'guardian' ? <GuardianHome /> : <Admin />;
};
const Zones = () => {
  const { user } = useAuth();
  return user.role === 'child' ? <ChildZones /> : <GuardianZones />;
};

export default function App() {
  const { user, loading } = useAuth();
  if (loading) return <p role="status" className="center" style={{ marginTop: '3rem' }}>Loading SafeZone…</p>;
  if (!user) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/privacy" element={<PrivacyNotice />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }
  return (
    <Routes>
      <Route path="/privacy" element={<PrivacyNotice />} />
      <Route element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="zones" element={<Guard roles={['child', 'guardian']}><Zones /></Guard>} />
        <Route path="notifications" element={<Notifications />} />
        <Route path="account" element={<Account />} />
        <Route path="sos" element={<Guard roles={['child']}><Sos /></Guard>} />
        <Route path="report" element={<Guard roles={['child']}><Report /></Guard>} />
        <Route path="privacy-settings" element={<Guard roles={['child']}><PrivacySettings /></Guard>} />
        <Route path="reports" element={<Guard roles={['guardian']}><GuardianReports /></Guard>} />
        <Route path="alerts/:id" element={<Guard roles={['child', 'guardian']}><AlertDetail /></Guard>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
