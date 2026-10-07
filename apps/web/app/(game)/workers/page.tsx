'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { Button, Card, Loader, Panel, Modal } from '@sea-commodity-tycoon/ui';
import { api } from '@/lib/api-client';
import { useToast } from '@/lib/toast-context';
import { useWallet } from '@/lib/wallet-context';

interface AvailableWorker {
  id: string;
  name: string;
  age: number;
  gender: string;
  specialty: string;
  salary: number;
  experienceLevel: number;
  commitmentLevel: number;
}

interface HiredWorker {
  id: string;
  workerId: string;
  factoryId: string | null;
  status: string;
  disruptionEndsAt: string | null;
  worker: {
    id: string;
    name: string;
    specialty: string;
    salary: number;
    experienceLevel: number;
    commitmentLevel: number;
  } | null;
  factory: {
    id: string;
    category: string;
    factoryLevel?: number;
    isShop?: boolean;
    name?: string;
  } | null;
}

interface PlayerFactory {
  id: string;
  name?: string | null;
  category?: string;
  workerCount: number;
}

const SPECIALTY_DISPLAY: Record<string, { label: string; icon: string; covers: string }> = {
  farmer: { label: 'Farmer', icon: '🌾', covers: 'Agriculture (rice, palm fruit, cocoa, coffee)' },
  miner: { label: 'Miner', icon: '⛏️', covers: 'Metals (iron ore, nickel ore)' },
  fisherman: { label: 'Fisherman', icon: '🐟', covers: 'Fishery (fish)' },
  driller: { label: 'Driller', icon: '🛢️', covers: 'Energy (crude oil, natural gas)' },
  rancher: { label: 'Rancher', icon: '🐄', covers: 'Livestock (poultry, cattle)' },
  lumberjack: { label: 'Lumberjack', icon: '🪵', covers: 'Forestry (timber, rubber)' },
  shopkeeper: { label: 'Shopkeeper', icon: '🏪', covers: 'All shop types' },
  engineer: { label: 'Engineer', icon: '🔧', covers: 'All L1 processing factories' },
  technician: { label: 'Technician', icon: '🔬', covers: 'All L2 assembly factories' },
};

function formatSpecialty(specialty: string): string {
  const info = SPECIALTY_DISPLAY[specialty];
  return info ? `${info.icon} ${info.label}` : specialty;
}

const ROLE_CATEGORY_MAP: Record<string, string> = {
  farmer: 'AGRICULTURE', miner: 'METAL', fisherman: 'FISHERY',
  driller: 'ENERGY', rancher: 'LIVESTOCK', lumberjack: 'FORESTRY',
};

function isWorkerFactoryMatch(workerSpecialty: string | null, factory: HiredWorker['factory']): boolean {
  if (!workerSpecialty || !factory) return false;
  if (factory.isShop && workerSpecialty === 'shopkeeper') return true;
  const level = factory.factoryLevel ?? 0;
  if (level === 0) return ROLE_CATEGORY_MAP[workerSpecialty] === factory.category;
  if (level === 1) {
    if (['ENERGY', 'METAL', 'FORESTRY'].includes(factory.category)) return workerSpecialty === 'engineer';
    return ROLE_CATEGORY_MAP[workerSpecialty] === factory.category;
  }
  if (level === 2) return workerSpecialty === 'technician';
  return false;
}

function formatDisruptionRemaining(endsAt: string | null): string | null {
  if (!endsAt) return null;
  const remaining = new Date(endsAt).getTime() - Date.now();
  if (remaining <= 0) return null;
  const hours = Math.floor(remaining / (1000 * 60 * 60));
  const minutes = Math.floor((remaining % (1000 * 60 * 60)) / (1000 * 60));
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

export default function WorkersPage() {
  const { addToast } = useToast();
  const { refreshWallet } = useWallet();
  const [available, setAvailable] = useState<AvailableWorker[]>([]);
  const [hired, setHired] = useState<HiredWorker[]>([]);
  const [factories, setFactories] = useState<PlayerFactory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [reassignModal, setReassignModal] = useState<HiredWorker | null>(null);
  const [fireTarget, setFireTarget] = useState<HiredWorker | null>(null);
  const [showHappinessBoost, setShowHappinessBoost] = useState(false);
  const [specialtyFilter, setSpecialtyFilter] = useState<string>('');
  const [happiness, setHappiness] = useState<number | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const [availableData, hiredData, factoryData, playerData] = await Promise.all([
        api.get<AvailableWorker[]>('/workers/available'),
        api.get<HiredWorker[]>('/workers/mine'),
        api.get<PlayerFactory[]>('/factories'),
        api.get<{ season: { workforceHappiness: number } | null }>('/players/me'),
      ]);
      setHappiness(playerData.season?.workforceHappiness ?? null);
      setAvailable(availableData);
      setHired(hiredData);
      setFactories(factoryData);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load worker data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  async function handleHire(workerId: string, factoryId?: string) {
    setActionLoading(workerId);
    try {
      await api.post(`/workers/${workerId}/hire`, factoryId ? { factoryId } : {});
      addToast('Employee hired successfully', 'success');
      refreshWallet();
      await fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to hire worker');
    } finally {
      setActionLoading(null);
    }
  }

  async function handleFire(workerId: string) {
    setActionLoading(workerId);
    try {
      await api.post(`/workers/${workerId}/fire`);
      addToast('Employee fired', 'info');
      refreshWallet();
      setFireTarget(null);
      await fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fire employee');
    } finally {
      setActionLoading(null);
    }
  }

  async function handleReassign(workerId: string, newFactoryId: string) {
    setActionLoading(workerId);
    try {
      await api.post(`/workers/${workerId}/reassign`, { newFactoryId });
      addToast('Employee reassigned', 'success');
      refreshWallet();
      setReassignModal(null);
      await fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reassign worker');
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

  return (
    <div className="max-w-5xl mx-auto p-4 space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Employees</h1>

      {error && (
        <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm" role="alert">
          {error}
        </div>
      )}

      {/* My Employees */}
      <Panel title={`My Employees (${hired.length}) — Total Daily Wages: ${hired.reduce((sum, w) => sum + (w.worker?.salary ?? 0), 0)} coins`} collapsible defaultOpen>
        {/* Workplace Happiness Meter */}
        {happiness !== null && (
          <div className="mb-4 p-3 rounded-lg bg-gray-50 border border-gray-100">
            <div className="flex items-center justify-between text-sm mb-1.5">
              <span className="text-gray-600 font-medium">Workplace Happiness</span>
              <div className="flex items-center gap-2">
                <span className={`font-bold ${happiness >= 70 ? 'text-green-600' : happiness >= 50 ? 'text-yellow-600' : 'text-red-600'}`}>
                  {happiness}%
                </span>
                <Button variant="primary" size="sm" onClick={() => setShowHappinessBoost(true)}>
                  Boost
                </Button>
              </div>
            </div>
            <div className="h-2.5 bg-gray-200 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${
                  happiness >= 70 ? 'bg-green-500' : happiness >= 50 ? 'bg-yellow-500' : 'bg-red-500'
                }`}
                style={{ width: `${happiness}%` }}
              />
            </div>
            <p className="text-[10px] text-gray-400 mt-1">Firing employees reduces happiness by 5%. Low happiness affects production efficiency.</p>
          </div>
        )}

        {hired.length === 0 ? (
          <p className="text-gray-500 text-sm">No employees hired yet. Browse available employees below.</p>
        ) : (
          <div className="space-y-3">
            {hired.map((worker) => (
              <div
                key={worker.id}
                className="flex items-center justify-between p-3 rounded-lg border border-gray-100 bg-gray-50"
              >
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-gray-900">{worker.worker?.name ?? 'Unknown'}</span>
                    <StatusBadge status={worker.status} />
                    {(worker.status === 'ABSENT' || worker.status === 'SICK') && (() => {
                      const remaining = formatDisruptionRemaining(worker.disruptionEndsAt);
                      return remaining ? (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-orange-100 text-orange-700">
                          {worker.status === 'ABSENT' ? '🚫' : '🤒'} {remaining} left
                        </span>
                      ) : null;
                    })()}
                  </div>
                  <div className="text-sm text-gray-500 mt-1">
                    {formatSpecialty(worker.worker?.specialty ?? '')} · Exp {worker.worker?.experienceLevel} · Commitment {worker.worker?.commitmentLevel}% · Salary {worker.worker?.salary}/day
                  </div>
                  <div className="text-xs text-gray-400 mt-0.5 flex items-center gap-1.5">
                    <span>
                      Assigned to: <span className="font-medium text-gray-600">{worker.factory?.name || worker.factory?.category || 'Unassigned'}</span>
                    </span>
                    {worker.factory && isWorkerFactoryMatch(worker.worker?.specialty ?? null, worker.factory) && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-100 text-green-700 font-medium">✓ Match</span>
                    )}
                    {worker.factory && !isWorkerFactoryMatch(worker.worker?.specialty ?? null, worker.factory) && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500">No bonus</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setReassignModal(worker)}
                    disabled={actionLoading === worker.workerId}
                  >
                    Reassign
                  </Button>
                  {worker.factoryId && (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={async () => {
                        setActionLoading(worker.workerId);
                        try {
                          await api.post(`/workers/${worker.workerId}/unassign`);
                          addToast('Employee unassigned', 'info');
                          await fetchData();
                        } catch (err) {
                          addToast(err instanceof Error ? err.message : 'Failed to unassign', 'error');
                        } finally {
                          setActionLoading(null);
                        }
                      }}
                      disabled={actionLoading === worker.workerId}
                    >
                      Unassign
                    </Button>
                  )}
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => setFireTarget(worker)}
                    loading={actionLoading === worker.workerId}
                  >
                    Fire
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>

      {/* Available Employees */}
      <Panel title="Available Employees" collapsible defaultOpen={true}>
        {available.length === 0 ? (
          <p className="text-gray-500 text-sm">No employees available right now.</p>
        ) : (
          <div className="space-y-3">
            {/* Specialty filter */}
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-gray-500">Filter:</span>
              <button
                onClick={() => setSpecialtyFilter('')}
                className={`px-2.5 py-1 text-xs rounded-full transition-colors ${
                  specialtyFilter === '' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                All
              </button>
              {Object.entries(SPECIALTY_DISPLAY).map(([key, info]) => (
                <button
                  key={key}
                  onClick={() => setSpecialtyFilter(key)}
                  className={`px-2.5 py-1 text-xs rounded-full transition-colors ${
                    specialtyFilter === key ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {info.icon} {info.label}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {available
              .filter((w) => !specialtyFilter || w.specialty === specialtyFilter)
              .map((worker) => (
              <Card key={worker.id} padding="sm">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-medium text-gray-900">{worker.name}</p>
                    <p className="text-sm text-gray-500">
                      {formatSpecialty(worker.specialty)} · Age {worker.age} · {worker.gender}
                    </p>
                    <p className="text-sm text-gray-500">
                      Exp {worker.experienceLevel} · Commitment {worker.commitmentLevel}%
                    </p>
                    <p className="text-sm font-medium text-blue-700 mt-1">{worker.salary} coins/day</p>
                  </div>
                  <div>
                    <select
                      className="text-sm border border-gray-300 rounded px-2 py-1 mb-1 w-full"
                      defaultValue=""
                      id={`factory-select-${worker.id}`}
                      aria-label="Select factory"
                      onChange={(e) => {
                        if (e.target.value === '__unassigned__') {
                          handleHire(worker.id);
                        } else if (e.target.value) {
                          handleHire(worker.id, e.target.value);
                        }
                      }}
                      disabled={actionLoading === worker.id}
                    >
                      <option value="" disabled>
                        Hire to...
                      </option>
                      <option value="__unassigned__">Hire (Unassigned)</option>
                      {factories
                        .filter((f) => f.workerCount < 2)
                        .map((f) => (
                          <option key={f.id} value={f.id}>
                            {f.name || f.category || f.id.slice(0, 8)}
                          </option>
                        ))}
                    </select>
                  </div>
                </div>
              </Card>
            ))}
          </div>
          </div>
        )}
      </Panel>

      {/* Reassign Modal */}
      <Modal
        open={reassignModal !== null}
        onClose={() => setReassignModal(null)}
        title="Reassign Employee"
      >
        {reassignModal && (
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              Reassign <strong>{reassignModal.worker?.name ?? 'Worker'}</strong> to a different factory:
            </p>
            <div className="space-y-2">
              {factories
                .filter((f) => f.id !== reassignModal.factoryId && f.workerCount < 2)
                .map((f) => (
                  <button
                    key={f.id}
                    className="w-full text-left p-3 rounded-lg border border-gray-200 hover:border-blue-300 hover:bg-blue-50 transition-colors"
                    onClick={() => handleReassign(reassignModal.workerId, f.id)}
                    disabled={actionLoading === reassignModal.workerId}
                  >
                    <span className="font-medium">{f.name || f.category || f.id.slice(0, 8)}</span>
                    <span className="text-sm text-gray-500 ml-2">({f.workerCount}/2 workers)</span>
                  </button>
                ))}
              {factories.filter((f) => f.id !== reassignModal.factoryId && f.workerCount < 2).length === 0 && (
                <p className="text-sm text-gray-500">No other factories with available slots.</p>
              )}
            </div>
            <div className="flex justify-end">
              <Button variant="secondary" size="sm" onClick={() => setReassignModal(null)}>
                Cancel
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Fire Confirmation Modal */}
      <Modal
        open={fireTarget !== null}
        onClose={() => setFireTarget(null)}
        title="Fire Employee"
      >
        {fireTarget && (
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              Are you sure you want to fire <strong>{fireTarget.worker?.name ?? 'this worker'}</strong>?
            </p>
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm space-y-1">
              <p className="font-medium text-red-800">Warning</p>
              <ul className="text-red-700 text-xs list-disc list-inside space-y-0.5">
                <li>Workplace happiness will drop by <strong>-5%</strong></li>
                <li>One day&apos;s salary ({fireTarget.worker?.salary ?? 0} coins) will be deducted as settlement</li>
                <li>The employee will return to the available pool</li>
              </ul>
            </div>
            <div className="flex gap-3 justify-end">
              <Button variant="ghost" size="sm" onClick={() => setFireTarget(null)}>
                Cancel
              </Button>
              <Button
                variant="danger"
                size="sm"
                onClick={() => handleFire(fireTarget.workerId)}
                loading={actionLoading === fireTarget.workerId}
              >
                Confirm Fire
              </Button>
            </div>
          </div>
        )}
      </Modal>
      {/* Happiness Boost Modal */}
      <Modal
        open={showHappinessBoost}
        onClose={() => setShowHappinessBoost(false)}
        title="Boost Workplace Happiness"
      >
        <HappinessBoostContent
          onClose={() => setShowHappinessBoost(false)}
          onComplete={() => { setShowHappinessBoost(false); fetchData(); }}
        />
      </Modal>
    </div>
  );
}

function HappinessBoostContent({ onClose, onComplete }: { onClose: () => void; onComplete: () => void }) {
  const { addToast } = useToast();
  const { refreshWallet } = useWallet();

  interface BoostOption {
    slug: string;
    name: string;
    icon: string;
    happinessIncrease: number;
    costPerWorker?: number;
    cost?: number;
    cooldownDays: number;
    onCooldown: boolean;
    cooldownEndsAt: string | null;
  }

  const [boosts, setBoosts] = useState<BoostOption[]>([]);
  const [selected, setSelected] = useState<BoostOption | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const [workerCount, setWorkerCount] = useState(0);

  useEffect(() => {
    Promise.all([
      api.get<BoostOption[]>('/happiness/boosts'),
      api.get<{ id: string }[]>('/workers/mine'),
    ]).then(([boostData, workers]) => {
      setBoosts(Array.isArray(boostData) ? boostData : []);
      setWorkerCount(Array.isArray(workers) ? workers.length : 0);
    }).catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  function getCostPerWorker(boost: BoostOption): number {
    return boost.costPerWorker ?? boost.cost ?? 0;
  }

  function getTotalCost(boost: BoostOption): number {
    return getCostPerWorker(boost) * Math.max(1, workerCount);
  }

  async function handleConfirm() {
    if (!selected) return;
    setConfirming(true);
    try {
      await api.post('/happiness/boost', { boostSlug: selected.slug });
      addToast(`${selected.name} applied! Happiness +${selected.happinessIncrease}% (${getTotalCost(selected)} coins)`, 'success');
      await refreshWallet();
      onComplete();
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed', 'error');
    } finally {
      setConfirming(false);
    }
  }

  if (loading) return <p className="text-sm text-gray-500 text-center py-4">Loading boosts...</p>;

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-600">
        Improve your workforce happiness. Cost is per worker ({workerCount} worker{workerCount !== 1 ? 's' : ''} hired).
      </p>
      <div className="space-y-2">
        {boosts.map((boost) => {
          const perWorker = getCostPerWorker(boost);
          const total = getTotalCost(boost);
          return (
            <button
              key={boost.slug}
              onClick={() => !boost.onCooldown && setSelected(boost)}
              disabled={boost.onCooldown}
              className={`w-full flex items-start gap-3 p-3 rounded-lg border-2 text-left transition-colors ${
                boost.onCooldown
                  ? 'border-gray-100 bg-gray-50 opacity-50 cursor-not-allowed'
                  : selected?.slug === boost.slug
                  ? 'border-blue-500 bg-blue-50'
                  : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              <span className="text-2xl shrink-0">{boost.icon}</span>
              <div className="flex-1">
                <p className="text-sm font-medium text-gray-900">{boost.name}</p>
                {boost.onCooldown && boost.cooldownEndsAt && (
                  <p className="text-[10px] text-red-500">
                    Available on: {new Date(boost.cooldownEndsAt).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' })}
                  </p>
                )}
              </div>
              <div className="text-right shrink-0">
                <p className="text-xs font-bold text-green-600">+{boost.happinessIncrease}%</p>
                <p className="text-[10px] text-gray-500">{perWorker}/worker</p>
                <p className="text-[10px] font-medium text-gray-700">Total: {total} coins</p>
              </div>
            </button>
          );
        })}
      </div>

      <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
        <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
        <Button variant="primary" size="sm" disabled={!selected} loading={confirming} onClick={handleConfirm}>
          {selected ? `Confirm (${getTotalCost(selected)} coins)` : 'Select an incentive'}
        </Button>
      </div>
      <p className="text-[10px] text-gray-400 text-center">Each boost has a cooldown period after use.</p>
    </div>
  );
}

function IncentiveOption({ icon, title, description, effect, cost, onClick, selected }: {
  icon: string; title: string; description: string; effect: string; cost: string; onClick: () => void; selected?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-start gap-3 p-3 rounded-lg border-2 transition-colors text-left ${
        selected ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300'
      }`}
    >
      <span className="text-2xl shrink-0">{icon}</span>
      <div className="flex-1">
        <p className="text-sm font-medium text-gray-900">{title}</p>
        <p className="text-xs text-gray-500">{description}</p>
      </div>
      <div className="text-right shrink-0">
        <p className="text-xs font-bold text-green-600">{effect}</p>
        <p className="text-[10px] text-gray-400">{cost}</p>
      </div>
    </button>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    WORKING: 'bg-green-100 text-green-700',
    ABSENT: 'bg-yellow-100 text-yellow-700',
    SICK: 'bg-orange-100 text-orange-700',
    ON_VACATION: 'bg-purple-100 text-purple-700',
    UNASSIGNED: 'bg-gray-100 text-gray-600',
  };
  const colorClass = colors[status] || 'bg-gray-100 text-gray-600';
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${colorClass}`}>
      {status.replace('_', ' ')}
    </span>
  );
}
