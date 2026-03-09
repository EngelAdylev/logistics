import React, { createContext, useContext, useState, useEffect } from 'react';
import { api, setAccessToken, clearAccessToken } from '../api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchMe = async () => {
    try {
      const res = await api.get('/auth/me');
      setUser(res.data);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  };

  const login = async (login, password) => {
    const res = await api.post('/auth/login', { login, password });
    setAccessToken(res.data.access_token);
    setUser(res.data.user);
  };

  const logout = async () => {
    try {
      await api.post('/auth/logout');
    } finally {
      clearAccessToken();
      setUser(null);
    }
  };

  useEffect(() => {
    const check = async () => {
      try {
        const res = await api.get('/auth/me');
        const tok = res.config?.headers?.Authorization?.replace('Bearer ', '');
        if (tok) setAccessToken(tok);
        setUser(res.data);
      } catch (e) {
        setUser(null);
        clearAccessToken();
      } finally {
        setLoading(false);
      }
    };
    check();
  }, []);

  useEffect(() => {
    const onLogout = () => {
      setUser(null);
      clearAccessToken();
    };
    window.addEventListener('auth:logout', onLogout);
    return () => window.removeEventListener('auth:logout', onLogout);
  }, []);

  const authReady = !loading;
  const authFailed = !loading && !user;

  return (
    <AuthContext.Provider value={{
      user,
      loading,
      authLoading: loading,
      authReady,
      authFailed,
      login,
      logout,
      fetchMe,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
