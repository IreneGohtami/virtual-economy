'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { Button, Card, Modal, Panel } from '@sea-commodity-tycoon/ui';
import { FactoryStatus, CommodityCategory } from '@sea-commodity-tycoon/shared-types';
import { api } from '@/lib/api-client';

export interface FactoryDetailData {
  id: string;
  name: string;
  category: CommodityCategory;
  factoryLevel: number;
  isShop: boolean;
  status: FactoryStatus;
  efficiency: number;
  maintenanceCount: number;
  setupCost: number;
  exclusiveOutputSlug: string | null;
  outputSwitchCooldownUntil: string | null;
  fertilizerBoostActive: boolean;
  fertilizerBoostExpiresAt: string | null;
  constructedAt: string;
  tileIds?: string[];
  workerAssignments?: { id: string; workerId: string; status: string; name: string | null; specialty: string | null }[];
  recipeInputs?: { commodityId: string; commodityName: string; commoditySlug: string; quantityRequired: number; quantityInInventory: number }[];
  shopAcceptedGoods?: { commodityId: string; commodityName: string; commoditySlug: string; quantityInInventory: number }[];
}

function getMaxEfficiency(maintenanceCount: number): number {
  return Math.max(50, 100 - maintenanceCount * 5);
}

/** Maps worker specialty to the factory category it benefits */
const SPECIALTY_TO_CATEGORY: Record<string, string> = {
  farmer: 'AGRICULTURE',
  miner: 'METAL',
  fisherman: 'FISHERY',
  driller: 'ENERGY',
  rancher: 'LIVESTOCK',
  lumberjack: 'FORESTRY',
  shopkeeper: 'SHOP',
};

function isSpecialtyMatch(workerSpecialty: string | null, factoryCategory: string, isShop?: boolean, factoryLevel?: number): boolean {
  if (!workerSpecialty) return false;
  if (isShop && workerSpecialty === 'shopkeeper') return true;
  if (factoryLevel === 0 || factoryLevel === undefined) return SPECIALTY_TO_CATEGORY[workerSpecialty] === factoryCategory;
  if (factoryLevel === 1) {
    if (['ENERGY', 'METAL', 'FORESTRY'].includes(factoryCategory)) return workerSpecialty === 'engineer';
    return SPECIALTY_TO_CATEGORY[workerSpecialty] === factoryCategory;
  }
  if (factoryLevel === 2) return workerSpecialty === 'technician';
  return false;
}

function getDeconstructionFee(setupCost: number): number {
  return Math.round(setupCost * 0.25);
}

function getMaintenanceCost(setupCost: number): number {
  return Math.round(setupCost * 0.15);
}

function formatCooldown(cooldownUntil: string | null): string | null {
  if (!cooldownUntil) return null;
  const remaining = new Date(cooldownUntil).getTime() - Date.now();
  if (remaining <= 0) return null;
  const hours = Math.floor(remaining / (1000 * 60 * 60));
  const minutes = Math.floor((remaining % (1000 * 60 * 60)) / (1000 * 60));
  return `${hours}h ${minutes}m`;
}

const LIVESTOCK_FISHERY_OUTPUTS: Record<string, string[]> = {
  LIVESTOCK: ['chicken-meat', 'eggs', 'beef', 'milk'],
  FISHERY: ['fish', 'frozen-fish'],
};

interface FactoryDetailProps {
  factory: FactoryDetailData;
  onRefresh: () => void;
}

export function FactoryDetail({ factory, onRefresh }: FactoryDetailProps) {
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showDeconstructModal, setShowDeconstructModal] = useState(false);
  const [showSwitchOutputModal, setShowSwitchOutputModal] = useState(false);
  const [selectedOutput, setSelectedOutput] = useState('');
  const [editingName, setEditingName] = useState(false);
  const [newName, setNewName] = useState(factory.name);

  const maxEfficiency = getMaxEfficiency(factory.maintenanceCount);
  const deconstructionFee = getDeconstructionFee(factory.setupCost);
  const maintenanceCost = getMaintenanceCost(factory.setupCost);
  const cooldownRemaining = formatCooldown(factory.outputSwitchCooldownUntil);
  const isLivestockOrFishery =
    factory.category === CommodityCategory.LIVESTOCK;

  async function handleMaintenance() {
    setLoading('maintenance');
    setError(null);
    try {
      await api.post(`/factories/${factory.id}/maintenance`);
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Maintenance failed');
    } finally {
      setLoading(null);
    }
  }

  async function handleFertilizer() {
    setLoading('fertilizer');
    setError(null);
    try {
      await api.post(`/factories/${factory.id}/fertilizer`);
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fertilizer application failed');
    } finally {
      setLoading(null);
    }
  }

  async function handleDeconstruct() {
    setLoading('deconstruct');
    setError(null);
    try {
      await api.delete(`/factories/${factory.id}`);
      setShowDeconstructModal(false);
      // Navigate back to factory list
      window.location.href = '/factories';
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Deconstruction failed');
    } finally {
      setLoading(null);
    }
  }

  async function handleSwitchOutput() {
    if (!selectedOutput) return;
    setLoading('switch');
    setError(null);
    try {
      await api.post(`/factories/${factory.id}/switch-output`, {
        outputSlug: selectedOutput,
      });
      setShowSwitchOutputModal(false);
      setSelectedOutput('');
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Output switch failed');
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm" role="alert">
          {error}
        </div>
      )}

      {/* Factory Info Header */}
      <Card padding="lg">
        <div className="flex items-start justify-between">
          <div>
            {editingName ? (
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="text-xl font-bold text-gray-900 border border-gray-300 rounded px-2 py-0.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  maxLength={100}
                  aria-label="Factory name"
                />
                <button
                  onClick={async () => {
                    if (!newName.trim()) return;
                    setLoading('rename');
                    try {
                      await api.put(`/factories/${factory.id}/name`, { name: newName.trim() });
                      setEditingName(false);
                      onRefresh();
                    } catch (err) {
                      setError(err instanceof Error ? err.message : 'Rename failed');
                    } finally {
                      setLoading(null);
                    }
                  }}
                  disabled={loading === 'rename'}
                  className="text-sm text-blue-600 hover:text-blue-800 font-medium"
                >
                  Save
                </button>
                <button
                  onClick={() => { setEditingName(false); setNewName(factory.name); }}
                  className="text-sm text-gray-500 hover:text-gray-700"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-bold text-gray-900">{factory.name}</h2>
                <button
                  onClick={() => setEditingName(true)}
                  className="text-xs text-blue-600 hover:text-blue-800 underline"
                  aria-label="Edit factory name"
                >
                  Edit
                </button>
              </div>
            )}
            <p className="text-sm text-gray-500 mt-1">
              {factory.isShop ? '🏪 Shop' : `${factory.category.replace('_', ' ')} · Level ${factory.factoryLevel}`} · Built{' '}
              {new Date(factory.constructedAt).toLocaleDateString()}
            </p>
          </div>
          <span
            className={`px-3 py-1 text-sm font-medium rounded-full ${
              factory.isShop
                ? (factory.status === FactoryStatus.PRODUCING && factory.shopAcceptedGoods?.some(g => g.quantityInInventory > 0))
                  ? 'bg-green-100 text-green-700'
                  : factory.status === FactoryStatus.PRODUCING
                  ? 'bg-yellow-100 text-yellow-700'
                  : 'bg-red-100 text-red-700'
                : factory.status === FactoryStatus.PRODUCING
                ? 'bg-green-100 text-green-700'
                : factory.status === FactoryStatus.PAUSED
                ? 'bg-yellow-100 text-yellow-700'
                : 'bg-red-100 text-red-700'
            }`}
          >
            {factory.isShop
              ? (factory.status === FactoryStatus.PRODUCING
                ? (factory.shopAcceptedGoods && factory.shopAcceptedGoods.some(g => g.quantityInInventory > 0) ? 'SELLING' : 'NO STOCK')
                : 'CLOSED')
              : factory.status}
          </span>
        </div>
      </Card>

      {/* Shop Accepted Goods */}
      {factory.isShop && factory.shopAcceptedGoods && factory.shopAcceptedGoods.length > 0 && (
        <Panel title="Goods for Sale">
          <div className="space-y-2">
            <p className="text-xs text-gray-500 mb-2">
              Stock these goods in the shop to generate revenue from customers:
            </p>
            {factory.shopAcceptedGoods.map((good) => (
              <div
                key={good.commodityId}
                className={`flex items-center justify-between p-2 rounded-lg border ${
                  good.quantityInInventory > 0 ? 'border-green-200 bg-green-50' : 'border-gray-200 bg-gray-50'
                }`}
              >
                <p className="text-sm font-medium text-gray-900">{good.commodityName}</p>
                <p className={`text-sm font-bold ${good.quantityInInventory > 0 ? 'text-green-700' : 'text-gray-400'}`}>
                  {good.quantityInInventory > 0 ? `${good.quantityInInventory} in stock` : 'None'}
                </p>
              </div>
            ))}
          </div>
        </Panel>
      )}

      {/* Efficiency & Stats (not for shops) */}
      {!factory.isShop && (
      <Panel title="Efficiency & Maintenance">
        <div className="space-y-4">
          <div>
            <div className="flex justify-between text-sm mb-1">
              <span className="text-gray-600">Current Efficiency</span>
              <span className="font-medium">{factory.efficiency}% / {maxEfficiency}% max</span>
            </div>
            <div className="h-3 bg-gray-200 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${
                  factory.efficiency > 70 ? 'bg-green-500' :
                  factory.efficiency > 50 ? 'bg-yellow-500' : 'bg-red-500'
                }`}
                style={{ width: `${(factory.efficiency / 100) * 100}%` }}
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4 text-sm">
            <div>
              <span className="text-gray-500">Maintenance Count</span>
              <p className="text-lg font-semibold text-gray-900">{factory.maintenanceCount}</p>
            </div>
            <div>
              <span className="text-gray-500">Maintenance Cost</span>
              <p className="text-lg font-semibold text-gray-900">{maintenanceCost} coins</p>
            </div>
            <div>
              <span className="text-gray-500">Max Efficiency</span>
              <p className="text-lg font-semibold text-gray-900">{maxEfficiency}%</p>
            </div>
          </div>

          <Button
            variant="secondary"
            size="sm"
            onClick={handleMaintenance}
            loading={loading === 'maintenance'}
            disabled={factory.efficiency >= maxEfficiency}
          >
            Perform Maintenance ({maintenanceCost} coins)
          </Button>
        </div>
      </Panel>
      )}

      {/* Required Materials (L1/L2 only) */}
      {factory.recipeInputs && factory.recipeInputs.length > 0 && (
        <Panel title="Required Materials">
          <div className="space-y-2">
            <p className="text-xs text-gray-500 mb-2">
              Materials consumed per production cycle:
            </p>
            {factory.recipeInputs.map((input) => {
              const hasEnough = input.quantityInInventory >= input.quantityRequired;
              return (
                <div
                  key={input.commodityId}
                  className={`flex items-center justify-between p-2 rounded-lg border ${
                    hasEnough ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'
                  }`}
                >
                  <div>
                    <p className="text-sm font-medium text-gray-900">{input.commodityName}</p>
                    <p className="text-xs text-gray-500">Need: {input.quantityRequired} per cycle</p>
                  </div>
                  <div className="text-right">
                    <p className={`text-sm font-bold ${hasEnough ? 'text-green-700' : 'text-red-600'}`}>
                      {input.quantityInInventory} in stock
                    </p>
                    {!hasEnough && (
                      <p className="text-[10px] text-red-500">
                        Need {input.quantityRequired - input.quantityInInventory} more
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </Panel>
      )}

      {/* Workers */}
      <Panel title="Employee Slots">
        <div className="space-y-2">
          {factory.workerAssignments && factory.workerAssignments.length > 0 ? (
            factory.workerAssignments.map((wa) => (
              <div
                key={wa.id}
                className="flex items-center justify-between p-2 bg-gray-50 rounded-lg"
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-gray-900">{wa.name ?? 'Worker'}</span>
                  {wa.specialty && (
                    <span className="text-xs text-gray-500">{wa.specialty}</span>
                  )}
                  {isSpecialtyMatch(wa.specialty, factory.category, factory.isShop, factory.factoryLevel) && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-100 text-green-700 font-medium">
                      ✓ Match
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full">
                    {wa.status}
                  </span>
                  <button
                    onClick={async () => {
                      try {
                        await api.post(`/workers/${wa.workerId}/unassign`);
                        onRefresh();
                      } catch (err) {
                        setError(err instanceof Error ? err.message : 'Failed to unassign');
                      }
                    }}
                    className="text-[10px] text-gray-400 hover:text-red-600 underline"
                  >
                    Unassign
                  </button>
                </div>
              </div>
            ))
          ) : (
            <p className="text-sm text-gray-500">No employees assigned. Hire employees to begin production.</p>
          )}
          <p className="text-xs text-gray-400 mt-2">
            Max 2 employees per factory. L2 factories require 2 employees.
          </p>
          {(!factory.workerAssignments || factory.workerAssignments.length < 2) && (
            <Link
              href="/workers"
              className="inline-flex items-center gap-2 mt-2 px-4 py-2 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors"
            >
              👷 Hire Employee
            </Link>
          )}
        </div>
      </Panel>

      {/* Fertilizer (not applicable to shops) */}
      {!factory.isShop && (factory.category === CommodityCategory.AGRICULTURE ||
        factory.category === CommodityCategory.FORESTRY) && (
        <Panel title="Fertilizer Boost">
          <div className="space-y-3">
            {factory.fertilizerBoostActive ? (
              <div className="flex items-center gap-2 text-sm text-green-700">
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                <span>
                  Fertilizer active
                  {factory.fertilizerBoostExpiresAt && (
                    <> — expires {new Date(factory.fertilizerBoostExpiresAt).toLocaleString()}</>
                  )}
                </span>
              </div>
            ) : (
              <p className="text-sm text-gray-500">
                {factory.category === CommodityCategory.AGRICULTURE
                  ? 'Apply 4 units of fertilizer for a 15% yield bonus (5 days).'
                  : 'Apply 6 units of fertilizer for a 12% yield bonus (5 days).'}
              </p>
            )}
            <Button
              variant="secondary"
              size="sm"
              onClick={handleFertilizer}
              loading={loading === 'fertilizer'}
              disabled={factory.fertilizerBoostActive}
            >
              Apply Fertilizer
            </Button>
          </div>
        </Panel>
      )}

      {/* Output Switching (Livestock/Fishery only, not shops) */}
      {!factory.isShop && isLivestockOrFishery && (
        <Panel title="Exclusive Output">
          <div className="space-y-3">
            <div className="text-sm">
              <span className="text-gray-500">Current Output: </span>
              <span className="font-medium text-gray-900">
                {factory.exclusiveOutputSlug || 'Not selected'}
              </span>
            </div>
            {cooldownRemaining && (
              <div className="flex items-center gap-2 text-sm text-yellow-600">
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd" />
                </svg>
                Cooldown: {cooldownRemaining} remaining
              </div>
            )}
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setShowSwitchOutputModal(true)}
              disabled={factory.status !== FactoryStatus.IDLE || !!cooldownRemaining}
            >
              Switch Output
            </Button>
          </div>
        </Panel>
      )}

      {/* Deconstruct */}
      <Panel title="Danger Zone">
        <div className="space-y-2">
          <p className="text-sm text-gray-500">
            Deconstructing this {factory.isShop ? 'shop' : 'factory'} will release the tiles and charge a{' '}
            <span className="font-medium">25% deconstruction fee ({deconstructionFee} coins)</span>.
            This action cannot be undone.
          </p>
          <Button
            variant="danger"
            size="sm"
            onClick={() => setShowDeconstructModal(true)}
            disabled={factory.status !== FactoryStatus.IDLE}
          >
            Deconstruct {factory.isShop ? 'Shop' : 'Factory'}
          </Button>
          {factory.status !== FactoryStatus.IDLE && (
            <p className="text-xs text-gray-400">{factory.isShop ? 'Shop' : 'Factory'} must be IDLE to deconstruct.</p>
          )}
        </div>
      </Panel>

      {/* Deconstruct Confirmation Modal */}
      <Modal
        open={showDeconstructModal}
        onClose={() => setShowDeconstructModal(false)}
        title="Confirm Deconstruction"
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-700">
            Are you sure you want to deconstruct this{' '}
            <span className="font-medium">{factory.name}</span> {factory.isShop ? 'shop' : 'factory'}?
          </p>
          <div className="p-3 bg-red-50 rounded-lg text-sm">
            <p className="font-medium text-red-800">Deconstruction Fee</p>
            <p className="text-red-700 text-lg font-bold">{deconstructionFee} coins</p>
            <p className="text-red-600 text-xs mt-1">(25% of {factory.setupCost} setup cost)</p>
          </div>
          <div className="flex gap-3 justify-end">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowDeconstructModal(false)}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={handleDeconstruct}
              loading={loading === 'deconstruct'}
            >
              Confirm Deconstruction
            </Button>
          </div>
        </div>
      </Modal>

      {/* Switch Output Modal */}
      <Modal
        open={showSwitchOutputModal}
        onClose={() => setShowSwitchOutputModal(false)}
        title="Switch Output"
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-700">
            Select a new exclusive output for this factory. A 72-hour cooldown will apply after switching.
          </p>
          <div className="space-y-2">
            {(LIVESTOCK_FISHERY_OUTPUTS[factory.category] || []).map((output) => (
              <label
                key={output}
                className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                  selectedOutput === output
                    ? 'border-blue-500 bg-blue-50'
                    : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <input
                  type="radio"
                  name="output"
                  value={output}
                  checked={selectedOutput === output}
                  onChange={(e) => setSelectedOutput(e.target.value)}
                  className="text-blue-600"
                />
                <span className="text-sm font-medium text-gray-900">{output}</span>
              </label>
            ))}
          </div>
          <div className="flex gap-3 justify-end">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setShowSwitchOutputModal(false);
                setSelectedOutput('');
              }}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={handleSwitchOutput}
              loading={loading === 'switch'}
              disabled={!selectedOutput}
            >
              Switch Output
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
