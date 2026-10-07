'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { Button, Card, Loader } from '@sea-commodity-tycoon/ui';
import { api } from '@/lib/api-client';

interface CommodityRow {
  id: string;
  slug: string;
  name: string;
  category: string;
  level: number;
  base_price: number;
  production_time_minutes: number;
  base_yield: number;
  storage_size: number;
  setup_cost: number;
  recipe_inputs: { commodity_slug: string; commodity_name: string; quantity: number }[];
  recipe_id: string | null;
  recipe_slug: string | null;
  _dirty?: boolean;
}

const LEVEL_LABELS: Record<number, string> = { 0: 'Raw', 1: 'Processed', 2: 'Assembly' };

const CATEGORY_COLORS: Record<string, string> = {
  AGRICULTURE: 'bg-green-100 text-green-700',
  ENERGY: 'bg-yellow-100 text-yellow-800',
  METAL: 'bg-gray-200 text-gray-700',
  LIVESTOCK: 'bg-orange-100 text-orange-700',
  FISHERY: 'bg-blue-100 text-blue-700',
  FORESTRY: 'bg-emerald-100 text-emerald-800',
  ELECTRONICS: 'bg-purple-100 text-purple-700',
  AUTOMOTIVE: 'bg-red-100 text-red-700',
};

export default function ConfigPage() {
  const [commodities, setCommodities] = useState<CommodityRow[]>([]);
  const [boosts, setBoosts] = useState<Array<{ slug: string; name: string; icon: string; costPerWorker: number; happinessIncrease: number; cooldownDays: number; _dirty?: boolean }>>([]);
  const [boostsSaving, setBoostsSaving] = useState(false);
  const [salaryConfig, setSalaryConfig] = useState<{
    specialties: Array<{ key: string; icon: string; label: string; covers: string; baseSalary: number[] }>;
    experienceLevels: string[];
  } | null>(null);
  const [salarySaving, setSalarySaving] = useState(false);
  const [salarySuccess, setSalarySuccess] = useState<string | null>(null);
  const [generateCount, setGenerateCount] = useState(100);
  const [generating, setGenerating] = useState(false);
  const [boostsSuccess, setBoostsSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [configTab, setConfigTab] = useState<'commodities' | 'happiness' | 'workers'>('commodities');
  const [filterCategory, setFilterCategory] = useState<string>('ALL');
  const [filterLevel, setFilterLevel] = useState<string>('ALL');

  const fetchData = useCallback(async () => {
    try {
      const data = await api.get<{ commodities: CommodityRow[] }>('/admin/data/combined');
      setCommodities((data.commodities || []).map((c) => ({ ...c, _dirty: false })));
      // Fetch salary config
      try {
        const salaryData = await api.get<any>('/admin/data/salary-config');
        setSalaryConfig(salaryData);
      } catch { /* ignore */ }

      // Also fetch happiness boosts
      try {
        const boostData = await api.get<{ boosts: Array<{ slug: string; name: string; cost: number; happinessIncrease: number }> }>('/admin/data/happiness-boosts');
        setBoosts((boostData.boosts || []).map(b => ({ ...b, icon: (b as any).icon || '🎁', costPerWorker: (b as any).costPerWorker ?? (b as any).cost ?? 20, cooldownDays: (b as any).cooldownDays ?? 5, _dirty: false })));
      } catch { /* ignore */ }

      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const updateField = (index: number, field: string, value: string) => {
    setCommodities((prev) => {
      const updated = [...prev];
      const numVal = value === '' ? 0 : Number(value);
      updated[index] = { ...updated[index], [field]: numVal, _dirty: true };
      return updated;
    });
  };

  const updateRecipeInput = (commodityIdx: number, inputIdx: number, field: string, value: string) => {
    setCommodities((prev) => {
      const updated = [...prev];
      const inputs = [...updated[commodityIdx].recipe_inputs];
      if (field === 'quantity') {
        inputs[inputIdx] = { ...inputs[inputIdx], quantity: value === '' ? 1 : Number(value) };
      } else if (field === 'commodity_slug') {
        const match = prev.find(c => c.slug === value);
        inputs[inputIdx] = { ...inputs[inputIdx], commodity_slug: value, commodity_name: match?.name || value };
      }
      updated[commodityIdx] = { ...updated[commodityIdx], recipe_inputs: inputs, _dirty: true };
      return updated;
    });
  };

  const removeRecipeInput = (commodityIdx: number, inputIdx: number) => {
    setCommodities((prev) => {
      const updated = [...prev];
      const inputs = updated[commodityIdx].recipe_inputs.filter((_, i) => i !== inputIdx);
      updated[commodityIdx] = { ...updated[commodityIdx], recipe_inputs: inputs, _dirty: true };
      return updated;
    });
  };

  const addRecipeInput = (commodityIdx: number) => {
    setCommodities((prev) => {
      const updated = [...prev];
      const row = updated[commodityIdx];
      // Default to first available lower-level commodity
      const lowerLevel = prev.filter(c => c.level < row.level);
      const defaultSlug = lowerLevel[0]?.slug || '';
      const defaultName = lowerLevel[0]?.name || '';
      const inputs = [...row.recipe_inputs, { commodity_slug: defaultSlug, commodity_name: defaultName, quantity: 1 }];
      updated[commodityIdx] = { ...updated[commodityIdx], recipe_inputs: inputs, _dirty: true };
      return updated;
    });
  };

  const updateBoost = (index: number, field: string, value: string) => {
    setBoosts((prev) => {
      const updated = [...prev];
      if (field === 'costPerWorker' || field === 'happinessIncrease' || field === 'cooldownDays') {
        updated[index] = { ...updated[index], [field]: value === '' ? 0 : Number(value), _dirty: true };
      } else {
        updated[index] = { ...updated[index], [field]: value, _dirty: true };
      }
      return updated;
    });
  };

  const addBoost = () => {
    setBoosts((prev) => [...prev, { slug: `boost-${Date.now()}`, name: '', icon: '🎁', costPerWorker: 20, happinessIncrease: 5, cooldownDays: 5, _dirty: true }]);
  };

  const removeBoost = (index: number) => {
    setBoosts((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSaveBoosts = async () => {
    setBoostsSaving(true);
    setBoostsSuccess(null);
    setError(null);
    try {
      await api.put('/admin/data/happiness-boosts', {
        boosts: boosts.map(({ _dirty, ...b }) => b),
      });
      setBoosts((prev) => prev.map(b => ({ ...b, _dirty: false })));
      setBoostsSuccess('Happiness boosts saved successfully.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save boosts');
    } finally {
      setBoostsSaving(false);
    }
  };

  const handleSaveSalaryConfig = async () => {
    if (!salaryConfig) return;
    setSalarySaving(true);
    setSalarySuccess(null);
    setError(null);
    try {
      await api.put('/admin/data/salary-config', salaryConfig);
      setSalarySuccess('Salary config saved.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save salary config');
    } finally {
      setSalarySaving(false);
    }
  };

  const handleGenerateWorkers = async () => {
    setGenerating(true);
    setError(null);
    try {
      const result = await api.post<{ generated: number }>('/admin/workers/generate', { count: generateCount });
      setSalarySuccess('Generated ' + result.generated + ' new workers.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate workers');
    } finally {
      setGenerating(false);
    }
  };

  const handleSaveAll = async () => {
    const dirtyRows = commodities.filter((c) => c._dirty);
    if (dirtyRows.length === 0) {
      setSuccess('No changes to save.');
      return;
    }

    setSaving(true);
    setError(null);
    setSuccess(null);

    let savedCount = 0;
    let failCount = 0;

    for (const row of dirtyRows) {
      try {
        await api.put(`/admin/data/commodity/${row.id}`, {
          base_price: row.base_price,
          production_time_minutes: row.production_time_minutes,
          base_yield: row.base_yield,
          storage_size: row.storage_size,
          setup_cost: row.setup_cost,
          recipe_id: row.recipe_id,
          recipe_inputs: row.recipe_inputs.length > 0 ? row.recipe_inputs.map(inp => ({
            commodity_slug: inp.commodity_slug,
            quantity: inp.quantity,
          })) : undefined,
        });
        savedCount++;
      } catch {
        failCount++;
      }
    }

    setSaving(false);

    if (failCount === 0) {
      setSuccess(`Saved ${savedCount} commodity update${savedCount !== 1 ? 's' : ''}.`);
      setCommodities((prev) => prev.map((c) => ({ ...c, _dirty: false })));
    } else {
      setError(`Saved ${savedCount}, failed ${failCount}.`);
    }
  };

  const dirtyCount = commodities.filter((c) => c._dirty).length;

  // Filtering
  const categories = [...new Set(commodities.map((c) => c.category))].sort();
  const filtered = commodities.filter((c) => {
    if (filterCategory !== 'ALL' && c.category !== filterCategory) return false;
    if (filterLevel !== 'ALL' && c.level !== Number(filterLevel)) return false;
    return true;
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader />
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Game Configuration</h1>
      </div>

      {/* Top-level config tabs */}
      <div className="border-b border-gray-200">
        <nav className="flex gap-1 -mb-px">
          <button
            onClick={() => setConfigTab('commodities')}
            className={`px-4 py-2.5 text-sm font-medium rounded-t-lg transition-colors ${
              configTab === 'commodities'
                ? 'bg-white text-blue-700 border border-b-0 border-gray-200'
                : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
            }`}
          >
            🏭 Commodities & Recipes
          </button>
          <button
            onClick={() => setConfigTab('happiness')}
            className={`px-4 py-2.5 text-sm font-medium rounded-t-lg transition-colors ${
              configTab === 'happiness'
                ? 'bg-white text-blue-700 border border-b-0 border-gray-200'
                : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
            }`}
          >
            😊 Happiness Boosts
          </button>
          <button
            onClick={() => setConfigTab('workers')}
            className={`px-4 py-2.5 text-sm font-medium rounded-t-lg transition-colors ${
              configTab === 'workers'
                ? 'bg-white text-blue-700 border border-b-0 border-gray-200'
                : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
            }`}
          >
            👷 Employees & Salary
          </button>
        </nav>
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm" role="alert">
          {error}
        </div>
      )}
      {success && (
        <div className="p-3 rounded-lg bg-green-50 border border-green-200 text-green-700 text-sm" role="status">
          {success}
        </div>
      )}

      {/* ===== COMMODITIES TAB ===== */}
      {configTab === 'commodities' && (<>
      {/* Filters */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <label htmlFor="filterCategory" className="text-sm text-gray-600">Category:</label>
          <select
            id="filterCategory"
            value={filterCategory}
            onChange={(e) => setFilterCategory(e.target.value)}
            className="px-2 py-1 border border-gray-300 rounded text-sm"
          >
            <option value="ALL">All</option>
            {categories.map((cat) => (
              <option key={cat} value={cat}>{cat}</option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <label htmlFor="filterLevel" className="text-sm text-gray-600">Level:</label>
          <select
            id="filterLevel"
            value={filterLevel}
            onChange={(e) => setFilterLevel(e.target.value)}
            className="px-2 py-1 border border-gray-300 rounded text-sm"
          >
            <option value="ALL">All</option>
            <option value="0">L0 - Raw</option>
            <option value="1">L1 - Processed</option>
            <option value="2">L2 - Assembly</option>
          </select>
        </div>
        <span className="text-sm text-gray-400">
          Showing {filtered.length} of {commodities.length}
        </span>

        <div className="flex flex-1 items-center justify-end gap-3">
          {dirtyCount > 0 && (
            <span className="text-sm text-orange-600 font-medium">
              {dirtyCount} unsaved change{dirtyCount !== 1 ? 's' : ''}
            </span>
          )}
          <Button onClick={handleSaveAll} loading={saving} disabled={dirtyCount === 0}>
            Save All Changes
          </Button>
      </div>
      </div>

      {/* Combined Table */}
      <Card>
        <div className="max-h-[503px] overflow-y-auto border border-gray-200 rounded-lg shadow-sm">
          <table className="w-full text-sm text-left border-collapse">
            <thead className="sticky top-0 bg-gray-100 text-gray-700 uppercase text-xs z-10 shadow-[inset_0_-1px_0_rgba(0,0,0,0.1)]">
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="text-left py-2 px-2 font-medium text-gray-500 whitespace-nowrap">Name</th>
                <th className="text-left py-2 px-2 font-medium text-gray-500 whitespace-nowrap">Category</th>
                <th className="text-left py-2 px-2 font-medium text-gray-500 whitespace-nowrap">Level</th>
                <th className="text-left py-2 px-2 font-medium text-gray-500 whitespace-nowrap">Base Price</th>
                <th className="text-left py-2 px-2 font-medium text-gray-500 whitespace-nowrap">Prod. Time</th>
                <th className="text-left py-2 px-2 font-medium text-gray-500 whitespace-nowrap">Yield</th>
                <th className="text-left py-2 px-2 font-medium text-gray-500 whitespace-nowrap">Storage</th>
                <th className="text-left py-2 px-2 font-medium text-gray-500 whitespace-nowrap">Setup Cost</th>
                <th className="text-left py-2 px-2 font-medium text-gray-500 whitespace-nowrap">Recipe Inputs</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => {
                const originalIdx = commodities.findIndex((c) => c.id === row.id);
                return (
                  <tr
                    key={row.id}
                    className={`border-b border-gray-100 hover:bg-gray-50 ${row._dirty ? 'bg-yellow-50' : ''}`}
                  >
                    <td className="py-1.5 px-2 font-medium text-gray-900 whitespace-nowrap">
                      {row.name}
                    </td>
                    <td className="py-1.5 px-2">
                      <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${CATEGORY_COLORS[row.category] || 'bg-gray-100 text-gray-600'}`}>
                        {row.category}
                      </span>
                    </td>
                    <td className="py-1.5 px-2 text-gray-600 text-xs whitespace-nowrap">
                      L{row.level} {LEVEL_LABELS[row.level] || ''}
                    </td>
                    <td className="py-1.5 px-2">
                      <input
                        type="number"
                        value={row.base_price}
                        onChange={(e) => updateField(originalIdx, 'base_price', e.target.value)}
                        className="w-16 px-1.5 py-0.5 border border-gray-300 rounded text-sm focus:ring-1 focus:ring-blue-500"
                        min="0"
                        step="0.5"
                      />
                    </td>
                    <td className="py-1.5 px-2">
                      <div className="flex items-center gap-1">
                        <input
                          type="number"
                          value={row.production_time_minutes}
                          onChange={(e) => updateField(originalIdx, 'production_time_minutes', e.target.value)}
                          className="w-16 px-1.5 py-0.5 border border-gray-300 rounded text-sm focus:ring-1 focus:ring-blue-500"
                          min="1"
                        />
                        <span className="text-xs text-gray-400">min</span>
                      </div>
                    </td>
                    <td className="py-1.5 px-2">
                      <input
                        type="number"
                        value={row.base_yield}
                        onChange={(e) => updateField(originalIdx, 'base_yield', e.target.value)}
                        className="w-14 px-1.5 py-0.5 border border-gray-300 rounded text-sm focus:ring-1 focus:ring-blue-500"
                        min="1"
                      />
                    </td>
                    <td className="py-1.5 px-2">
                      <input
                        type="number"
                        value={row.storage_size}
                        onChange={(e) => updateField(originalIdx, 'storage_size', e.target.value)}
                        className="w-14 px-1.5 py-0.5 border border-gray-300 rounded text-sm focus:ring-1 focus:ring-blue-500"
                        min="1"
                      />
                    </td>
                    <td className="py-1.5 px-2">
                      <input
                        type="number"
                        value={row.setup_cost}
                        onChange={(e) => updateField(originalIdx, 'setup_cost', e.target.value)}
                        className="w-16 px-1.5 py-0.5 border border-gray-300 rounded text-sm focus:ring-1 focus:ring-blue-500"
                        min="0"
                      />
                    </td>
                    <td className="py-1.5 px-2 text-xs text-gray-600">
                      {row.recipe_inputs.length > 0 ? (
                        <div className="space-y-1">
                          {row.recipe_inputs.map((inp, iIdx) => (
                            <div key={iIdx} className="flex items-center gap-1">
                              <input
                                type="number"
                                value={inp.quantity}
                                onChange={(e) => updateRecipeInput(originalIdx, iIdx, 'quantity', e.target.value)}
                                className="w-10 px-1 py-0.5 border border-gray-300 rounded text-xs focus:ring-1 focus:ring-blue-500"
                                min="1"
                              />
                              <span className="text-gray-500">×</span>
                              <select
                                value={inp.commodity_slug}
                                onChange={(e) => updateRecipeInput(originalIdx, iIdx, 'commodity_slug', e.target.value)}
                                className="px-1 py-0.5 border border-gray-300 rounded text-xs focus:ring-1 focus:ring-blue-500 max-w-[100px]"
                              >
                                {commodities.filter(c => c.level < row.level).map(c => (
                                  <option key={c.slug} value={c.slug}>{c.name}</option>
                                ))}
                              </select>
                              <button
                                onClick={() => removeRecipeInput(originalIdx, iIdx)}
                                className="text-red-400 hover:text-red-600 text-xs px-1"
                                title="Remove input"
                              >✕</button>
                            </div>
                          ))}
                          {row.recipe_id && (
                            <button
                              onClick={() => addRecipeInput(originalIdx)}
                              className="text-blue-500 hover:text-blue-700 text-xs"
                            >+ Add input</button>
                          )}
                        </div>
                      ) : (
                        <span className="text-gray-300">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
      </>)}

      {/* ===== HAPPINESS TAB ===== */}
      {configTab === 'happiness' && (
      <>
      {/* Happiness Boosts Section */}
      <Card>
        <div className="flex items-center justify-between mb-4">
          <h2 className="card-title mb-0">Happiness Boosts</h2>
          <div className="flex gap-2">
            <button onClick={addBoost} className="btn btn-ghost btn-sm">+ Add Boost</button>
            <button onClick={handleSaveBoosts} disabled={boostsSaving} className="btn btn-primary btn-sm">
              {boostsSaving ? 'Saving...' : 'Save Boosts'}
            </button>
          </div>
        </div>
        {boostsSuccess && (
          <div className="alert alert-success mb-3">{boostsSuccess}</div>
        )}
        {boosts.length === 0 ? (
          <p className="text-gray-500 text-sm">No boosts configured. Click &quot;+ Add Boost&quot; to create one.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Icon</th>
                  <th>Slug</th>
                  <th>Name</th>
                  <th>Cost/Worker</th>
                  <th>Happiness +%</th>
                  <th>Cooldown (days)</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {boosts.map((boost, idx) => (
                  <tr key={idx} className={boost._dirty ? 'bg-yellow-50' : ''}>
                    <td>
                      <input
                        type="text"
                        value={boost.icon}
                        onChange={(e) => updateBoost(idx, 'icon', e.target.value)}
                        className="input input-sm w-14 text-center text-lg"
                      />
                    </td>
                    <td>
                      <input
                        type="text"
                        value={boost.slug}
                        onChange={(e) => updateBoost(idx, 'slug', e.target.value)}
                        className="input input-sm w-32"
                      />
                    </td>
                    <td>
                      <input
                        type="text"
                        value={boost.name}
                        onChange={(e) => updateBoost(idx, 'name', e.target.value)}
                        className="input input-sm w-40"
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        value={boost.costPerWorker}
                        onChange={(e) => updateBoost(idx, 'costPerWorker', e.target.value)}
                        className="input input-sm w-20"
                        min="0"
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        value={boost.happinessIncrease}
                        onChange={(e) => updateBoost(idx, 'happinessIncrease', e.target.value)}
                        className="input input-sm w-20"
                        min="1"
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        value={boost.cooldownDays}
                        onChange={(e) => updateBoost(idx, 'cooldownDays', e.target.value)}
                        className="input input-sm w-16"
                        min="0"
                      />
                    </td>
                    <td>
                      <button
                        onClick={() => removeBoost(idx)}
                        className="text-red-500 hover:text-red-700 text-sm"
                        title="Remove"
                      >✕</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      </>
      )}

      {/* ===== WORKERS TAB ===== */}
      {configTab === 'workers' && (
      <>
        {salarySuccess && <div className="alert alert-success">{salarySuccess}</div>}

        {/* Salary Rate Configuration */}
        <Card>
          <div className="flex items-center justify-between mb-4">
            <h2 className="card-title mb-0">Employee Salary by Specialty & Experience</h2>
            <button onClick={handleSaveSalaryConfig} disabled={salarySaving} className="btn btn-primary btn-sm">
              {salarySaving ? 'Saving...' : 'Save Salary Config'}
            </button>
          </div>

          {salaryConfig ? (
            <div className="space-y-4">
              <p className="text-xs text-gray-400">
                Each cell is the base daily salary (coins/day) for that specialty at that experience level. Employees are generated with ±10% variance.
              </p>
              <div className="overflow-x-auto">
                <table className="table">
                  <thead>
                    <tr>
                      <th></th>
                      <th>Specialty</th>
                      <th>Covers</th>
                      {salaryConfig.experienceLevels.map((lvl, i) => (
                        <th key={i} className="text-center">
                          <div className="text-xs">L{i + 1}</div>
                          <div className="text-[10px] text-gray-400 font-normal">{lvl}</div>
                        </th>
                      ))}
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {salaryConfig.specialties.map((spec, sIdx) => (
                      <tr key={spec.key}>
                        <td className="text-lg text-center">{spec.icon}</td>
                        <td>
                          <input
                            type="text"
                            value={spec.label}
                            onChange={(e) => {
                              const updated = [...salaryConfig.specialties];
                              updated[sIdx] = { ...updated[sIdx], label: e.target.value };
                              setSalaryConfig({ ...salaryConfig, specialties: updated });
                            }}
                            className="input input-sm w-28"
                          />
                        </td>
                        <td className="text-xs text-gray-500 max-w-[200px]">{spec.covers}</td>
                        {spec.baseSalary.map((sal, lIdx) => (
                          <td key={lIdx} className="text-center">
                            <input
                              type="number"
                              value={sal}
                              onChange={(e) => {
                                const updated = [...salaryConfig.specialties];
                                const newSalary = [...updated[sIdx].baseSalary];
                                newSalary[lIdx] = Number(e.target.value);
                                updated[sIdx] = { ...updated[sIdx], baseSalary: newSalary };
                                setSalaryConfig({ ...salaryConfig, specialties: updated });
                              }}
                              className="input input-sm w-14 text-center"
                              min="1"
                            />
                          </td>
                        ))}
                        <td>
                          <button
                            onClick={() => {
                              const updated = salaryConfig.specialties.filter((_, i) => i !== sIdx);
                              setSalaryConfig({ ...salaryConfig, specialties: updated });
                            }}
                            className="text-red-400 hover:text-red-600 text-sm"
                            title="Remove"
                          >✕</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <button
                onClick={() => setSalaryConfig({
                  ...salaryConfig,
                  specialties: [...salaryConfig.specialties, { key: 'new-specialty', icon: '👷', label: 'New Worker', covers: '', baseSalary: [10, 12, 15, 18, 22] }],
                })}
                className="btn btn-ghost btn-sm"
              >+ Add Specialty</button>
            </div>
          ) : (
            <p className="text-gray-500 text-sm">Loading salary configuration...</p>
          )}
        </Card>

        {/* Generate Workers */}
        <Card>
          <h2 className="card-title">Generate Employees</h2>
          <p className="text-sm text-gray-500 mb-4">
            Add random employees to the current season. Salaries will be calculated from the config above.
          </p>
          <div className="flex items-end gap-3">
            <div>
              <label className="label">Number of employees</label>
              <input
                type="number"
                value={generateCount}
                onChange={(e) => setGenerateCount(Math.max(1, Number(e.target.value)))}
                className="input w-32"
                min="1"
                max="5000"
              />
            </div>
            <button onClick={handleGenerateWorkers} disabled={generating} className="btn btn-primary btn-md">
              {generating ? 'Generating...' : '👷 Generate Employees'}
            </button>
          </div>
        </Card>
      </>
      )}
    </div>
  );
}
