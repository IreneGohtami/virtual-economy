'use client';

import React, { useState } from 'react';
import { Button, Card } from '@sea-commodity-tycoon/ui';
import { CommodityCategory } from '@sea-commodity-tycoon/shared-types';
import { api } from '@/lib/api-client';
import { useToast } from '@/lib/toast-context';
import { useWallet } from '@/lib/wallet-context';

interface ConstructFactoryFormProps {
  onSuccess: () => void;
  onCancel: () => void;
}

const CATEGORY_OPTIONS: { value: CommodityCategory; label: string; level: number; cost: number; tiles: string; description: string }[] = [
  // L0 - Raw Production
  { value: CommodityCategory.AGRICULTURE, label: 'Agriculture (L0)', level: 0, cost: 135, tiles: '3×3 Fertile Soil', description: 'Rice, Palm Fruit, Cocoa, Coffee' },
  { value: CommodityCategory.ENERGY, label: 'Energy (L0)', level: 0, cost: 225, tiles: '3×2 Mountain/Farmland', description: 'Crude Oil, Natural Gas' },
  { value: CommodityCategory.METAL, label: 'Metal (L0)', level: 0, cost: 225, tiles: '2×2 Mountain', description: 'Iron Ore, Nickel Ore' },
  { value: CommodityCategory.LIVESTOCK, label: 'Livestock (L0)', level: 0, cost: 180, tiles: '3×2 Farmland', description: 'Poultry, Cattle' },
  { value: CommodityCategory.FISHERY, label: 'Fishery (L0)', level: 0, cost: 180, tiles: '2×2 (2 Water + 2 Land)', description: 'Fish' },
  { value: CommodityCategory.FORESTRY, label: 'Forestry (L0)', level: 0, cost: 135, tiles: '3×3 Fertile Soil/Farmland', description: 'Timber, Rubber' },
  // L1 - Processing
  { value: CommodityCategory.AGRICULTURE, label: 'Agriculture Processing (L1)', level: 1, cost: 158, tiles: '2×2 Fertile Soil', description: 'Flour, Cooking Oil, Chocolate, Roasted Coffee' },
  { value: CommodityCategory.ENERGY, label: 'Energy Processing (L1)', level: 1, cost: 270, tiles: '3×2 Mountain/Farmland', description: 'Gasoline, Plastic, Biodiesel, Fertilizer' },
  { value: CommodityCategory.METAL, label: 'Metal Processing (L1)', level: 1, cost: 293, tiles: '2×2 Mountain', description: 'Steel, Battery' },
  { value: CommodityCategory.LIVESTOCK, label: 'Livestock Processing (L1)', level: 1, cost: 158, tiles: '2×2 Farmland', description: 'Chicken Meat, Eggs, Beef, Milk' },
  { value: CommodityCategory.FORESTRY, label: 'Forestry Processing (L1)', level: 1, cost: 180, tiles: '3×2 Fertile Soil/Farmland', description: 'Furniture, Tire' },
  // L2 - Assembly
  { value: CommodityCategory.ELECTRONICS, label: 'Electronics Assembly (L2)', level: 2, cost: 360, tiles: '3×2 Farmland/Mountain', description: 'Mobile Phone (Plastic + Battery)' },
  { value: CommodityCategory.AUTOMOTIVE, label: 'Automotive Assembly (L2)', level: 2, cost: 450, tiles: '3×3 Farmland/Mountain', description: 'Automobile (Steel + Tire + Battery)' },
];

export function ConstructFactoryForm({ onSuccess, onCancel }: ConstructFactoryFormProps) {
  const { addToast } = useToast();
  const { refreshWallet } = useWallet();
  const [step, setStep] = useState<'category' | 'tiles' | 'confirm'>('category');
  const [levelFilter, setLevelFilter] = useState(0);
  const [selectedLevel, setSelectedLevel] = useState(0);
  const [selectedCategory, setSelectedCategory] = useState<CommodityCategory | null>(null);
  const [tileIdsInput, setTileIdsInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedOption = CATEGORY_OPTIONS.find((o) => o.value === selectedCategory && o.level === selectedLevel);

  async function handleSubmit() {
    if (!selectedCategory) return;

    const tileIds = tileIdsInput
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean);

    if (tileIds.length === 0) {
      setError('Please enter tile IDs for factory placement.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      await api.post('/factories', {
        tileIds,
        category: selectedCategory,
        level: selectedLevel,
      });
      addToast(`Factory constructed (${selectedOption?.label})`, 'success');
      refreshWallet();
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Construction failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card padding="lg">
      <h2 className="text-lg font-bold text-gray-900 mb-4">Construct New Factory</h2>

      {error && (
        <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm" role="alert">
          {error}
        </div>
      )}

      {/* Step 1: Select Category */}
      {step === 'category' && (
        <div className="space-y-3">
          <p className="text-sm text-gray-600">Select a factory type to build:</p>

          {/* Level filter */}
          <div className="flex gap-2 mb-2">
            {[
              { level: 0, label: 'L0 Raw', color: 'bg-green-100 text-green-700' },
              { level: 1, label: 'L1 Processing', color: 'bg-blue-100 text-blue-700' },
              { level: 2, label: 'L2 Assembly', color: 'bg-purple-100 text-purple-700' },
            ].map((lvl) => (
              <button
                key={lvl.level}
                type="button"
                onClick={() => setLevelFilter(lvl.level)}
                className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                  levelFilter === lvl.level ? lvl.color + ' ring-1 ring-current' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                }`}
              >
                {lvl.label}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {CATEGORY_OPTIONS.filter(opt => opt.level === levelFilter).map((opt) => (
              <button
                key={`${opt.value}-${opt.level}`}
                type="button"
                onClick={() => { setSelectedCategory(opt.value); setSelectedLevel(opt.level); }}
                className={`text-left p-3 rounded-lg border transition-colors ${
                  selectedCategory === opt.value && selectedLevel === opt.level
                    ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-500'
                    : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <p className="text-sm font-medium text-gray-900">{opt.label}</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  {opt.cost} coins &bull; {opt.tiles}
                </p>
                <p className="text-xs text-gray-400 mt-0.5">{opt.description}</p>
              </button>
            ))}
          </div>
          <div className="flex gap-3 justify-end pt-2">
            <Button variant="ghost" size="sm" onClick={onCancel}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => setStep('tiles')}
              disabled={!selectedCategory}
            >
              Next: Select Tiles
            </Button>
          </div>
        </div>
      )}

      {/* Step 2: Enter Tiles */}
      {step === 'tiles' && selectedOption && (
        <div className="space-y-3">
          <div className="p-3 bg-blue-50 rounded-lg text-sm">
            <p className="font-medium text-blue-900">{selectedOption.label} Factory</p>
            <p className="text-blue-700 text-xs mt-0.5">
              Requires: {selectedOption.tiles} &bull; Cost: {selectedOption.cost} coins
            </p>
          </div>
          <div>
            <label htmlFor="tile-ids" className="block text-sm font-medium text-gray-700 mb-1">
              Tile IDs (comma-separated)
            </label>
            <input
              id="tile-ids"
              type="text"
              value={tileIdsInput}
              onChange={(e) => setTileIdsInput(e.target.value)}
              placeholder="tile-1, tile-2, tile-3, ..."
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
            />
            <p className="text-xs text-gray-400 mt-1">
              Enter the IDs of owned tiles that match the required terrain.
              Select tiles from the map view first.
            </p>
          </div>
          <div className="flex gap-3 justify-end pt-2">
            <Button variant="ghost" size="sm" onClick={() => setStep('category')}>
              Back
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => setStep('confirm')}
              disabled={!tileIdsInput.trim()}
            >
              Next: Confirm
            </Button>
          </div>
        </div>
      )}

      {/* Step 3: Confirm */}
      {step === 'confirm' && selectedOption && (
        <div className="space-y-3">
          <p className="text-sm text-gray-600">Review and confirm factory construction:</p>
          <div className="p-4 bg-gray-50 rounded-lg space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-500">Category</span>
              <span className="font-medium text-gray-900">{selectedOption.label}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Level</span>
              <span className="font-medium text-gray-900">L{selectedOption.level}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Setup Cost</span>
              <span className="font-medium text-gray-900">{selectedOption.cost} coins</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Required Terrain</span>
              <span className="font-medium text-gray-900">{selectedOption.tiles}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Tiles</span>
              <span className="font-medium text-gray-900 text-right max-w-[200px] truncate">
                {tileIdsInput}
              </span>
            </div>
          </div>
          <div className="flex gap-3 justify-end pt-2">
            <Button variant="ghost" size="sm" onClick={() => setStep('tiles')}>
              Back
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={handleSubmit}
              loading={loading}
            >
              Build Factory ({selectedOption.cost} coins)
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
