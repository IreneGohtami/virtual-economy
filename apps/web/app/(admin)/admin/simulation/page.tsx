'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { Button, Card, Loader, Panel } from '@sea-commodity-tycoon/ui';
import { api } from '@/lib/api-client';

// --- Types ---

type EventFrequency = 'low' | 'medium' | 'high';

interface SimulationRequest {
  playerCount: number;
  days: number;
  mapWidth: number;
  mapHeight: number;
  eventFrequency: EventFrequency;
}

interface MapCapacity {
  totalTiles: number;
  tilesPerTerrain: Record<string, number>;
  saturationPercent: number;
  sufficient: boolean;
  terrainBottlenecks: string[];
}

interface EconomyHealth {
  isBalanced: boolean;
  averageNetWorth: number;
  medianNetWorth: number;
  topPlayerNetWorth: number;
  bottomPlayerNetWorth: number;
  giniCoefficient: number;
  wealthDistribution: { bracket: string; count: number; percentage: number }[];
}

interface StrategyStats {
  avgNetWorth: number;
  avgROI: number;
  survivedPercent: number;
}

interface StrategyAnalysis {
  conservative: StrategyStats;
  balanced: StrategyStats;
  aggressive: StrategyStats;
  dominantStrategy: string | null;
}

interface MarketplaceLiquidity {
  avgDailyVolume: number;
  liquidCommodities: string[];
  illiquidCommodities: string[];
  averageFillRate: number;
}

interface LoanAnalysis {
  totalLoansTaken: number;
  avgLoanAmount: number;
  defaultRate: number;
  sustainable: boolean;
}

interface PriceAnalysis {
  avgVolatility: number;
  mostVolatileCommodity: string;
  leastVolatileCommodity: string;
  stabilizationEffective: boolean;
}

interface EventImpact {
  eventsTriggered: { type: string; day: number; duration: number; impact: string }[];
  avgPriceImpact: number;
  recoveryDays: number;
}

interface L2Viability {
  canBreakEvenByDay15: boolean;
  avgBreakEvenDay: number;
  l2ProducerCount: number;
  l2ProfitMargin: number;
}

interface SimulationResults {
  playerCount: number;
  simulatedDays: number;
  mapSize: { width: number; height: number };
  mapCapacity: MapCapacity;
  economyHealth: EconomyHealth;
  strategyAnalysis: StrategyAnalysis;
  marketplaceLiquidity: MarketplaceLiquidity;
  loanAnalysis: LoanAnalysis;
  priceAnalysis: PriceAnalysis;
  eventImpact: EventImpact;
  l2Viability: L2Viability;
  recommendations: string[];
}

interface SimulationResponse {
  id: string;
  status: 'COMPLETED' | 'FAILED';
  simulatedDays: number;
  results: SimulationResults;
}

interface SimulationRun {
  id: string;
  label?: string;
  simulatedDays: number;
  playerCount?: number;
  status: string;
  startedAt: string | Date;
}

// --- Helpers ---

function formatNumber(n: number): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function formatCurrency(n: number): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: 0, style: 'currency', currency: 'USD' });
}

function formatPercent(n: number, decimals = 1): string {
  return `${(n * 100).toFixed(decimals)}%`;
}

function StatusBadge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold ${
        ok ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
      }`}
    >
      <span>{ok ? '✓' : '✗'}</span>
      <span>{label}</span>
    </div>
  );
}

const TERRAIN_COLORS: Record<string, string> = {
  ocean: '#3b82f6',
  forest: '#22c55e',
  desert: '#eab308',
  mountain: '#6b7280',
  plains: '#a3e635',
  swamp: '#84cc16',
  tundra: '#93c5fd',
  volcanic: '#ef4444',
};

function getTerrainColor(terrain: string): string {
  return TERRAIN_COLORS[terrain.toLowerCase()] || '#9ca3af';
}

// --- Component ---

export default function SimulationPage() {
  const [runs, setRuns] = useState<SimulationRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [result, setResult] = useState<SimulationResponse | null>(null);

  // Form state
  const [playerCount, setPlayerCount] = useState(200);
  const [days, setDays] = useState(30);
  const [mapWidth, setMapWidth] = useState(100);
  const [mapHeight, setMapHeight] = useState(100);
  const [eventFrequency, setEventFrequency] = useState<EventFrequency>('medium');

  const fetchRuns = useCallback(async () => {
    try {
      const resp = await api.get<{ simulations: SimulationRun[] }>('/admin/simulation/list');
      setRuns(resp.simulations || []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load simulation runs');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRuns();
  }, [fetchRuns]);

  const handleRunSimulation = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionLoading(true);
    setError(null);
    setResult(null);
    try {
      const body: SimulationRequest = {
        playerCount,
        days,
        mapWidth,
        mapHeight,
        eventFrequency,
      };
      const response = await api.post<SimulationResponse>('/admin/simulation/advanced', body);
      setResult(response);
      await fetchRuns();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to run simulation');
    } finally {
      setActionLoading(false);
    }
  };

  const handleViewResults = async (runId: string) => {
    setError(null);
    try {
      const response = await api.get<SimulationResponse>(`/admin/simulation/results/${runId}`);
      setResult(response);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load results');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader />
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Advanced Simulation</h1>

      {error && (
        <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm" role="alert">
          {error}
        </div>
      )}

      {/* Run Simulation Form */}
      <Card title="Run Simulation">
        <form onSubmit={handleRunSimulation} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label htmlFor="playerCount" className="block text-sm font-medium text-gray-700 mb-1">
                Player Count
              </label>
              <input
                id="playerCount"
                type="number"
                value={playerCount}
                onChange={(e) => setPlayerCount(parseInt(e.target.value, 10) || 0)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                min="1"
                required
              />
            </div>
            <div>
              <label htmlFor="days" className="block text-sm font-medium text-gray-700 mb-1">
                Duration (Days)
              </label>
              <input
                id="days"
                type="number"
                value={days}
                onChange={(e) => setDays(parseInt(e.target.value, 10) || 0)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                min="1"
                required
              />
            </div>
            <div>
              <label htmlFor="eventFrequency" className="block text-sm font-medium text-gray-700 mb-1">
                Event Frequency
              </label>
              <select
                id="eventFrequency"
                value={eventFrequency}
                onChange={(e) => setEventFrequency(e.target.value as EventFrequency)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </div>
            <div>
              <label htmlFor="mapWidth" className="block text-sm font-medium text-gray-700 mb-1">
                Map Width
              </label>
              <input
                id="mapWidth"
                type="number"
                value={mapWidth}
                onChange={(e) => setMapWidth(parseInt(e.target.value, 10) || 0)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                min="1"
                required
              />
            </div>
            <div>
              <label htmlFor="mapHeight" className="block text-sm font-medium text-gray-700 mb-1">
                Map Height
              </label>
              <input
                id="mapHeight"
                type="number"
                value={mapHeight}
                onChange={(e) => setMapHeight(parseInt(e.target.value, 10) || 0)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                min="1"
                required
              />
            </div>
          </div>
          <Button type="submit" loading={actionLoading}>
            Run Simulation
          </Button>
        </form>
      </Card>

      {/* Results Display */}
      {result && result.results && (
        <ResultsDisplay response={result} onClose={() => setResult(null)} />
      )}

      {/* Past Runs */}
      <Panel title="Past Runs">
        {runs.length === 0 ? (
          <p className="text-gray-500 text-sm">No simulation runs yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-2 px-2 font-medium text-gray-500">ID</th>
                  <th className="text-left py-2 px-2 font-medium text-gray-500">Days</th>

                  <th className="text-left py-2 px-2 font-medium text-gray-500">Status</th>
                  <th className="text-left py-2 px-2 font-medium text-gray-500">Created</th>
                  <th className="text-left py-2 px-2 font-medium text-gray-500">Actions</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <tr key={run.id} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="py-2 px-2 text-gray-900 font-mono text-xs">
                      {run.id.slice(0, 8)}...
                    </td>
                    <td className="py-2 px-2 text-gray-900">{run.simulatedDays}</td>
                    <td className="py-2 px-2">
                      <span
                        className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                          run.status === 'COMPLETED' || run.status === 'completed'
                            ? 'bg-green-100 text-green-700'
                            : run.status === 'FAILED' || run.status === 'failed'
                              ? 'bg-red-100 text-red-700'
                              : 'bg-yellow-100 text-yellow-700'
                        }`}
                      >
                        {run.status}
                      </span>
                    </td>
                    <td className="py-2 px-2 text-gray-600 text-xs">
                      {new Date(run.startedAt).toLocaleString()}
                    </td>
                    <td className="py-2 px-2">
                      <Button variant="ghost" size="sm" onClick={() => handleViewResults(run.id)}>
                        View
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}

// --- Results Display Component ---

function ResultsDisplay({ response, onClose }: { response: SimulationResponse; onClose: () => void }) {
  const r = response.results;

  return (
    <div className="space-y-6">
      {/* Summary Bar */}
      <Card title="Simulation Summary">
        <div className="flex flex-wrap gap-3 mb-4">
          <StatusBadge ok={r.economyHealth.isBalanced} label="Economy: Balanced" />
          <StatusBadge ok={r.loanAnalysis.sustainable} label="Loans: Sustainable" />
          <StatusBadge ok={r.mapCapacity.sufficient} label="Map: Sufficient" />
          <StatusBadge ok={r.l2Viability.canBreakEvenByDay15} label="L2 Viable" />
          <StatusBadge ok={r.priceAnalysis.stabilizationEffective} label="Stabilization" />
        </div>
        <div className="flex items-center gap-4 text-xs text-gray-500">
          <span>Status: <strong className={response.status === 'COMPLETED' ? 'text-green-700' : 'text-red-700'}>{response.status}</strong></span>
          <span>Players: {r.playerCount}</span>
          <span>Days: {r.simulatedDays}</span>
          <span>Map: {r.mapSize.width}×{r.mapSize.height}</span>
        </div>
        <div className="mt-3">
          <Button variant="secondary" size="sm" onClick={onClose}>
            Close Results
          </Button>
        </div>
      </Card>

      {/* Map Capacity */}
      <Card title="Map Capacity">
        <div className="space-y-4">
          <div className="flex items-center gap-4 text-sm">
            <span className="text-gray-600">Total Tiles: <strong>{formatNumber(r.mapCapacity.totalTiles)}</strong></span>
            <span className="text-gray-600">Saturation: <strong>{formatPercent(r.mapCapacity.saturationPercent / 100, 1)}</strong></span>
            {!r.mapCapacity.sufficient && (
              <span className="text-red-600 font-medium">⚠ Insufficient</span>
            )}
          </div>

          {/* Terrain breakdown bar */}
          <div>
            <p className="text-xs font-medium text-gray-500 mb-2">Terrain Distribution</p>
            <div className="flex h-8 rounded-lg overflow-hidden">
              {Object.entries(r.mapCapacity.tilesPerTerrain).map(([terrain, count]) => {
                const pct = (count / r.mapCapacity.totalTiles) * 100;
                if (pct < 1) return null;
                return (
                  <div
                    key={terrain}
                    className="flex items-center justify-center text-[10px] text-white font-medium"
                    style={{ width: `${pct}%`, backgroundColor: getTerrainColor(terrain) }}
                    title={`${terrain}: ${formatNumber(count)} (${pct.toFixed(1)}%)`}
                  >
                    {pct > 5 ? terrain : ''}
                  </div>
                );
              })}
            </div>
            <div className="flex flex-wrap gap-3 mt-2">
              {Object.entries(r.mapCapacity.tilesPerTerrain).map(([terrain, count]) => (
                <div key={terrain} className="flex items-center gap-1 text-xs text-gray-600">
                  <div className="w-3 h-3 rounded" style={{ backgroundColor: getTerrainColor(terrain) }} />
                  <span>{terrain}: {formatNumber(count)}</span>
                </div>
              ))}
            </div>
          </div>

          {r.mapCapacity.terrainBottlenecks.length > 0 && (
            <div className="p-2 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800">
              <strong>Bottlenecks:</strong> {r.mapCapacity.terrainBottlenecks.join(', ')}
            </div>
          )}
        </div>
      </Card>

      {/* Economy Health */}
      <Card title="Economy Health">
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Stat label="Avg Net Worth" value={formatCurrency(r.economyHealth.averageNetWorth)} />
            <Stat label="Median Net Worth" value={formatCurrency(r.economyHealth.medianNetWorth)} />
            <Stat label="Top Player" value={formatCurrency(r.economyHealth.topPlayerNetWorth)} />
            <Stat label="Bottom Player" value={formatCurrency(r.economyHealth.bottomPlayerNetWorth)} />
          </div>

          {/* Gini Coefficient */}
          <div>
            <p className="text-xs font-medium text-gray-500 mb-1">Gini Coefficient</p>
            <div className="flex items-center gap-3">
              <div className="flex-1 h-3 bg-gray-200 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full ${
                    r.economyHealth.giniCoefficient < 0.4
                      ? 'bg-green-500'
                      : r.economyHealth.giniCoefficient < 0.6
                        ? 'bg-yellow-500'
                        : 'bg-red-500'
                  }`}
                  style={{ width: `${r.economyHealth.giniCoefficient * 100}%` }}
                />
              </div>
              <span
                className={`text-sm font-bold ${
                  r.economyHealth.giniCoefficient < 0.4
                    ? 'text-green-700'
                    : r.economyHealth.giniCoefficient < 0.6
                      ? 'text-yellow-700'
                      : 'text-red-700'
                }`}
              >
                {r.economyHealth.giniCoefficient.toFixed(3)}
              </span>
            </div>
          </div>

          {/* Wealth Distribution */}
          <div>
            <p className="text-xs font-medium text-gray-500 mb-2">Wealth Distribution</p>
            <div className="space-y-1.5">
              {r.economyHealth.wealthDistribution.map((bracket) => (
                <div key={bracket.bracket} className="flex items-center gap-2 text-xs">
                  <span className="w-24 text-gray-600 truncate">{bracket.bracket}</span>
                  <div className="flex-1 h-4 bg-gray-100 rounded overflow-hidden">
                    <div
                      className="h-full bg-blue-500 rounded"
                      style={{ width: `${bracket.percentage}%` }}
                    />
                  </div>
                  <span className="w-16 text-right text-gray-700">{bracket.count} ({bracket.percentage.toFixed(1)}%)</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </Card>

      {/* Strategy Analysis */}
      <Card title="Strategy Analysis">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <StrategyCard
            name="Conservative"
            stats={r.strategyAnalysis.conservative}
            isDominant={r.strategyAnalysis.dominantStrategy === 'conservative'}
          />
          <StrategyCard
            name="Balanced"
            stats={r.strategyAnalysis.balanced}
            isDominant={r.strategyAnalysis.dominantStrategy === 'balanced'}
          />
          <StrategyCard
            name="Aggressive"
            stats={r.strategyAnalysis.aggressive}
            isDominant={r.strategyAnalysis.dominantStrategy === 'aggressive'}
          />
        </div>
        {r.strategyAnalysis.dominantStrategy && (
          <p className="mt-3 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            ⚠ Dominant strategy detected: <strong>{r.strategyAnalysis.dominantStrategy}</strong>
          </p>
        )}
        {!r.strategyAnalysis.dominantStrategy && (
          <p className="mt-3 text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
            ✓ No dominant strategy — strategies are well-balanced.
          </p>
        )}
      </Card>

      {/* Marketplace Liquidity */}
      <Card title="Marketplace Liquidity">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
          <Stat label="Avg Daily Volume" value={formatNumber(r.marketplaceLiquidity.avgDailyVolume)} />
          <Stat label="Avg Fill Rate" value={formatPercent(r.marketplaceLiquidity.averageFillRate)} />
          <Stat label="Liquid" value={String(r.marketplaceLiquidity.liquidCommodities.length)} />
          <Stat label="Illiquid" value={String(r.marketplaceLiquidity.illiquidCommodities.length)} />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
          <div>
            <p className="font-medium text-gray-500 mb-1">Liquid Commodities</p>
            <div className="flex flex-wrap gap-1">
              {r.marketplaceLiquidity.liquidCommodities.map((c) => (
                <span key={c} className="px-2 py-0.5 bg-green-100 text-green-800 rounded-full">{c}</span>
              ))}
            </div>
          </div>
          <div>
            <p className="font-medium text-gray-500 mb-1">Illiquid Commodities</p>
            <div className="flex flex-wrap gap-1">
              {r.marketplaceLiquidity.illiquidCommodities.map((c) => (
                <span key={c} className="px-2 py-0.5 bg-red-100 text-red-800 rounded-full">{c}</span>
              ))}
            </div>
          </div>
        </div>
      </Card>

      {/* Loans */}
      <Card title="Loan Analysis">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Stat label="Total Loans" value={formatNumber(r.loanAnalysis.totalLoansTaken)} />
          <Stat label="Avg Amount" value={formatCurrency(r.loanAnalysis.avgLoanAmount)} />
          <Stat
            label="Default Rate"
            value={formatPercent(r.loanAnalysis.defaultRate)}
            color={r.loanAnalysis.defaultRate > 0.2 ? 'text-red-700' : 'text-gray-900'}
          />
          <Stat
            label="Sustainable"
            value={r.loanAnalysis.sustainable ? '✓ Yes' : '✗ No'}
            color={r.loanAnalysis.sustainable ? 'text-green-700' : 'text-red-700'}
          />
        </div>
      </Card>

      {/* Price Analysis */}
      <Card title="Price Analysis">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Stat label="Avg Volatility" value={r.priceAnalysis.avgVolatility.toFixed(3)} />
          <Stat label="Most Volatile" value={r.priceAnalysis.mostVolatileCommodity} />
          <Stat label="Least Volatile" value={r.priceAnalysis.leastVolatileCommodity} />
          <Stat
            label="Stabilization"
            value={r.priceAnalysis.stabilizationEffective ? '✓ Effective' : '✗ Ineffective'}
            color={r.priceAnalysis.stabilizationEffective ? 'text-green-700' : 'text-red-700'}
          />
        </div>
      </Card>

      {/* Events Timeline */}
      <Card title="Events Timeline">
        <div className="space-y-3 mb-4">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <Stat label="Avg Price Impact" value={formatPercent(r.eventImpact.avgPriceImpact)} />
            <Stat label="Recovery Days" value={String(r.eventImpact.recoveryDays)} />
          </div>
        </div>
        {r.eventImpact.eventsTriggered.length === 0 ? (
          <p className="text-gray-500 text-sm">No events triggered during simulation.</p>
        ) : (
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {r.eventImpact.eventsTriggered.map((event, i) => (
              <div
                key={i}
                className="flex items-center gap-3 p-2 rounded-lg bg-gray-50 border border-gray-100 text-sm"
              >
                <span className="flex-shrink-0 w-14 text-center px-2 py-0.5 bg-blue-100 text-blue-800 rounded text-xs font-medium">
                  Day {event.day}
                </span>
                <span className="font-medium text-gray-900">{event.type}</span>
                <span className="text-gray-500 text-xs">{event.duration}d</span>
                <span
                  className={`ml-auto text-xs font-medium px-2 py-0.5 rounded-full ${
                    event.impact === 'high'
                      ? 'bg-red-100 text-red-700'
                      : event.impact === 'medium'
                        ? 'bg-yellow-100 text-yellow-700'
                        : 'bg-green-100 text-green-700'
                  }`}
                >
                  {event.impact}
                </span>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* L2 Viability */}
      <Card title="L2 Viability">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Stat
            label="Break Even by Day 15"
            value={r.l2Viability.canBreakEvenByDay15 ? '✓ Yes' : '✗ No'}
            color={r.l2Viability.canBreakEvenByDay15 ? 'text-green-700' : 'text-red-700'}
          />
          <Stat label="Avg Break-Even Day" value={String(r.l2Viability.avgBreakEvenDay)} />
          <Stat label="L2 Producers" value={formatNumber(r.l2Viability.l2ProducerCount)} />
          <Stat label="L2 Profit Margin" value={formatPercent(r.l2Viability.l2ProfitMargin)} />
        </div>
      </Card>

      {/* Recommendations */}
      <Card title="Recommendations">
        {r.recommendations.length === 0 ? (
          <p className="text-gray-500 text-sm">No recommendations — simulation looks healthy!</p>
        ) : (
          <ul className="space-y-2">
            {r.recommendations.map((rec, i) => (
              <li
                key={i}
                className="flex items-start gap-2 p-2 rounded-lg bg-slate-50 border border-slate-200 text-sm text-gray-800"
              >
                <span className={`flex-shrink-0 mt-0.5 w-2 h-2 rounded-full ${getRecommendationColor(i, r.recommendations.length)}`} />
                {rec}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

// --- Sub-components ---

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div>
      <p className="text-xs font-medium text-gray-500">{label}</p>
      <p className={`text-sm font-semibold ${color || 'text-gray-900'}`}>{value}</p>
    </div>
  );
}

function StrategyCard({ name, stats, isDominant }: { name: string; stats: StrategyStats; isDominant: boolean }) {
  return (
    <div
      className={`p-4 rounded-lg border ${
        isDominant ? 'border-amber-300 bg-amber-50' : 'border-gray-200 bg-white'
      }`}
    >
      <div className="flex items-center gap-2 mb-3">
        <h4 className="text-sm font-semibold text-gray-900">{name}</h4>
        {isDominant && (
          <span className="text-[10px] px-1.5 py-0.5 bg-amber-200 text-amber-800 rounded-full font-bold">
            DOMINANT
          </span>
        )}
      </div>
      <div className="space-y-2 text-sm">
        <div className="flex justify-between">
          <span className="text-gray-500">Avg Net Worth</span>
          <span className="font-medium">{formatCurrency(stats.avgNetWorth)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500">ROI</span>
          <span className="font-medium">{formatPercent(stats.avgROI)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500">Survival</span>
          <span className="font-medium">{formatPercent(stats.survivedPercent)}</span>
        </div>
      </div>
    </div>
  );
}

function getRecommendationColor(index: number, total: number): string {
  const severity = index / Math.max(total - 1, 1);
  if (severity < 0.33) return 'bg-red-500';
  if (severity < 0.66) return 'bg-yellow-500';
  return 'bg-blue-500';
}
