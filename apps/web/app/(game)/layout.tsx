'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ToastProvider } from '@/lib/toast-context';
import { WalletProvider, useWallet } from '@/lib/wallet-context';
import { OnboardingProvider, useOnboarding } from '@/lib/onboarding-context';

const NAV_ITEMS = [
  { href: '/dashboard', label: 'Dashboard', icon: '🏠' },
  { href: '/map', label: 'Map', icon: '🗺️' },
  { href: '/factories', label: 'Factories', icon: '🏭' },
  { href: '/workers', label: 'Employees', icon: '👷' },
  { href: '/marketplace', label: 'Market', icon: '📊' },
  { href: '/inventory', label: 'Inventory', icon: '📦' },
  { href: '/bank', label: 'Bank', icon: '🏦' },
  { href: '/activity', label: 'Activity', icon: '📜' },
  { href: '/leaderboard', label: 'Leaderboard', icon: '🏆' },
];

function useSeasonCountdown(endsAt: string | null): string {
  const [countdown, setCountdown] = useState('');

  useEffect(() => {
    if (!endsAt) return;

    function update() {
      const now = Date.now();
      const end = new Date(endsAt!).getTime();
      const diff = end - now;

      if (diff <= 0) {
        setCountdown('Season ended');
        return;
      }

      const days = Math.floor(diff / (1000 * 60 * 60 * 24));
      const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

      if (days > 0) {
        setCountdown(`${days}d ${hours}h remaining`);
      } else if (hours > 0) {
        setCountdown(`${hours}h ${minutes}m remaining`);
      } else {
        setCountdown(`${minutes}m remaining`);
      }
    }

    update();
    const interval = setInterval(update, 60000);
    return () => clearInterval(interval);
  }, [endsAt]);

  return countdown;
}

export default function GameLayout({ children }: { children: React.ReactNode }) {
  return (
    <WalletProvider>
      <OnboardingProvider>
        <ToastProvider>
          <GameLayoutInner>{children}</GameLayoutInner>
        </ToastProvider>
      </OnboardingProvider>
    </WalletProvider>
  );
}

function GameLayoutInner({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { coins, seasonEndsAt, refreshWallet } = useWallet();
  const { nextStepHref, refreshOnboarding } = useOnboarding();
  const countdown = useSeasonCountdown(seasonEndsAt);

  // Refresh wallet and onboarding on route change
  useEffect(() => {
    refreshWallet();
    refreshOnboarding();
  }, [pathname, refreshWallet, refreshOnboarding]);

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar Navigation */}
      <nav className="w-56 bg-gray-900 text-gray-100 flex flex-col shrink-0" aria-label="Game navigation">
        <div className="p-4 border-b border-gray-700">
          <h1 className="text-sm font-bold tracking-wide text-white uppercase">SEA Tycoon</h1>
        </div>

        {/* Wallet */}
        {coins !== null && (
          <div className="px-4 py-3 border-b border-gray-700">
            <p className="text-[10px] uppercase tracking-wide text-gray-500 mb-1">Wallet</p>
            <p className="text-lg font-bold text-yellow-400">
              {coins.toLocaleString()} <span className="text-xs font-normal text-gray-400">coins</span>
            </p>
          </div>
        )}

        <ul className="flex-1 overflow-y-auto py-2 space-y-0.5">
          {NAV_ITEMS.map((item) => {
            const isActive = pathname === item.href || pathname.startsWith(item.href + '/');
            const isNextStep = nextStepHref === item.href && !isActive;
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={`flex items-center gap-3 px-4 py-2.5 text-sm transition-colors relative ${
                    isActive
                      ? 'bg-blue-600 text-white font-medium'
                      : isNextStep
                      ? 'bg-emerald-600/20 text-emerald-300 font-medium animate-pulse-subtle'
                      : 'text-gray-300 hover:bg-gray-800 hover:text-white'
                  }`}
                  aria-current={isActive ? 'page' : undefined}
                >
                  <span className="text-base" aria-hidden="true">{item.icon}</span>
                  <span>{item.label}</span>
                  {isNextStep && (
                    <span className="ml-auto text-[10px] bg-emerald-500 text-white px-1.5 py-0.5 rounded-full font-bold">
                      NEXT
                    </span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>

        {/* Season countdown */}
        <div className="p-3 border-t border-gray-700">
          {countdown ? (
            <div>
              <p className="text-[10px] uppercase tracking-wide text-gray-500">Season</p>
              <p className="text-xs text-gray-300 mt-0.5">{countdown}</p>
            </div>
          ) : (
            <p className="text-xs text-gray-500">Season Active</p>
          )}
        </div>
      </nav>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto bg-gray-50">
        {children}
      </main>
    </div>
  );
}
