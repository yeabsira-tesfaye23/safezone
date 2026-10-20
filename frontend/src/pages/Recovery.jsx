import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { post } from '../lib/api.js';
import { Banner, Field, useAction, usePageTitle } from '../components/ui.jsx';

export function ForgotPassword() {
  usePageTitle('Reset password');
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const { busy, error, run } = useAction();
  return (
    <div className="auth-wrap">
      <h1>Reset your password</h1>
      {sent ? (
        <Banner kind="ok" live>If that email is registered, a reset link has been sent. The link works for 30 minutes.</Banner>
      ) : (
        <form className="card" onSubmit={(e) => { e.preventDefault(); run(async () => { await post('/auth/forgot-password', { email }); setSent(true); }); }}>
          {error && <Banner kind="danger" title="Problem:">{error.message}</Banner>}
          <Field label="Your email" id="email"><input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
          <button type="submit" disabled={busy}>Send reset link</button>
        </form>
      )}
      <p className="center"><Link to="/login">Back to sign in</Link></p>
    </div>
  );
}

export function ResetPassword() {
  usePageTitle('Choose a new password');
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const { busy, error, run } = useAction();
  return (
    <div className="auth-wrap">
      <h1>Choose a new password</h1>
      <form className="card" onSubmit={(e) => { e.preventDefault(); run(async () => { await post('/auth/reset-password', { token: params.get('token') || '', newPassword: password }); navigate('/login'); }); }}>
        {error && <Banner kind="danger" title="Problem:">{error.message}</Banner>}
        <Field label="New password" id="pw" hint="At least 8 characters, with a capital letter, a number and a special character (for example ! @ # $)."><input id="pw" type="password" autoComplete="new-password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
        <button type="submit" disabled={busy}>Save new password</button>
      </form>
    </div>
  );
}
