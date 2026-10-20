import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { post } from '../lib/api.js';
import { Banner, Field, useAction, usePageTitle } from '../components/ui.jsx';

export default function Register() {
  usePageTitle('Create account');
  const { register } = useAuth();
  const navigate = useNavigate();
  const { busy, error, run } = useAction();
  const [pending, setPending] = useState(null); // email awaiting confirmation
  const [resent, setResent] = useState(false);
  const [form, setForm] = useState({ role: 'guardian', fullName: '', email: '', password: '', dateOfBirth: '', accepted: false });
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  const submit = (e) => {
    e.preventDefault();
    const body = { role: form.role, fullName: form.fullName, email: form.email, password: form.password, acceptedPrivacyNotice: form.accepted };
    if (form.role === 'child') body.dateOfBirth = form.dateOfBirth;
    run(async () => {
      const result = await register(body);
      if (result?.needsVerification) setPending(result.email); else navigate('/');
    });
  };
  const child = form.role === 'child';
  if (pending) {
    return (
      <div className="auth-wrap">
        <h1>Check your email</h1>
        <div className="card">
          <p>We sent a confirmation link to <strong>{pending}</strong>. Open it to activate your account, then sign in.</p>
          <p className="small muted">It can take a minute. Look in your spam folder too. If the address was typed wrong, no account can be activated; register again with the correct one.</p>
          {resent && <Banner kind="ok" live>If that account is waiting for confirmation, a new link has been sent.</Banner>}
          <button type="button" className="secondary" onClick={() => post('/auth/resend-verification', { email: pending }).then(() => setResent(true)).catch(() => {})}>Send the link again</button>
        </div>
        <p className="center"><Link to="/login">Go to sign in</Link></p>
      </div>
    );
  }
  return (
    <div className="auth-wrap">
      <h1>Create your account</h1>
      <form className="card" onSubmit={submit} noValidate>
        {error && <Banner kind="danger" title="Could not create the account:">{error.message}</Banner>}
        <fieldset style={{ border: 0, padding: 0, margin: '1rem 0 0' }}>
          <legend><strong>I am a…</strong></legend>
          <label className="choice"><input type="radio" name="role" checked={!child} onChange={() => setForm({ ...form, role: 'guardian' })} /><span><strong>Parent or guardian</strong>I want to set up safe places and receive alerts about someone I care for.</span></label>
          <label className="choice"><input type="radio" name="role" checked={child} onChange={() => setForm({ ...form, role: 'child' })} /><span><strong>Young person (under 18)</strong>I want an SOS button and a way to report problems.</span></label>
        </fieldset>
        <Field label="Full name" id="name"><input id="name" type="text" autoComplete="name" required value={form.fullName} onChange={set('fullName')} /></Field>
        <Field label="Email" id="email"><input id="email" type="email" autoComplete="email" required value={form.email} onChange={set('email')} /></Field>
        {child && (
          <Field label="Date of birth" id="dob" hint="We use this only to check that a young person's account is for someone under 18."><input id="dob" type="date" required value={form.dateOfBirth} onChange={set('dateOfBirth')} /></Field>
        )}
        <Field label="Password" id="password" hint="At least 10 characters. A few random words is a good password."><input id="password" type="password" autoComplete="new-password" required minLength={10} value={form.password} onChange={set('password')} /></Field>
        <div className="note" style={{ marginBottom: '1rem' }}>
          <p><strong>{child ? 'What you should know' : 'Privacy notice'}</strong></p>
          <ul className="small" style={{ margin: 0, paddingLeft: '1.2rem' }}>
            <li>{child ? 'Nobody can see where you are unless you connect a guardian and you agree to it.' : 'You can only see a young person\'s information after she accepts your connection, and only what she chooses to share.'}</li>
            <li>{child ? 'You can pause or end sharing any time. Your guardian is told it was paused, but not why.' : 'She can pause or end sharing at any time.'}</li>
            <li>Alerts come from places and buttons, not from watching someone. SafeZone cannot tell if a crime happened.</li>
          </ul>
          <p className="small" style={{ margin: '.5rem 0 0' }}><Link to="/privacy" target="_blank" rel="noopener">Read the full privacy notice</Link></p>
        </div>
        <label className="choice"><input type="checkbox" checked={form.accepted} onChange={set('accepted')} required /><span><strong>I have read and accept the privacy notice</strong></span></label>
        <button type="submit" disabled={busy || !form.accepted} style={{ width: '100%', marginTop: '.5rem' }}>{busy ? 'Creating…' : 'Create account'}</button>
      </form>
      <p className="center">Already have an account? <Link to="/login">Sign in</Link></p>
    </div>
  );
}
