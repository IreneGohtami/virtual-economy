'use client';

import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api } from './api-client';

interface WalletState {
  coins: number | null;
  seasonEndsAt: string | null;
}

interface WalletContextValue extends WalletState {
  refreshWallet: () => Promise<void>;
}

const WalletContext = createContext<WalletContextValue | null>(null);

export function useWallet(): WalletContextValue {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error('useWallet must be used within WalletProvider');
  return ctx;
}

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<WalletState>({ coins: null, seasonEndsAt: null });

  const refreshWallet = useCallback(async () => {
    try {
      const data = await api.get<{ season: { coins: number } | null; activeSeason: { endsAt: string } | null }>('/players/me');
      setState({
        coins: data.season?.coins ?? null,
        seasonEndsAt: data.activeSeason?.endsAt ?? null,
      });
    } catch {
      // ignore
    }
  }, []);

  // Initial fetch
  useEffect(() => {
    refreshWallet();
  }, [refreshWallet]);

  return (
    <WalletContext.Provider value={{ ...state, refreshWallet }}>
      {children}
    </WalletContext.Provider>
  );
}
