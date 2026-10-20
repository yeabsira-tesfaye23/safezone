import { useCallback, useEffect, useRef, useState } from 'react';

export function Banner({ kind = 'info', title, children, live }) {
  const role = kind === 'danger' ? 'alert' : live ? 'status' : undefined;
  const icon = { info: 'Info:', ok: 'Done:', warn: 'Notice:', danger: 'Important:' }[kind];
  return (
    <div className={`banner ${kind}`} role={role}>
      <strong>{title || icon}</strong>
      <div>{children}</div>
    </div>
  );
}

export const Pill = ({ kind = 'gray', children }) => <span className={`pill ${kind}`}>{children}</span>;

export function Field({ label, hint, error, children, id }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children}
      {hint && <div className="hint" id={`${id}-hint`}>{hint}</div>}
      {error && <div className="error-text" role="alert">{error}</div>}
    </div>
  );
}

// Password box with a show/hide button, so people can check what they typed.
export function PasswordInput(props) {
  const [shown, setShown] = useState(false);
  return (
    <div className="pw-wrap">
      <input {...props} type={shown ? 'text' : 'password'} />
      <button type="button" className="pw-toggle" onClick={() => setShown(!shown)} aria-label={shown ? 'Hide password' : 'Show password'} aria-pressed={shown}>
        {shown ? (
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
        ) : (
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
        )}
      </button>
    </div>
  );
}

// Load data on mount (and when `deps` change) with loading and error state.
export function useAsync(fn, deps = []) {
  const [state, setState] = useState({ loading: true, data: null, error: null });
  const alive = useRef(true);
  const run = useCallback(async () => {
    try {
      const data = await fn();
      if (alive.current) setState({ loading: false, data, error: null });
    } catch (error) {
      if (alive.current) setState((s) => ({ loading: false, data: s.data, error }));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { alive.current = true; run(); return () => { alive.current = false; }; }, [run]);
  return { ...state, reload: run };
}

// Call `fn` every `ms` while the tab is visible.
export function useInterval(fn, ms) {
  const saved = useRef(fn);
  saved.current = fn;
  useEffect(() => {
    const tick = () => { if (document.visibilityState === 'visible') saved.current(); };
    const id = setInterval(tick, ms);
    return () => clearInterval(id);
  }, [ms]);
}

export function Loading({ label = 'Loading…' }) {
  return <p role="status" className="muted">{label}</p>;
}

export function ErrorNote({ error }) {
  if (!error) return null;
  return <Banner kind="danger" title="Problem:">{error.message}</Banner>;
}

export function usePageTitle(title) {
  useEffect(() => { document.title = `${title} · SafeZone`; }, [title]);
}

// Run an async action with a busy flag and error message.
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const run = useCallback(async (fn) => {
    setBusy(true); setError(null);
    try { return await fn(); } catch (e) { setError(e); return undefined; } finally { setBusy(false); }
  }, []);
  return { busy, error, run, setError };
}
