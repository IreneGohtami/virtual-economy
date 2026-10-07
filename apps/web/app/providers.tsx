'use client';

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { api, setTokens, clearTokens, getTokens } from '@/lib/api-client';
import { wsClient } from '@/lib/ws-client';

interface Player {
  id: string;
  email: string;
  displayName: string;
  avatarUrl?: string;
  role?: string;
}

interface AuthState {
  player: Player | null;
  loading: boolean;
  error: string | null;
}

interface AuthContextValue extends AuthState {
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, displayName: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within a Providers component');
  }
  return context;
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({
    player: null,
    loading: true,
    error: null,
  });

  // Check for existing session on mount
  useEffect(() => {
    const { accessToken } = getTokens();
    if (accessToken) {
      api.get<{ player: Player }>('/players/me')
        .then((data) => {
          const player = (data as any).player || data;
          setState({ player, loading: false, error: null });
          wsClient.connect();
        })
        .catch(() => {
          clearTokens();
          setState({ player: null, loading: false, error: null });
        });
    } else {
      setState((s) => ({ ...s, loading: false }));
    }
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await api.post<{ accessToken: string; refreshToken: string; player: Player }>(
        '/auth/login',
        { email, password },
        { skipAuth: true },
      );
      setTokens(data.accessToken, data.refreshToken);
      setState({ player: data.player, loading: false, error: null });
      wsClient.connect();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Login failed';
      setState({ player: null, loading: false, error: message });
      throw err;
    }
  }, []);

  const register = useCallback(async (email: string, password: string, displayName: string) => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await api.post<{ accessToken: string; refreshToken: string; player: Player }>(
        '/auth/register',
        { email, password, displayName },
        { skipAuth: true },
      );
      setTokens(data.accessToken, data.refreshToken);
      setState({ player: data.player, loading: false, error: null });
      wsClient.connect();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Registration failed';
      setState({ player: null, loading: false, error: message });
      throw err;
    }
  }, []);

  const logout = useCallback(() => {
    clearTokens();
    wsClient.disconnect();
    setState({ player: null, loading: false, error: null });
  }, []);

  return (
    <AuthContext.Provider value={{ ...state, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}
