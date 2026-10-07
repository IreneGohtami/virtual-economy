'use client';

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { Card, Loader, Panel } from '@sea-commodity-tycoon/ui';
import { api } from '@/lib/api-client';

interface CurrentSeason {
  id: string;
  seasonNumber: number;
  status: string;
  startsAt: string;
  endsAt: string;
  durationDays: number;
  currentDay: number;
}

interface SeasonSummary {
  id: string;
  seasonNumber: number;
  highestProducedCommodity: string;
  highestProducedVolume: number;
  wealthiestPlayer: string;
  wealthiestNetWorth: number;
  monopolyPlayer: string | null;
  monopolyCommodity: string | null;
  monopolyPercentage: number | null;
  bestPivotPlayer: string | null;
  bestPivotDelta: number | null;
  tagline: string;
  totalPlayers: number;
  totalTrades: number;
  totalProductionVolume: number;
}

interface PriceHistoryEntry {
  timestamp: string;
  price: number;
}

interface CommodityOption {
  id: string;
  slug: string;
  name: string;
}

export default function SeasonPage() {
  const [season, setSeason] = useState<CurrentSeason | null>(null);
  const [summary, setSummary] = useState<SeasonSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Price history state
  const [commodities, setCommodities] = useState<CommodityOption[]>([]);
  const [selectedCommodity, setSelectedCommodity] = useState<string | null>(null);
  const [priceHistory, setPriceHistory] = useState<PriceHistoryEntry[]>([]);
  const [priceLoading, setPriceLoading] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const currentSeason = await api.get<CurrentSeason>('/season/current');
      setSeason(currentSeason);

      // If season is ended, fetch summary
      if (currentSeason.status === 'ENDED') {
        try {
          const summaryData = await api.get<SeasonSummary>(`/season/summary/${currentSeason.id}`);
          setSummary(summaryData);
        } catch {
          // Summary may not be available yet
        }
      }

      // Fetch commodity list for price history
      try {
        const prices = await api.get<CommodityOption[]>('/marketplace/prices');
        setCommodities(prices);
      } catch {
        // Non-critical
      }

      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load season data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Fetch price history when commodity selected
  useEffect(() => {
    if (!selectedCommodity) {
      setPriceHistory([]);
      return;
    }

    let cancelled = false;
    setPriceLoading(true);

    api.get<PriceHistoryEntry[]>(`/economy/prices/${selectedCommodity}/history`)
      .then((data) => {
        if (!cancelled) setPriceHistory(data);
      })
      .catch(() => {
        if (!cancelled) setPriceHistory([]);
      })
      .finally(() => {
        if (!cancelled) setPriceLoading(false);
      });

    return () => { cancelled = true; };
  }, [selectedCommodity]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader />
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-4xl mx-auto p-4">
        <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm" role="alert">
          {error}
        </div>
      </div>
    );
  }

  if (!season) return null;

  return (
    <div className="max-w-4xl mx-auto p-4 space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Season {season.seasonNumber}</h1>

      {/* Season Status & Countdown */}
      <Card>
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">Status</p>
              <p className={`font-semibold ${
                season.status === 'ACTIVE' ? 'text-green-700' : 'text-gray-500'
              }`}>
                {season.status === 'ACTIVE' ? 'In Progress' : season.status}
              </p>
            </div>
            <div className="text-right">
              <p className="text-sm text-gray-500">Day</p>
              <p className="font-semibold text-gray-900">{season.currentDay} / {season.durationDays}</p>
            </div>
          </div>

          {/* Progress bar */}
          <div
            className="h-2 w-full bg-gray-200 rounded-full overflow-hidden"
            role="progressbar"
            aria-valuenow={season.currentDay}
            aria-valuemax={season.durationDays}
            aria-label="Season progress"
          >
            <div
              className="h-full bg-blue-600 rounded-full transition-all"
              style={{ width: `${Math.min(100, (season.currentDay / season.durationDays) * 100)}%` }}
            />
          </div>

          {/* Countdown timer */}
          {season.status === 'ACTIVE' && (
            <CountdownTimer endsAt={season.endsAt} />
          )}
        </div>
      </Card>

      {/* Season Summary (when season is ended) */}
      {summary && (
        <SeasonSummaryCard summary={summary} />
      )}

      {/* Price History */}
      <Panel title="Price History">
        <div className="space-y-3">
          <div>
            <label htmlFor="commodity-select" className="block text-sm font-medium text-gray-700 mb-1">
              Select Commodity
            </label>
            <select
              id="commodity-select"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              value={selectedCommodity || ''}
              onChange={(e) => setSelectedCommodity(e.target.value || null)}
            >
              <option value="">Choose a commodity...</option>
              {commodities.map((c) => (
                <option key={c.id} value={c.id}>{c.name || c.slug}</option>
              ))}
            </select>
          </div>

          {priceLoading && <Loader size="sm" />}

          {!priceLoading && selectedCommodity && priceHistory.length > 0 && (
            <PriceChart data={priceHistory} />
          )}

          {!priceLoading && selectedCommodity && priceHistory.length === 0 && (
            <p className="text-sm text-gray-500 py-4 text-center">No price history data available.</p>
          )}
        </div>
      </Panel>
    </div>
  );
}

function CountdownTimer({ endsAt }: { endsAt: string }) {
  const [timeLeft, setTimeLeft] = useState<string>('');
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    function update() {
      const endTime = new Date(endsAt).getTime();
      const now = Date.now();
      const diff = endTime - now;

      if (diff <= 0) {
        setTimeLeft('Season ended');
        if (intervalRef.current) clearInterval(intervalRef.current);
        return;
      }

      const days = Math.floor(diff / 86_400_000);
      const hours = Math.floor((diff % 86_400_000) / 3_600_000);
      const minutes = Math.floor((diff % 3_600_000) / 60_000);
      const seconds = Math.floor((diff % 60_000) / 1_000);

      const parts: string[] = [];
      if (days > 0) parts.push(`${days}d`);
      parts.push(`${hours.toString().padStart(2, '0')}h`);
      parts.push(`${minutes.toString().padStart(2, '0')}m`);
      parts.push(`${seconds.toString().padStart(2, '0')}s`);

      setTimeLeft(parts.join(' '));
    }

    update();
    intervalRef.current = setInterval(update, 1000);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [endsAt]);

  return (
    <div className="text-center p-3 bg-gray-50 rounded-lg">
      <p className="text-xs text-gray-500 uppercase tracking-wide">Time Remaining</p>
      <p className="text-2xl font-mono font-bold text-gray-900 mt-1" aria-live="polite" aria-atomic="true">
        {timeLeft}
      </p>
    </div>
  );
}

function SeasonSummaryCard({ summary }: { summary: SeasonSummary }) {
  return (
    <Card title="Season Summary">
      <div className="space-y-4">
        {/* Tagline */}
        <div className="p-3 bg-gradient-to-r from-blue-50 to-purple-50 rounded-lg border border-blue-100">
          <p className="text-sm font-medium text-blue-800 italic">&ldquo;{summary.tagline}&rdquo;</p>
        </div>

        {/* Key stats */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <SummaryStat
            label="Total Players"
            value={summary.totalPlayers.toString()}
          />
          <SummaryStat
            label="Total Trades"
            value={summary.totalTrades.toLocaleString()}
          />
          <SummaryStat
            label="Production Volume"
            value={summary.totalProductionVolume.toLocaleString()}
          />
        </div>

        {/* Highlights */}
        <div className="space-y-3 border-t border-gray-100 pt-3">
          <SummaryHighlight
            icon="\u{1F3C6}"
            label="Wealthiest Player"
            value={summary.wealthiestPlayer}
            detail={`${summary.wealthiestNetWorth.toLocaleString()} coins`}
          />
          <SummaryHighlight
            icon="\u{1F4E6}"
            label="Most Produced"
            value={summary.highestProducedCommodity}
            detail={`${summary.highestProducedVolume.toLocaleString()} units`}
          />
          {summary.monopolyPlayer && (
            <SummaryHighlight
              icon="\u{1F451}"
              label="Market Monopoly"
              value={summary.monopolyPlayer}
              detail={`${summary.monopolyPercentage?.toFixed(0)}% of ${summary.monopolyCommodity}`}
            />
          )}
          {summary.bestPivotPlayer && (
            <SummaryHighlight
              icon="\u{1F4C8}"
              label="Best Pivot"
              value={summary.bestPivotPlayer}
              detail={`+${summary.bestPivotDelta?.toLocaleString()} coins over 5 days`}
            />
          )}
        </div>
      </div>
    </Card>
  );
}

function SummaryStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-center p-2">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="text-lg font-bold text-gray-900 mt-0.5">{value}</p>
    </div>
  );
}

function SummaryHighlight({
  icon,
  label,
  value,
  detail,
}: {
  icon: string;
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-xl" aria-hidden="true">{icon}</span>
      <div className="flex-1 min-w-0">
        <p className="text-xs text-gray-500">{label}</p>
        <p className="text-sm font-medium text-gray-900 truncate">{value}</p>
      </div>
      <p className="text-sm text-gray-500 flex-shrink-0">{detail}</p>
    </div>
  );
}

function PriceChart({ data }: { data: PriceHistoryEntry[] }) {
  if (data.length === 0) return null;

  const prices = data.map((d) => d.price);
  const maxPrice = Math.max(...prices);
  const minPrice = Math.min(...prices);
  const range = maxPrice - minPrice || 1;

  const chartHeight = 120;
  const chartWidth = 100; // percentage-based

  // Generate SVG path
  const points = data.map((d, i) => {
    const x = (i / (data.length - 1 || 1)) * chartWidth;
    const y = chartHeight - ((d.price - minPrice) / range) * chartHeight;
    return { x, y };
  });

  const pathData = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`)
    .join(' ');

  const latestPrice = prices[prices.length - 1];
  const firstPrice = prices[0];
  const priceChange = latestPrice - firstPrice;
  const isUp = priceChange >= 0;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-sm">
        <span className="text-gray-500">
          {data.length} data points
        </span>
        <span className={`font-medium ${isUp ? 'text-green-600' : 'text-red-600'}`}>
          {isUp ? '+' : ''}{priceChange.toFixed(2)} ({((priceChange / (firstPrice || 1)) * 100).toFixed(1)}%)
        </span>
      </div>

      <div className="relative bg-gray-50 rounded-lg p-3 border border-gray-100">
        <svg
          viewBox={`0 0 ${chartWidth} ${chartHeight}`}
          className="w-full h-32"
          preserveAspectRatio="none"
          role="img"
          aria-label={`Price chart showing ${isUp ? 'increase' : 'decrease'} from ${firstPrice.toFixed(2)} to ${latestPrice.toFixed(2)}`}
        >
          <path
            d={pathData}
            fill="none"
            stroke={isUp ? '#16a34a' : '#dc2626'}
            strokeWidth="1.5"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        <div className="flex justify-between text-xs text-gray-400 mt-1">
          <span>{minPrice.toFixed(1)}</span>
          <span>Current: {latestPrice.toFixed(1)}</span>
          <span>{maxPrice.toFixed(1)}</span>
        </div>
      </div>
    </div>
  );
}
