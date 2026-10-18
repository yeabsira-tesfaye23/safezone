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
