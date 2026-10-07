'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { Button, Card, Loader, Panel } from '@sea-commodity-tycoon/ui';
import { api } from '@/lib/api-client';

interface HappinessState {
  percentage: number;
  decayRate: number;
  lastUpdatedAt: string;
}

interface HappinessBoost {
  slug: string;
  name: string;
  icon: string;
  costPerWorker: number;
  happinessIncrease: number;
  cooldownDays: number;
  onCooldown: boolean;
  cooldownEndsAt: string | null;
}

export default function HappinessPage() {
  const [happiness, setHappiness] = useState<HappinessState | null>(null);
  const [boosts, setBoosts] = useState<HappinessBoost[]>([]);
  const [workerCount, setWorkerCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const [happinessData, boostsData, workersData] = await Promise.all([
        api.get<HappinessState>('/happiness'),
        api.get<HappinessBoost[]>('/happiness/boosts'),
        api.get<Array<unknown>>('/workers/mine').catch(() => []),
      ]);
      setHappiness(happinessData);
      setBoosts(boostsData);
      setWorkerCount(Array.isArray(workersData) ? workersData.length : 0);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load happiness data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  async function handleBoost(boostSlug: string) {
    setActionLoading(boostSlug);
    try {
      await api.post('/happiness/boost', { boostSlug });
      await fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to apply boost');
    } finally {
      setActionLoading(null);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader />
      </div>
    );
  }

  const percentage = happiness?.percentage ?? 0;
  const isCritical = percentage <= 30;
  const isWarning = percentage <= 50 && !isCritical;

  return (
    <div className="max-w-3xl mx-auto p-4 space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Workforce Happiness</h1>

      {error && (
        <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm" role="alert">
          {error}
        </div>
      )}

      {/* Happiness Indicator */}
      <Card>
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-gray-700">Current Happiness</span>
            <span
              className={`text-2xl font-bold ${
                isCritical ? 'text-red-600' : isWarning ? 'text-yellow-600' : 'text-green-600'
              }`}
            >
              {percentage.toFixed(0)}%
            </span>
          </div>

          {/* Progress bar */}
          <div
            className="h-4 w-full bg-gray-200 rounded-full overflow-hidden"
            role="progressbar"
            aria-valuenow={percentage}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Workforce happiness"
          >
            <div
              className={`h-full rounded-full transition-all ${
                isCritical ? 'bg-red-500' : isWarning ? 'bg-yellow-500' : 'bg-green-500'
              }`}
              style={{ width: `${percentage}%` }}
            />
          </div>

          <p className="text-xs text-gray-400">
            Decays {happiness?.decayRate ?? 1}% per day. Use boosts to keep morale high.
          </p>

          {/* Threshold Warnings */}
          {isCritical && (
            <div className="p-3 rounded-lg bg-red-50 border border-red-200" role="alert">
              <p className="text-sm font-medium text-red-800">Critical: Workers on vacation!</p>
              <p className="text-xs text-red-600 mt-1">
                Happiness at or below 30% causes workers to go on vacation, halting production. Apply boosts immediately.
              </p>
            </div>
          )}

          {isWarning && (
            <div className="p-3 rounded-lg bg-yellow-50 border border-yellow-200" role="alert">
              <p className="text-sm font-medium text-yellow-800">Warning: Low happiness</p>
              <p className="text-xs text-yellow-600 mt-1">
                Workers may become absent or sick more frequently. Consider applying a boost soon.
              </p>
            </div>
          )}
        </div>
      </Card>

      {/* Boost Options */}
      <Panel title="Available Boosts">
        {boosts.length === 0 ? (
          <p className="text-gray-500 text-sm">No boosts available.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {boosts.map((boost) => {
              const totalCost = boost.costPerWorker * Math.max(1, workerCount);
              const cooldownRemaining = boost.cooldownEndsAt
                ? Math.max(0, Math.ceil((new Date(boost.cooldownEndsAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
                : 0;

              return (
                <Card key={boost.slug} padding="sm" className="flex flex-col justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-2xl">{boost.icon}</span>
                      <h4 className="font-semibold text-gray-900">{boost.name}</h4>
                    </div>
                    <div className="mt-3 space-y-1.5">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-green-700 font-medium">+{boost.happinessIncrease}%</span>
                        <span className="text-gray-500">{boost.costPerWorker} coins/worker</span>
                      </div>
                      <div className="flex items-center justify-between text-xs text-gray-400">
                        <span>{workerCount} worker{workerCount !== 1 ? 's' : ''}</span>
                        <span className="font-semibold text-gray-700">Total: {totalCost} coins</span>
                      </div>
                    </div>
                    {boost.onCooldown && (
                      <div className="mt-2 px-2 py-1 bg-gray-100 rounded text-xs text-gray-500 text-center">
                        ⏳ Available in {cooldownRemaining} day{cooldownRemaining !== 1 ? 's' : ''}
                      </div>
                    )}
                  </div>
                  <Button
                    variant="primary"
                    size="sm"
                    className="mt-3 w-full"
                    onClick={() => handleBoost(boost.slug)}
                    loading={actionLoading === boost.slug}
                    disabled={percentage >= 100 || boost.onCooldown}
                  >
                    {boost.onCooldown ? 'On Cooldown' : `Purchase (${totalCost} coins)`}
                  </Button>
                </Card>
              );
            })}
          </div>
        )}
      </Panel>

      {/* Info */}
      <Panel title="How Happiness Works" collapsible defaultOpen={false}>
        <div className="text-sm text-gray-600 space-y-2">
          <p>Happiness starts at 80% each season and decays 1% daily.</p>
          <p>
            <strong>Effective Commitment</strong> = base commitment × (happiness / 80), clamped between 0% and 100%.
          </p>
          <p>Lower happiness increases the chance of worker absences and sickness.</p>
          <p>At 50% or below, you receive a warning notification.</p>
          <p>At 30% or below, all workers go on vacation and production halts.</p>
          <p>Salary continues during all disruptions (vacation, absent, sick).</p>
        </div>
      </Panel>
    </div>
  );
}
