'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Card, Loader, Panel, Modal } from '@sea-commodity-tycoon/ui';
import { api } from '@/lib/api-client';
import { useAuth } from '@/app/providers';
import { useToast } from '@/lib/toast-context';
import { OnboardingFlow, OnboardingProgress } from './components/OnboardingFlow';

interface DashboardResponse {
  player: {
    id: string;
    email: string;
    displayName: string;
    avatarConfig: Record<string, unknown>;
    createdAt: string;
    lastActiveAt: string;
  };
  season: {
    id: string;
    specialty: string | null;
    coins: number;
    storageCapacity: number;
    workforceHappiness: number;
  } | null;
  netWorth: {
    cash: number;
    landValue: number;
    factoryValue: number;
    inventoryMarketValue: number;
    outstandingDebt: number;
    total: number;
  } | null;
}

const SPECIALTY_OPTIONS = [
  { slug: 'rice', name: 'Rice', icon: '🌾', category: 'Agriculture' },
  { slug: 'palm-fruit', name: 'Palm Fruit', icon: '🌴', category: 'Agriculture' },
  { slug: 'cocoa', name: 'Cocoa', icon: '🍫', category: 'Agriculture' },
  { slug: 'coffee', name: 'Coffee', icon: '☕', category: 'Agriculture' },
  { slug: 'crude-oil', name: 'Crude Oil', icon: '🛢️', category: 'Energy' },
  { slug: 'natural-gas', name: 'Natural Gas', icon: '🔥', category: 'Energy' },
  { slug: 'iron-ore', name: 'Iron Ore', icon: '⛏️', category: 'Metal' },
  { slug: 'nickel-ore', name: 'Nickel Ore', icon: '🪨', category: 'Metal' },
  { slug: 'poultry', name: 'Poultry', icon: '🐔', category: 'Livestock' },
  { slug: 'cattle', name: 'Cattle', icon: '🐄', category: 'Livestock' },
  { slug: 'fish', name: 'Fish', icon: '🐟', category: 'Fishery' },
  { slug: 'timber', name: 'Timber', icon: '🪵', category: 'Forestry' },
  { slug: 'rubber', name: 'Rubber', icon: '🌳', category: 'Forestry' },
];

/** Supply chain paths: each L0 commodity's routes to final consumer */
interface PathStep {
  name: string;
  icon: string;
  level: string;
  /** Additional inputs needed (for L2 products that need other ingredients) */
  alsoRequires?: string[];
}

interface SupplyPath {
  steps: PathStep[];
}

const COMMODITY_PATHS: Record<string, SupplyPath[]> = {
  'rice': [
    { steps: [{ name: 'Rice', icon: '🌾', level: 'L0' }, { name: 'Flour', icon: '🫓', level: 'L1' }, { name: 'Supermarket', icon: '🏪', level: 'Shop' }] },
  ],
  'palm-fruit': [
    { steps: [{ name: 'Palm Fruit', icon: '🌴', level: 'L0' }, { name: 'Cooking Oil', icon: '🫒', level: 'L1' }, { name: 'Supermarket', icon: '🏪', level: 'Shop' }] },
    { steps: [{ name: 'Palm Fruit', icon: '🌴', level: 'L0' }, { name: 'Biodiesel', icon: '⛽', level: 'L1' }, { name: 'Petrol Station', icon: '⛽', level: 'Shop' }] },
  ],
  'cocoa': [
    { steps: [{ name: 'Cocoa', icon: '🍫', level: 'L0' }, { name: 'Chocolate', icon: '🍫', level: 'L1' }, { name: 'Supermarket', icon: '🏪', level: 'Shop' }] },
  ],
  'coffee': [
    { steps: [{ name: 'Coffee', icon: '☕', level: 'L0' }, { name: 'Roasted Coffee', icon: '☕', level: 'L1' }, { name: 'Cafe', icon: '☕', level: 'Shop' }] },
  ],
  'crude-oil': [
    { steps: [{ name: 'Crude Oil', icon: '🛢️', level: 'L0' }, { name: 'Gasoline', icon: '⛽', level: 'L1' }, { name: 'Petrol Station', icon: '⛽', level: 'Shop' }] },
    { steps: [{ name: 'Crude Oil', icon: '🛢️', level: 'L0' }, { name: 'Plastic', icon: '🧱', level: 'L1' }, { name: 'Mobile Phone', icon: '📱', level: 'L2', alsoRequires: ['Battery (from Nickel Ore)'] }, { name: 'Electronics Shop', icon: '🏬', level: 'Shop' }] },
  ],
  'natural-gas': [
    { steps: [{ name: 'Natural Gas', icon: '🔥', level: 'L0' }, { name: 'Fertilizer', icon: '🧪', level: 'L1' }, { name: 'Marketplace', icon: '🏛️', level: 'Utility' }] },
  ],
  'iron-ore': [
    { steps: [{ name: 'Iron Ore', icon: '⛏️', level: 'L0' }, { name: 'Steel', icon: '🔩', level: 'L1' }, { name: 'Automobile', icon: '🚗', level: 'L2', alsoRequires: ['Tire (from Rubber)', 'Battery (from Nickel Ore)'] }, { name: 'Car Store', icon: '🏎️', level: 'Shop' }] },
  ],
  'nickel-ore': [
    { steps: [{ name: 'Nickel Ore', icon: '🪨', level: 'L0' }, { name: 'Battery', icon: '🔋', level: 'L1' }, { name: 'Mobile Phone', icon: '📱', level: 'L2', alsoRequires: ['Plastic (from Crude Oil)'] }, { name: 'Electronics Shop', icon: '🏬', level: 'Shop' }] },
    { steps: [{ name: 'Nickel Ore', icon: '🪨', level: 'L0' }, { name: 'Battery', icon: '🔋', level: 'L1' }, { name: 'Automobile', icon: '🚗', level: 'L2', alsoRequires: ['Steel (from Iron Ore)', 'Tire (from Rubber)'] }, { name: 'Car Store', icon: '🏎️', level: 'Shop' }] },
  ],
  'poultry': [
    { steps: [{ name: 'Poultry', icon: '🐔', level: 'L0' }, { name: 'Chicken Meat', icon: '🍗', level: 'L1' }, { name: 'Butcher', icon: '🥩', level: 'Shop' }] },
    { steps: [{ name: 'Poultry', icon: '🐔', level: 'L0' }, { name: 'Eggs', icon: '🥚', level: 'L1' }, { name: 'Supermarket', icon: '🏪', level: 'Shop' }] },
  ],
  'cattle': [
    { steps: [{ name: 'Cattle', icon: '🐄', level: 'L0' }, { name: 'Beef', icon: '🥩', level: 'L1' }, { name: 'Butcher', icon: '🥩', level: 'Shop' }] },
    { steps: [{ name: 'Cattle', icon: '🐄', level: 'L0' }, { name: 'Milk', icon: '🥛', level: 'L1' }, { name: 'Supermarket', icon: '🏪', level: 'Shop' }] },
  ],
  'fish': [
    { steps: [{ name: 'Fish', icon: '🐟', level: 'L0' }, { name: 'Butcher', icon: '🥩', level: 'Shop' }] },
  ],
  'timber': [
    { steps: [{ name: 'Timber', icon: '🪵', level: 'L0' }, { name: 'Furniture', icon: '🪑', level: 'L1' }, { name: 'Furniture Shop', icon: '🛋️', level: 'Shop' }] },
  ],
  'rubber': [
    { steps: [{ name: 'Rubber', icon: '🌳', level: 'L0' }, { name: 'Tire', icon: '🛞', level: 'L1' }, { name: 'Automobile', icon: '🚗', level: 'L2', alsoRequires: ['Steel (from Iron Ore)', 'Battery (from Nickel Ore)'] }, { name: 'Car Store', icon: '🏎️', level: 'Shop' }] },
  ],
};

export default function DashboardPage() {
  const router = useRouter();
  const { logout } = useAuth();
  const { addToast } = useToast();
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Display name editing state
  const [editingName, setEditingName] = useState(false);
  const [newDisplayName, setNewDisplayName] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);
  const [nameSaving, setNameSaving] = useState(false);

  // Specialty selection state
  const [specialtyModalOpen, setSpecialtyModalOpen] = useState(false);
  const [selectedSpecialty, setSelectedSpecialty] = useState<string | null>(null);
  const [specialtySaving, setSpecialtySaving] = useState(false);
  const [specialtyError, setSpecialtyError] = useState<string | null>(null);

  // Onboarding progress
  const [onboarding, setOnboarding] = useState<OnboardingProgress>({
    hasSpecialty: false,
    hasLand: false,
    hasFactory: false,
    hasWorker: false,
  });

  const fetchData = useCallback(async () => {
    try {
      const dashboard = await api.get<DashboardResponse>('/players/me/dashboard');
      setData(dashboard);
      setError(null);

      // Open specialty modal if no specialty selected
      if (dashboard.season && !dashboard.season.specialty) {
        setSpecialtyModalOpen(true);
      }

      // Fetch onboarding progress if season active
      if (dashboard.season) {
        const hasSpecialty = !!dashboard.season.specialty;
        const hasLand = (dashboard.netWorth?.landValue ?? 0) > 0;

        // Fetch factory and worker counts in parallel
        const [factories, workers] = await Promise.all([
          api.get<{ id: string }[]>('/factories').catch(() => []),
          api.get<{ id: string }[]>('/workers/mine').catch(() => []),
        ]);

        setOnboarding({
          hasSpecialty,
          hasLand,
          hasFactory: factories.length > 0,
          hasWorker: workers.length > 0,
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load dashboard');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleLogout = () => {
    logout();
    router.push('/login');
  };

  const handleEditName = () => {
    if (data) {
      setNewDisplayName(data.player.displayName);
      setNameError(null);
      setEditingName(true);
    }
  };

  const handleSaveName = async () => {
    if (!newDisplayName.trim()) {
      setNameError('Display name cannot be empty');
      return;
    }
    if (newDisplayName.length < 3 || newDisplayName.length > 50) {
      setNameError('Display name must be 3-50 characters');
      return;
    }
    if (!/^[a-zA-Z0-9_-]+$/.test(newDisplayName)) {
      setNameError('Only letters, numbers, underscores, and hyphens allowed');
      return;
    }

    setNameSaving(true);
    setNameError(null);
    try {
      await api.put('/players/me/profile', { displayName: newDisplayName });
      setData((prev) =>
        prev ? { ...prev, player: { ...prev.player, displayName: newDisplayName } } : prev,
      );
      setEditingName(false);
      addToast('Display name updated', 'success');
    } catch (err) {
      setNameError(err instanceof Error ? err.message : 'Failed to update name');
    } finally {
      setNameSaving(false);
    }
  };

  const handleCancelEditName = () => {
    setEditingName(false);
    setNameError(null);
  };

  const handleConfirmSpecialty = async () => {
    if (!selectedSpecialty) return;

    setSpecialtySaving(true);
    setSpecialtyError(null);
    try {
      await api.post('/players/me/specialty', { commodity: selectedSpecialty });
      setData((prev) =>
        prev && prev.season
          ? { ...prev, season: { ...prev.season, specialty: selectedSpecialty } }
          : prev,
      );
      setOnboarding((prev) => ({ ...prev, hasSpecialty: true }));
      setSpecialtyModalOpen(false);
      addToast(`Specialty selected: ${selectedSpecialty}`, 'success');
    } catch (err) {
      setSpecialtyError(err instanceof Error ? err.message : 'Failed to select specialty');
    } finally {
      setSpecialtySaving(false);
    }
  };

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

  if (!data) return null;

  const { player, season, netWorth } = data;

  // No active season
  if (!season) {
    return (
      <div className="max-w-4xl mx-auto p-4 space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
          <Button variant="ghost" size="sm" onClick={handleLogout}>
            Logout
          </Button>
        </div>
        <Card>
          <div className="text-center py-8">
            <p className="text-gray-600 text-lg">Welcome, {player.displayName}!</p>
            <p className="text-gray-500 mt-2">No active season right now. A new season will start soon.</p>
          </div>
        </Card>
      </div>
    );
  }

  const coins = season.coins;
  const total = netWorth?.total ?? coins;

  return (
    <div className="max-w-5xl mx-auto p-4 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <div className="flex items-center gap-3">
          {season.specialty && (
            <span className="text-sm px-3 py-1 rounded-full bg-blue-100 text-blue-700 font-medium">
              {season.specialty}
            </span>
          )}
          <Button variant="ghost" size="sm" onClick={handleLogout}>
            Logout
          </Button>
        </div>
      </div>

      {/* Specialty Selection Modal - cannot be closed without choosing */}
      <SpecialtyModal
        open={specialtyModalOpen}
        selectedSpecialty={selectedSpecialty}
        onSelect={setSelectedSpecialty}
        onConfirm={handleConfirmSpecialty}
        saving={specialtySaving}
        error={specialtyError}
      />

      {/* Onboarding flow - shown until player completes all setup steps */}
      {season.specialty && (
        <OnboardingFlow progress={onboarding} specialty={season.specialty} />
      )}

      {/* Cash and Net Worth */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <div className="space-y-1">
            <p className="text-sm text-gray-500">Cash on Hand</p>
            <p className="text-3xl font-bold text-gray-900">{coins.toLocaleString()} <span className="text-base font-normal text-gray-500">coins</span></p>
          </div>
        </Card>
        <Card>
          <div className="space-y-1">
            <p className="text-sm text-gray-500">Net Worth</p>
            <p className="text-3xl font-bold text-green-700">{total.toLocaleString()} <span className="text-base font-normal text-gray-500">coins</span></p>
          </div>
        </Card>
      </div>

      {/* Net Worth Breakdown */}
      {netWorth && (
        <Card title="Net Worth Breakdown">
          <div className="space-y-3">
            <NetWorthRow label="Cash" value={netWorth.cash} color="text-gray-900" />
            <NetWorthRow label="Land Value" value={netWorth.landValue} color="text-emerald-700" />
            <NetWorthRow label="Factory Value" value={netWorth.factoryValue} color="text-blue-700" />
            <NetWorthRow label="Inventory (Market Value)" value={netWorth.inventoryMarketValue} color="text-purple-700" />
            <NetWorthRow label="Outstanding Debt" value={-netWorth.outstandingDebt} color="text-red-600" />
            <div className="border-t border-gray-200 pt-2 mt-2">
              <div className="flex justify-between items-center">
                <span className="font-semibold text-gray-900">Total</span>
                <span className="font-bold text-lg text-gray-900">{netWorth.total.toLocaleString()} coins</span>
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* Quick Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Storage" value={`${season.storageCapacity}`} />
        <StatCard label="Happiness" value={`${season.workforceHappiness}%`} />
        <StatCard label="Specialty" value={season.specialty || 'None'} />
        <StatCard label="Season" value="Active" />
      </div>

      {/* Player Info */}
      <Panel title="Player Info">
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <span className="text-gray-500">Display Name</span>
            {editingName ? (
              <div className="mt-1 space-y-2">
                <input
                  type="text"
                  value={newDisplayName}
                  onChange={(e) => setNewDisplayName(e.target.value)}
                  className="w-full px-2 py-1 border border-gray-300 rounded text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  maxLength={50}
                  aria-label="New display name"
                />
                {nameError && (
                  <p className="text-xs text-red-600">{nameError}</p>
                )}
                <div className="flex gap-2">
                  <Button size="sm" onClick={handleSaveName} loading={nameSaving}>
                    Save
                  </Button>
                  <Button size="sm" variant="ghost" onClick={handleCancelEditName} disabled={nameSaving}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2 mt-1">
                <p className="font-medium text-gray-900">{player.displayName}</p>
                <button
                  onClick={handleEditName}
                  className="text-blue-600 hover:text-blue-800 text-xs underline"
                  aria-label="Edit display name"
                >
                  Edit
                </button>
              </div>
            )}
          </div>
          <div>
            <span className="text-gray-500">Email</span>
            <p className="font-medium text-gray-900">{player.email}</p>
          </div>
          <div>
            <span className="text-gray-500">Joined</span>
            <p className="font-medium text-gray-900">{new Date(player.createdAt).toLocaleDateString()}</p>
          </div>
          <div>
            <span className="text-gray-500">Last Active</span>
            <p className="font-medium text-gray-900">{new Date(player.lastActiveAt).toLocaleString()}</p>
          </div>
        </div>
      </Panel>
    </div>
  );
}

/** Specialty selection popup - cannot be dismissed without selecting one */
function SpecialtyModal({
  open,
  selectedSpecialty,
  onSelect,
  onConfirm,
  saving,
  error,
}: {
  open: boolean;
  selectedSpecialty: string | null;
  onSelect: (slug: string) => void;
  onConfirm: () => void;
  saving: boolean;
  error: string | null;
}) {
  if (!open) return null;

  const paths = selectedSpecialty ? COMMODITY_PATHS[selectedSpecialty] : null;

  return (
    <Modal open={open} onClose={() => {}} title="Choose Your Specialty" closable={false} className="max-w-3xl">
      <div className="space-y-4">
        <p className="text-sm text-gray-600">
          Select a commodity to specialize in. You&apos;ll get a <strong>10% production bonus</strong> on factories producing this commodity. This choice is locked for the entire season.
        </p>

        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2 max-h-[260px] overflow-y-auto pr-1">
          {SPECIALTY_OPTIONS.map((opt) => (
            <button
              key={opt.slug}
              onClick={() => onSelect(opt.slug)}
              className={`flex flex-col items-center p-2.5 rounded-lg border-2 transition-all hover:shadow-md ${
                selectedSpecialty === opt.slug
                  ? 'border-blue-500 bg-blue-50 shadow-md'
                  : 'border-gray-200 bg-white hover:border-gray-300'
              }`}
              aria-pressed={selectedSpecialty === opt.slug}
              aria-label={`Select ${opt.name} specialty`}
            >
              <span className="text-2xl" role="img" aria-hidden="true">{opt.icon}</span>
              <span className="text-xs font-semibold text-gray-900 mt-1 text-center leading-tight">{opt.name}</span>
              <span className="text-[10px] text-gray-400">{opt.category}</span>
            </button>
          ))}
        </div>

        {/* Supply chain path preview - shown when a commodity is selected */}
        {paths && (
          <div className="bg-gray-50 rounded-lg p-3 border border-gray-200">
            <p className="text-xs font-medium text-gray-500 mb-2 uppercase tracking-wide">Supply Chain Path</p>
            <div className="space-y-3">
              {paths.map((path, pathIdx) => (
                <div key={pathIdx} className="space-y-1">
                  <div className="flex items-center gap-1 flex-wrap">
                    {path.steps.map((step, stepIdx) => (
                      <React.Fragment key={stepIdx}>
                        {stepIdx > 0 && (
                          <span className="text-gray-300 text-sm" aria-hidden="true">→</span>
                        )}
                        <span className="inline-flex items-center gap-1 px-2 py-1 rounded bg-white border border-gray-200 text-xs">
                          <span role="img" aria-hidden="true">{step.icon}</span>
                          <span className="font-medium text-gray-700">{step.name}</span>
                          <span className="text-[10px] text-gray-400">({step.level})</span>
                        </span>
                      </React.Fragment>
                    ))}
                  </div>
                  {/* Show additional required materials for L2 assembly */}
                  {path.steps.some((s) => s.alsoRequires) && (
                    <div className="ml-4 flex items-start gap-1 text-xs text-amber-700">
                      <span className="shrink-0">⚠️</span>
                      <span>
                        Also requires:{' '}
                        {path.steps
                          .filter((s) => s.alsoRequires)
                          .flatMap((s) => s.alsoRequires!)
                          .join(', ')}
                      </span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {error && (
          <p className="text-sm text-red-600" role="alert">{error}</p>
        )}

        <div className="flex justify-end pt-2">
          <Button
            onClick={onConfirm}
            disabled={!selectedSpecialty}
            loading={saving}
          >
            Confirm Specialty
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function NetWorthRow({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="flex justify-between items-center text-sm">
      <span className="text-gray-500">{label}</span>
      <span className={`font-medium ${color}`}>
        {value >= 0 ? '' : '-'}{Math.abs(value).toLocaleString()} coins
      </span>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <Card padding="sm">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="text-xl font-bold text-gray-900 mt-1">{value}</p>
    </Card>
  );
}
