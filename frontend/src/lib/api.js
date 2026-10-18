// Small fetch wrapper. The access token lives only in memory (never localStorage); the refresh token is an
// httpOnly cookie the browser sends by itself. A 401 triggers one silent refresh, then the call is retried.
let accessToken = null;
let refreshing = null;
let onSessionEnd = () => {};

export const setAccessToken = (t) => { accessToken = t; };
export const setSessionEndHandler = (fn) => { onSessionEnd = fn; };

export function deviceId() {
  try {
    let id = localStorage.getItem('sz_device');
    if (!id) { id = crypto.randomUUID(); localStorage.setItem('sz_device', id); }
    return id;
  } catch { return 'unknown'; }
}

export class ApiError extends Error {
  constructor(status, message, code) { super(message); this.status = status; this.code = code; }
}

async function raw(path, { method = 'GET', body, auth = true } = {}) {
  const headers = { 'x-device-id': deviceId() };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (auth && accessToken) headers.authorization = `Bearer ${accessToken}`;
  let res;
  try {
    res = await fetch(`/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), credentials: 'same-origin' });
  } catch {
    throw new ApiError(0, 'You appear to be offline or the server cannot be reached.', 'network');
  }
  let data = null;
  try { data = await res.json(); } catch { /* no body */ }
  return { res, data };
}

export async function refreshSession() {
  if (!refreshing) {
    refreshing = (async () => {
      try {
        const res = await fetch('/api/auth/refresh', { method: 'POST', headers: { 'x-requested-with': 'safezone', 'x-device-id': deviceId() }, credentials: 'same-origin' });
        if (!res.ok) return null;
        const data = await res.json();
        accessToken = data.accessToken;
        return data;
      } catch { return null; } finally { setTimeout(() => { refreshing = null; }, 0); }
    })();
  }
  return refreshing;
}

export async function api(path, opts = {}) {
  let { res, data } = await raw(path, opts);
  if (res.status === 401 && opts.auth !== false && data?.code === 'token_expired') {
    const ok = await refreshSession();
    if (!ok) { onSessionEnd(); throw new ApiError(401, 'Your session ended. Please sign in again.', 'session_ended'); }
    ({ res, data } = await raw(path, opts));
  }
  if (!res.ok) throw new ApiError(res.status, data?.error || 'Something went wrong', data?.code);
  return data;
}

export const get = (p) => api(p);
export const post = (p, body = {}) => api(p, { method: 'POST', body });
export const put = (p, body) => api(p, { method: 'PUT', body });
export const patch = (p, body) => api(p, { method: 'PATCH', body });
export const del = (p, body) => api(p, { method: 'DELETE', body });
