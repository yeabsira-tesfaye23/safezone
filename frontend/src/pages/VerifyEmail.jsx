import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { post } from '../lib/api.js';
import { Banner, usePageTitle } from '../components/ui.jsx';

export default function VerifyEmail() {
  usePageTitle('Confirm your email');
  const [params] = useSearchParams();
  const [state, setState] = useState({ status: 'working', message: '' });

  useEffect(() => {
    const token = params.get('token');
    if (!token) { setState({ status: 'error', message: 'This link is incomplete. Open the link from your email again.' }); return; }
    post('/auth/verify-email', { token }, { auth: false })
      .then(() => setState({ status: 'ok', message: '' }))
      .catch((e) => setState({ status: 'error', message: e.message }));
  }, [params]);

  return (
    <div className="auth-wrap">
      <h1>Confirm your email</h1>
      {state.status === 'working' && <p role="status">Confirming…</p>}
      {state.status === 'ok' && <Banner kind="ok" live>Your email is confirmed. You can sign in now.</Banner>}
      {state.status === 'error' && <Banner kind="danger" title="Problem:">{state.message}</Banner>}
      <p className="center"><Link to="/login">Go to sign in</Link></p>
    </div>
  );
}
