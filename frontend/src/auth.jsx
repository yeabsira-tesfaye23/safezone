import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { post, refreshSession, setAccessToken, setSessionEndHandler } from './lib/api.js';

const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const endSession = useCallback(() => { setAccessToken(null); setUser(null); }, []);

  useEffect(() => {
    setSessionEndHandler(endSession);
    // On page load, try to restore the session from the httpOnly refresh cookie.
    refreshSession().then((data) => { if (data) setUser(data.user); }).finally(() => setLoading(false));
  }, [endSession]);

  const value = useMemo(() => ({
    user, loading,
    async login(email, password) {
      const data = await post('/auth/login', { email, password }).catch((e) => { throw e; });
      setAccessToken(data.accessToken); setUser(data.user); return data.user;
    },
    async register(form) {
      const data = await post('/auth/register', form);
      setAccessToken(data.accessToken); setUser(data.user); return data.user;
    },
    async logout() { try { await post('/auth/logout'); } finally { endSession(); } },
    endSession,
  }), [user, loading, endSession]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
