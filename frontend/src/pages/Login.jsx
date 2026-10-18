import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { Banner, Field, useAction, usePageTitle } from '../components/ui.jsx';

export default function Login() {
  usePageTitle('Sign in');
  const { login } = useAuth();
  const navigate = useNavigate();
  const { busy, error, run } = useAction();
  const [form, setForm] = useState({ email: '', password: '' });

  const submit = (e) => {
    e.preventDefault();
    run(async () => { await login(form.email, form.password); navigate('/'); });
  };
  return (
    <div className="auth-wrap">
      <h1>SafeZone</h1>
      <p className="muted">Sign in to your safety account.</p>
      <form className="card" onSubmit={submit} noValidate>
        {error && <Banner kind="danger" title="Could not sign in:">{error.message}</Banner>}
        <div style={{ height: '.75rem' }} />
        <Field label="Email" id="email"><input id="email" type="email" autoComplete="username" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
        <Field label="Password" id="password"><input id="password" type="password" autoComplete="current-password" required value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></Field>
        <button type="submit" disabled={busy} style={{ width: '100%' }}>{busy ? 'Signing in…' : 'Sign in'}</button>
        <p className="center small" style={{ marginTop: '1rem' }}><Link to="/forgot-password">Forgot your password?</Link></p>
      </form>
      <p className="center">New here? <Link to="/register">Create an account</Link></p>
      <p className="center small muted">SafeZone sends alerts about places and emergencies you set up. It cannot detect abuse and is not a replacement for local emergency services.</p>
    </div>
  );
}
