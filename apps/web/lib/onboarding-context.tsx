'use client';

import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api } from './api-client';

export interface OnboardingState {
  hasSpecialty: boolean;
  hasLand: boolean;
  hasFactory: boolean;
  hasWorker: boolean;
  loading: boolean;
  /** The href of the nav item for the next incomplete step, or null if onboarding is done */
  nextStepHref: string | null;
}

interface OnboardingContextValue extends OnboardingState {
  refreshOnboarding: () => void;
}

const OnboardingContext = createContext<OnboardingContextValue | null>(null);

export function useOnboarding(): OnboardingContextValue {
  const ctx = useContext(OnboardingContext);
  if (!ctx) throw new Error('useOnboarding must be used within OnboardingProvider');
  return ctx;
}

function getNextStepHref(state: { hasSpecialty: boolean; hasLand: boolean; hasFactory: boolean; hasWorker: boolean }): string | null {
  if (!state.hasSpecialty) return '/dashboard';
  if (!state.hasLand) return '/map';
  if (!state.hasFactory) return '/factories';
  if (!state.hasWorker) return '/workers';
  return null; // onboarding complete
}

export function OnboardingProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<OnboardingState>({
    hasSpecialty: false,
    hasLand: false,
    hasFactory: false,
    hasWorker: false,
    loading: true,
    nextStepHref: null,
  });

  const refreshOnboarding = useCallback(() => {
    Promise.all([
      api.get<{ season: { specialty: string | null; coins: number } | null; netWorth: { landValue: number } | null }>('/players/me/dashboard'),
      api.get<{ id: string }[]>('/factories').catch(() => []),
      api.get<{ id: string }[]>('/workers/mine').catch(() => []),
    ])
      .then(([dashboard, factories, workers]) => {
        const hasSpecialty = !!dashboard.season?.specialty;
        const hasLand = (dashboard.netWorth?.landValue ?? 0) > 0;
        const hasFactory = factories.length > 0;
        const hasWorker = workers.length > 0;

        const progress = { hasSpecialty, hasLand, hasFactory, hasWorker };
        setState({
          ...progress,
          loading: false,
          nextStepHref: getNextStepHref(progress),
        });
      })
      .catch(() => {
        setState((prev) => ({ ...prev, loading: false }));
      });
  }, []);

  useEffect(() => {
    refreshOnboarding();
  }, [refreshOnboarding]);

  return (
    <OnboardingContext.Provider value={{ ...state, refreshOnboarding }}>
      {children}
    </OnboardingContext.Provider>
  );
}
