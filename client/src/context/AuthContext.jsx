import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { authAPI } from '../services/api';
import api from '../services/api';

const AuthContext = createContext();

const readSavedUser = () => {
  try {
    const saved = localStorage.getItem('pharm_user');
    return saved ? JSON.parse(saved) : null;
  } catch (_) {
    return null;
  }
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(readSavedUser);

  const persistSession = useCallback((token, nextUser) => {
    localStorage.setItem('pharm_token', token);
    localStorage.setItem('pharm_user', JSON.stringify(nextUser));
    setUser(nextUser);
  }, []);

  const login = async (username, password) => {
    try {
      const res = await authAPI.login({ username, password });
      if (res.data.token) {
        persistSession(res.data.token, res.data.user);
        return { success: true };
      }
      return { success: false, error: 'Login failed' };
    } catch (err) {
      const apiError = err?.response?.data?.error;
      const message = typeof apiError === 'string'
        ? apiError
        : apiError?.message || 'Login failed. Please check your connection and try again.';
      return { success: false, error: message };
    }
  };

  /*
   * Guest Mode — the visitor provides their NAME (required & validated on
   * both ends). The server issues a READ-ONLY guest session; every write
   * request made with it is rejected server-side.
   */
  const loginAsGuest = async (guestName) => {
    try {
      const res = await authAPI.guest(guestName);
      if (res.data.token) {
        persistSession(res.data.token, { ...res.data.user, is_guest: true });
        return { success: true };
      }
      return { success: false, error: 'Could not start guest session' };
    } catch (err) {
      const apiError = err?.response?.data?.error;
      const message = typeof apiError === 'string' ? apiError : 'Could not start guest session';
      return { success: false, error: message };
    }
  };

  /*
   * Logout is SERVER-Authoritative:
   *  1. tell the backend to close the session row (audit event + the JWT
   *     becomes unusable immediately, even if a copy of the token remains);
   *  2. only then clear local state.
   */
  const logout = useCallback(async () => {
    try {
      const token = localStorage.getItem('pharm_token');
      if (token) {
        await api.post('/auth/logout', {}).catch(() => {});
      }
    } catch (_) {
      // Network errors must never trap the user inside the session.
    } finally {
      localStorage.removeItem('pharm_token');
      localStorage.removeItem('pharm_user');
      setUser(null);
    }
  }, []);

  const isGuest = Boolean(user?.is_guest || user?.role === 'GUEST');

  return (
    <AuthContext.Provider value={{ user, isGuest, setUser, login, loginAsGuest, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
