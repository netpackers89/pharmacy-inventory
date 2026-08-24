import React, { createContext, useContext, useState, useEffect } from 'react';
import { authAPI } from '../services/api';

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(() => {
    const saved = localStorage.getItem('pharm_user');
    return saved ? JSON.parse(saved) : null; // Removed hardcoded default user
  });

  const login = async (username, password) => {
    try {
      const res = await authAPI.login({ username, password });
      if (res.data.token) {
        localStorage.setItem('pharm_token', res.data.token);
        localStorage.setItem('pharm_user', JSON.stringify(res.data.user));
        setUser(res.data.user);
        return { success: true };
      }
    } catch (err) {
      const apiError = err?.response?.data?.error;
      const message = typeof apiError === 'string'
        ? apiError
        : apiError?.message || JSON.stringify(apiError) || 'Login failed';
      return { success: false, error: message };
    }
  };

  const signup = async (username, password, role) => {
    try {
      const res = await authAPI.signup({ username, password, role });
      if (res.data) {
        // Log them in automatically after signup
        return await login(username, password);
      }
    } catch (err) {
      const apiError = err?.response?.data?.error;
      const message = typeof apiError === 'string'
        ? apiError
        : apiError?.message || JSON.stringify(apiError) || 'Signup failed';
      return { success: false, error: message };
    }
  };

  const logout = () => {
    localStorage.removeItem('pharm_token');
    localStorage.removeItem('pharm_user');
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, setUser, login, signup, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
