'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { Button, Card, Loader } from '@sea-commodity-tycoon/ui';
import { TerrainType, CommodityCategory } from '@sea-commodity-tycoon/shared-types';
import Link from 'next/link';
import { api } from '@/lib/api-client';
import { useToast } from '@/lib/toast-context';
import { useWallet } from '@/lib/wallet-context';
import { useOnboarding } from '@/lib/onboarding-context';
import { useAuth } from '@/app/providers';
import { FactoryCard, FactoryCardData } from './components/FactoryCard';

interface OwnedTile {
  id: string;
  x: number;
  y: number;
  terrainType: TerrainType;
  ownerPlayerId: string | null;
  factoryId: string | null;
}

interface CommodityOption {
  slug: string;
  name: string;
  icon: string;
  category: CommodityCategory;
  cost: number;
  layout: string;
  width: number;
  height: number;
  allowedTerrains: TerrainType[];
  level: number;
  type: 'factory' | 'shop';
  requires?: string;
}

type BuildTab = 'L0' | 'L1' | 'L2' | 'Shop';

const BUILD_OPTIONS: Record<BuildTab, CommodityOption[]> = {
  L0: [
    { slug: 'rice', name: 'Rice Farm', icon: '🌾', category: CommodityCategory.AGRICULTURE, cost: 300, layout: '3×3', width: 3, height: 3, allowedTerrains: [TerrainType.FERTILE_SOIL], level: 0, type: 'factory' },
    { slug: 'palm-fruit', name: 'Palm Plantation', icon: '🌴', category: CommodityCategory.AGRICULTURE, cost: 300, layout: '3×3', width: 3, height: 3, allowedTerrains: [TerrainType.FERTILE_SOIL], level: 0, type: 'factory' },
    { slug: 'cocoa', name: 'Cocoa Farm', icon: '🍫', category: CommodityCategory.AGRICULTURE, cost: 300, layout: '3×3', width: 3, height: 3, allowedTerrains: [TerrainType.FERTILE_SOIL], level: 0, type: 'factory' },
    { slug: 'coffee', name: 'Coffee Estate', icon: '☕', category: CommodityCategory.AGRICULTURE, cost: 300, layout: '3×3', width: 3, height: 3, allowedTerrains: [TerrainType.FERTILE_SOIL], level: 0, type: 'factory' },
    { slug: 'crude-oil', name: 'Oil Well', icon: '🛢️', category: CommodityCategory.ENERGY, cost: 500, layout: '3×2', width: 3, height: 2, allowedTerrains: [TerrainType.MOUNTAIN, TerrainType.FARMLAND], level: 0, type: 'factory' },
    { slug: 'natural-gas', name: 'Gas Extraction', icon: '🔥', category: CommodityCategory.ENERGY, cost: 500, layout: '3×2', width: 3, height: 2, allowedTerrains: [TerrainType.MOUNTAIN, TerrainType.FARMLAND], level: 0, type: 'factory' },
    { slug: 'iron-ore', name: 'Iron Mine', icon: '⛏️', category: CommodityCategory.METAL, cost: 500, layout: '2×2', width: 2, height: 2, allowedTerrains: [TerrainType.MOUNTAIN], level: 0, type: 'factory' },
    { slug: 'nickel-ore', name: 'Nickel Mine', icon: '🪨', category: CommodityCategory.METAL, cost: 500, layout: '2×2', width: 2, height: 2, allowedTerrains: [TerrainType.MOUNTAIN], level: 0, type: 'factory' },
    { slug: 'poultry', name: 'Poultry Farm', icon: '🐔', category: CommodityCategory.LIVESTOCK, cost: 400, layout: '3×2', width: 3, height: 2, allowedTerrains: [TerrainType.FARMLAND], level: 0, type: 'factory' },
    { slug: 'cattle', name: 'Cattle Ranch', icon: '🐄', category: CommodityCategory.LIVESTOCK, cost: 400, layout: '3×2', width: 3, height: 2, allowedTerrains: [TerrainType.FARMLAND], level: 0, type: 'factory' },
    { slug: 'fish', name: 'Fishery', icon: '🐟', category: CommodityCategory.FISHERY, cost: 400, layout: '2×2', width: 2, height: 2, allowedTerrains: [TerrainType.WATER_TERRAIN, TerrainType.FERTILE_SOIL, TerrainType.FARMLAND, TerrainType.MOUNTAIN], level: 0, type: 'factory' },
    { slug: 'timber', name: 'Timber Mill', icon: '🪵', category: CommodityCategory.FORESTRY, cost: 300, layout: '3×3', width: 3, height: 3, allowedTerrains: [TerrainType.FERTILE_SOIL, TerrainType.FARMLAND], level: 0, type: 'factory' },
    { slug: 'rubber', name: 'Rubber Plantation', icon: '🌳', category: CommodityCategory.FORESTRY, cost: 300, layout: '3×3', width: 3, height: 3, allowedTerrains: [TerrainType.FERTILE_SOIL, TerrainType.FARMLAND], level: 0, type: 'factory' },
  ],
  L1: [
    { slug: 'flour', name: 'Flour Mill', icon: '🫓', category: CommodityCategory.AGRICULTURE, cost: 350, layout: '2×2', width: 2, height: 2, allowedTerrains: [TerrainType.FERTILE_SOIL], level: 1, type: 'factory', requires: 'Rice → Flour' },
    { slug: 'cooking-oil', name: 'Oil Press', icon: '🫒', category: CommodityCategory.AGRICULTURE, cost: 350, layout: '2×2', width: 2, height: 2, allowedTerrains: [TerrainType.FERTILE_SOIL], level: 1, type: 'factory', requires: 'Palm Fruit → Cooking Oil' },
    { slug: 'biodiesel', name: 'Biodiesel Refinery', icon: '⛽', category: CommodityCategory.ENERGY, cost: 600, layout: '3×2', width: 3, height: 2, allowedTerrains: [TerrainType.MOUNTAIN, TerrainType.FARMLAND], level: 1, type: 'factory', requires: 'Palm Fruit → Biodiesel' },
    { slug: 'chocolate', name: 'Chocolate Factory', icon: '🍫', category: CommodityCategory.AGRICULTURE, cost: 350, layout: '2×2', width: 2, height: 2, allowedTerrains: [TerrainType.FERTILE_SOIL], level: 1, type: 'factory', requires: 'Cocoa → Chocolate' },
    { slug: 'roasted-coffee', name: 'Coffee Roastery', icon: '☕', category: CommodityCategory.AGRICULTURE, cost: 350, layout: '2×2', width: 2, height: 2, allowedTerrains: [TerrainType.FERTILE_SOIL], level: 1, type: 'factory', requires: 'Coffee → Roasted Coffee' },
    { slug: 'gasoline', name: 'Oil Refinery', icon: '⛽', category: CommodityCategory.ENERGY, cost: 600, layout: '3×2', width: 3, height: 2, allowedTerrains: [TerrainType.MOUNTAIN, TerrainType.FARMLAND], level: 1, type: 'factory', requires: 'Crude Oil → Gasoline' },
    { slug: 'plastic', name: 'Plastics Plant', icon: '🧱', category: CommodityCategory.ENERGY, cost: 600, layout: '3×2', width: 3, height: 2, allowedTerrains: [TerrainType.MOUNTAIN, TerrainType.FARMLAND], level: 1, type: 'factory', requires: 'Crude Oil → Plastic' },
    { slug: 'fertilizer', name: 'Fertilizer Plant', icon: '🧪', category: CommodityCategory.ENERGY, cost: 600, layout: '3×2', width: 3, height: 2, allowedTerrains: [TerrainType.MOUNTAIN, TerrainType.FARMLAND], level: 1, type: 'factory', requires: 'Natural Gas → Fertilizer' },
    { slug: 'steel', name: 'Steel Mill', icon: '🔩', category: CommodityCategory.METAL, cost: 650, layout: '2×2', width: 2, height: 2, allowedTerrains: [TerrainType.MOUNTAIN], level: 1, type: 'factory', requires: 'Iron Ore → Steel' },
    { slug: 'battery', name: 'Battery Factory', icon: '🔋', category: CommodityCategory.METAL, cost: 650, layout: '2×2', width: 2, height: 2, allowedTerrains: [TerrainType.MOUNTAIN], level: 1, type: 'factory', requires: 'Nickel Ore → Battery' },
    { slug: 'chicken-meat', name: 'Poultry Processing', icon: '🍗', category: CommodityCategory.LIVESTOCK, cost: 350, layout: '2×2', width: 2, height: 2, allowedTerrains: [TerrainType.FARMLAND], level: 1, type: 'factory', requires: 'Poultry → Chicken Meat' },
    { slug: 'eggs', name: 'Egg Collector', icon: '🥚', category: CommodityCategory.LIVESTOCK, cost: 350, layout: '2×2', width: 2, height: 2, allowedTerrains: [TerrainType.FARMLAND], level: 1, type: 'factory', requires: 'Poultry → Eggs' },
    { slug: 'beef', name: 'Cattle Slaughterhouse', icon: '🥩', category: CommodityCategory.LIVESTOCK, cost: 350, layout: '2×2', width: 2, height: 2, allowedTerrains: [TerrainType.FARMLAND], level: 1, type: 'factory', requires: 'Cattle → Beef' },
    { slug: 'milk', name: 'Dairy Farm', icon: '🥛', category: CommodityCategory.LIVESTOCK, cost: 350, layout: '2×2', width: 2, height: 2, allowedTerrains: [TerrainType.FARMLAND], level: 1, type: 'factory', requires: 'Cattle → Milk' },
    { slug: 'furniture', name: 'Furniture Workshop', icon: '🪑', category: CommodityCategory.FORESTRY, cost: 400, layout: '3×2', width: 3, height: 2, allowedTerrains: [TerrainType.FERTILE_SOIL, TerrainType.FARMLAND], level: 1, type: 'factory', requires: 'Timber → Furniture' },
    { slug: 'tire', name: 'Tire Factory', icon: '🛞', category: CommodityCategory.FORESTRY, cost: 400, layout: '3×2', width: 3, height: 2, allowedTerrains: [TerrainType.FERTILE_SOIL, TerrainType.FARMLAND], level: 1, type: 'factory', requires: 'Rubber → Tire' },
    { slug: 'frozen-fish', name: 'Fish Freezer', icon: '🧊', category: CommodityCategory.FISHERY, cost: 350, layout: '2×2', width: 2, height: 2, allowedTerrains: [TerrainType.FARMLAND, TerrainType.FERTILE_SOIL], level: 1, type: 'factory', requires: 'Fish → Frozen Fish' },
  ],
  L2: [
    { slug: 'mobile-phone', name: 'Phone Assembly', icon: '📱', category: CommodityCategory.ELECTRONICS, cost: 800, layout: '3×2', width: 3, height: 2, allowedTerrains: [TerrainType.FARMLAND, TerrainType.MOUNTAIN], level: 2, type: 'factory', requires: 'Plastic + Battery → Mobile Phone' },
    { slug: 'automobile', name: 'Car Assembly', icon: '🚗', category: CommodityCategory.AUTOMOTIVE, cost: 1000, layout: '3×3', width: 3, height: 3, allowedTerrains: [TerrainType.FARMLAND, TerrainType.MOUNTAIN], level: 2, type: 'factory', requires: 'Steel + Tire + Battery → Automobile' },
  ],
  Shop: [
    { slug: 'supermarket', name: 'Supermarket', icon: '🏪', category: CommodityCategory.AGRICULTURE, cost: 500, layout: '1×1', width: 1, height: 1, allowedTerrains: [TerrainType.CITY], level: 0, type: 'shop', requires: 'Sells: Flour, Cooking Oil, Eggs, Milk, Chocolate' },
    { slug: 'butcher', name: 'Butcher', icon: '🥩', category: CommodityCategory.LIVESTOCK, cost: 350, layout: '1×1', width: 1, height: 1, allowedTerrains: [TerrainType.CITY], level: 0, type: 'shop', requires: 'Sells: Chicken Meat, Beef, Fish' },
    { slug: 'cafe', name: 'Cafe', icon: '☕', category: CommodityCategory.AGRICULTURE, cost: 400, layout: '1×1', width: 1, height: 1, allowedTerrains: [TerrainType.CITY], level: 0, type: 'shop', requires: 'Sells: Roasted Coffee' },
    { slug: 'petrol-station', name: 'Petrol Station', icon: '⛽', category: CommodityCategory.ENERGY, cost: 600, layout: '1×1', width: 1, height: 1, allowedTerrains: [TerrainType.CITY], level: 0, type: 'shop', requires: 'Sells: Gasoline, Biodiesel' },
    { slug: 'furniture-shop', name: 'Furniture Shop', icon: '🛋️', category: CommodityCategory.FORESTRY, cost: 450, layout: '1×1', width: 1, height: 1, allowedTerrains: [TerrainType.CITY], level: 0, type: 'shop', requires: 'Sells: Furniture' },
    { slug: 'electronics-shop', name: 'Electronics Shop', icon: '🏬', category: CommodityCategory.ELECTRONICS, cost: 800, layout: '1×1', width: 1, height: 1, allowedTerrains: [TerrainType.CITY], level: 0, type: 'shop', requires: 'Sells: Mobile Phone' },
    { slug: 'car-store', name: 'Car Store', icon: '🏎️', category: CommodityCategory.AUTOMOTIVE, cost: 1000, layout: '1×1', width: 1, height: 1, allowedTerrains: [TerrainType.CITY], level: 0, type: 'shop', requires: 'Sells: Automobile' },
  ],
};

const TERRAIN_COLORS: Record<TerrainType, string> = {
  [TerrainType.WATER_TERRAIN]: '#3B82F6',
  [TerrainType.FERTILE_SOIL]: '#166534',
  [TerrainType.FARMLAND]: '#4ADE80',
  [TerrainType.MOUNTAIN]: '#78716C',
  [TerrainType.CITY]: '#F59E0B',
};

const TERRAIN_LABELS: Record<TerrainType, string> = {
  [TerrainType.WATER_TERRAIN]: 'Water',
  [TerrainType.FERTILE_SOIL]: 'Fertile',
  [TerrainType.FARMLAND]: 'Farm',
  [TerrainType.MOUNTAIN]: 'Mountain',
  [TerrainType.CITY]: 'City',
};

export default function FactoriesPage() {
  const { player } = useAuth();
  const { addToast } = useToast();
  const { refreshWallet } = useWallet();
  const { refreshOnboarding } = useOnboarding();

  const [factories, setFactories] = useState<FactoryCardData[]>([]);
  const [ownedTiles, setOwnedTiles] = useState<OwnedTile[]>([]);
  const [playerSpecialty, setPlayerSpecialty] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Build mode state
  const [buildMode, setBuildMode] = useState(false);
  const [buildTab, setBuildTab] = useState<BuildTab>('L0');
  const [selectedCommodity, setSelectedCommodity] = useState<CommodityOption | null>(null);
  const [selectedTileIds, setSelectedTileIds] = useState<Set<string>>(new Set());
  const [factoryName, setFactoryName] = useState('');
  const [building, setBuilding] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      // Get player state to find the active season
      const playerState = await api.get<{ season: { id: string; specialty: string | null } | null }>('/players/me');
      const seasonId = playerState.season?.id;
      setPlayerSpecialty(playerState.season?.specialty ?? null);

      const [factoryData, tileData] = await Promise.all([
        api.get<FactoryCardData[]>('/factories'),
        seasonId
          ? api.get<OwnedTile[]>(`/map/tiles?seasonId=${seasonId}&minX=0&minY=0&maxX=100&maxY=100`)
          : Promise.resolve([]),
      ]);
      setFactories(Array.isArray(factoryData) ? factoryData : []);
      // Filter to owned tiles only
      const allTiles = Array.isArray(tileData) ? tileData : [];
      const owned = allTiles.filter((t) => t.ownerPlayerId === player?.id);
      setOwnedTiles(owned);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }, [player?.id]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Determine which tiles are valid for the selected commodity
  const validTileIds = new Set<string>();
  if (selectedCommodity) {
    for (const tile of ownedTiles) {
      if (!tile.factoryId && selectedCommodity.allowedTerrains.includes(tile.terrainType)) {
        validTileIds.add(tile.id);
      }
    }
  }

  function handleTileClick(tile: OwnedTile) {
    if (!selectedCommodity) return;
    if (tile.factoryId) return;
    if (!selectedCommodity.allowedTerrains.includes(tile.terrainType)) return;

    const { width, height } = selectedCommodity;
    const block = findRectBlock(tile, width, height, ownedTiles, selectedCommodity.allowedTerrains);

    if (block) {
      setSelectedTileIds(new Set(block.map((t) => t.id)));
    } else {
      setSelectedTileIds((prev) => {
        const next = new Set(prev);
        if (next.has(tile.id)) {
          next.delete(tile.id);
        } else {
          if (next.size < width * height) {
            next.add(tile.id);
          }
        }
        return next;
      });
    }
  }

  async function handleBuild() {
    if (!selectedCommodity || selectedTileIds.size === 0) return;
    setBuilding(true);
    setError(null);

    try {
      await api.post('/factories', {
        tileIds: Array.from(selectedTileIds),
        category: selectedCommodity.category,
        commodityId: selectedCommodity.slug,
        level: selectedCommodity.level,
        name: factoryName.trim() || undefined,
        isShop: selectedCommodity.type === 'shop' || undefined,
      });
      addToast(`${factoryName.trim() || selectedCommodity.name} built for ${selectedCommodity.cost} coins!`, 'success');
      refreshWallet();
      refreshOnboarding();
      setSelectedCommodity(null);
      setSelectedTileIds(new Set());
      setFactoryName('');
      setBuildMode(false);
      setLoading(true);
      await fetchData();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Construction failed';
      setError(msg);
      addToast(msg, 'error');
    } finally {
      setBuilding(false);
    }
  }

  function handleCancelBuild() {
    setSelectedCommodity(null);
    setSelectedTileIds(new Set());
    setBuildMode(false);
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
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">My Factories / Shops</h1>
        {!buildMode && (
          <Button variant="primary" size="sm" onClick={() => setBuildMode(true)}>
            Build Factory
          </Button>
        )}
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm" role="alert">
          {error}
        </div>
      )}

      {/* Build Mode */}
      {buildMode && (
        <Card padding="lg">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-gray-900">Build New Factory</h2>
              <Button variant="ghost" size="sm" onClick={handleCancelBuild}>Cancel</Button>
            </div>

            {/* Tabs */}
            <div className="flex gap-1 border-b border-gray-200 mb-3">
              {(['L0', 'L1', 'L2', 'Shop'] as BuildTab[]).map((tab) => (
                <button
                  key={tab}
                  onClick={() => { setBuildTab(tab); setSelectedCommodity(null); setSelectedTileIds(new Set()); }}
                  className={`px-3 py-2 text-sm font-medium rounded-t-lg transition-colors ${
                    buildTab === tab
                      ? 'bg-white border border-b-white border-gray-200 -mb-px text-blue-700'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  {tab === 'L0' ? '🏭 Raw (L0)' : tab === 'L1' ? '⚙️ Processing (L1)' : tab === 'L2' ? '🔧 Assembly (L2)' : '🏪 Shops'}
                </button>
              ))}
            </div>

            {/* Selection */}
            <div>
              <p className="text-sm text-gray-600 mb-3">
                {selectedCommodity
                  ? `Selected: ${selectedCommodity.name} — now click tiles on the map below to place it`
                  : buildTab === 'Shop'
                  ? 'Select a shop to build (requires City tiles):'
                  : `Select a ${buildTab} ${buildTab === 'L0' ? 'production' : 'processing'} facility:`}
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 max-h-[260px] overflow-y-auto pr-1">
                {BUILD_OPTIONS[buildTab].map((opt) => {
                  const isSpecialty = playerSpecialty === opt.slug;
                  return (
                  <button
                    key={opt.slug}
                    onClick={() => { setSelectedCommodity(opt); setSelectedTileIds(new Set()); }}
                    className={`flex flex-col items-center p-2.5 rounded-lg border-2 text-center transition-all relative ${
                      selectedCommodity?.slug === opt.slug
                        ? 'border-blue-500 bg-blue-50'
                        : isSpecialty
                        ? 'border-yellow-400 bg-yellow-50 hover:border-yellow-500'
                        : opt.type === 'shop'
                        ? 'border-amber-200 hover:border-amber-300'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    {isSpecialty && (
                      <span className="absolute -top-1 -right-1 text-yellow-500 text-sm" title="Your specialty (+10% bonus)">⭐</span>
                    )}
                    {opt.type === 'shop' && (
                      <span className="absolute -top-1 -left-1 text-[9px] bg-amber-500 text-white px-1 rounded">SHOP</span>
                    )}
                    <span className="text-xl">{opt.icon}</span>
                    <p className="text-xs font-medium text-gray-900 mt-1 leading-tight">{opt.name}</p>
                    <p className="text-[10px] text-gray-400">{opt.cost} coins</p>
                    {opt.requires && (
                      <p className="text-[9px] text-gray-400 mt-0.5 leading-tight">{opt.requires}</p>
                    )}
                  </button>
                  );
                })}
              </div>
            </div>

            {/* Step 2: Tile map for placement */}
            {selectedCommodity && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs text-gray-500">
                    Click a highlighted tile to auto-select a {selectedCommodity.layout} block. Need {selectedCommodity.width * selectedCommodity.height} tiles on{' '}
                    {selectedCommodity.allowedTerrains.map((t) => TERRAIN_LABELS[t]).join(' or ')}.
                  </p>
                  <div className="flex items-center gap-2">
                    {selectedTileIds.size > 0 && (
                      <span className="text-xs font-medium text-blue-600">
                        {selectedTileIds.size}/{selectedCommodity.width * selectedCommodity.height} selected
                      </span>
                    )}
                    <Link href="/map" className="btn btn-primary btn-sm gap-1">
                      🗺️ Open Map
                    </Link>
                  </div>
                </div>
                <TilePlacementGrid
                  tiles={ownedTiles}
                  validTileIds={validTileIds}
                  selectedTileIds={selectedTileIds}
                  factories={factories}
                  onTileClick={handleTileClick}
                />
              </div>
            )}

            {/* Step 3: Confirm */}
            {selectedCommodity && selectedTileIds.size === selectedCommodity.width * selectedCommodity.height && (
              <div className="space-y-3 p-3 bg-green-50 border border-green-200 rounded-lg">
                <div>
                  <label htmlFor="factory-name" className="text-xs font-medium text-gray-600">Factory Name (optional)</label>
                  <input
                    id="factory-name"
                    type="text"
                    value={factoryName}
                    onChange={(e) => setFactoryName(e.target.value)}
                    placeholder={`${selectedCommodity.name} Factory`}
                    className="mt-1 w-full px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    maxLength={100}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-green-800">Ready to build!</p>
                    <p className="text-xs text-green-600">Cost: {selectedCommodity.cost} coins</p>
                  </div>
                  <Button onClick={handleBuild} loading={building}>
                    Build Factory
                  </Button>
                </div>
              </div>
            )}
          </div>
        </Card>
      )}

      {/* Existing factories */}
      {factories.length === 0 && !buildMode ? (
        <div className="text-center py-12">
          <p className="text-gray-500 mb-4">
            You haven&apos;t built any factories yet. Purchase land and build your first factory to start producing.
          </p>
          <Button variant="primary" onClick={() => setBuildMode(true)}>
            Build Your First Factory
          </Button>
        </div>
      ) : factories.length > 0 && (
        <div className="space-y-6">
          {/* Factories */}
          {factories.filter(f => !f.isShop).length > 0 && (
            <div>
              <h2 className="text-lg font-semibold text-gray-900 mb-3">Active Factories</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {factories.filter(f => !f.isShop).map((factory) => (
                  <FactoryCard key={factory.id} factory={factory} />
                ))}
              </div>
            </div>
          )}

          {/* Shops */}
          {factories.filter(f => f.isShop).length > 0 && (
            <div>
              <h2 className="text-lg font-semibold text-gray-900 mb-3">My Shops</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {factories.filter(f => f.isShop).map((factory) => (
                  <FactoryCard key={factory.id} factory={factory} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Visual grid showing owned tiles for factory placement */
function TilePlacementGrid({
  tiles,
  validTileIds,
  selectedTileIds,
  factories,
  onTileClick,
}: {
  tiles: OwnedTile[];
  validTileIds: Set<string>;
  selectedTileIds: Set<string>;
  factories: FactoryCardData[];
  onTileClick: (tile: OwnedTile) => void;
}) {
  if (tiles.length === 0) {
    return (
      <div className="p-4 text-center text-sm text-gray-500 bg-gray-100 rounded-lg">
        No owned tiles. Purchase land on the Map first.
      </div>
    );
  }

  // Calculate bounds for the grid
  const minX = Math.min(...tiles.map((t) => t.x));
  const maxX = Math.max(...tiles.map((t) => t.x));
  const minY = Math.min(...tiles.map((t) => t.y));
  const maxY = Math.max(...tiles.map((t) => t.y));

  const gridWidth = maxX - minX + 1;
  const gridHeight = maxY - minY + 1;

  // Build a lookup map
  const tileMap = new Map<string, OwnedTile>();
  for (const tile of tiles) {
    tileMap.set(`${tile.x},${tile.y}`, tile);
  }

  // Determine cell size based on grid dimensions
  const cellSize = Math.max(24, Math.min(40, Math.floor(500 / Math.max(gridWidth, gridHeight))));

  return (
    <div
      className="overflow-auto rounded-lg border border-gray-200 bg-slate-900 p-2"
      style={{ maxHeight: '320px' }}
    >
      <div
        className="grid gap-px mx-auto"
        style={{
          gridTemplateColumns: `repeat(${gridWidth}, ${cellSize}px)`,
          width: `${gridWidth * (cellSize + 1)}px`,
        }}
      >
        {Array.from({ length: gridHeight }, (_, row) =>
          Array.from({ length: gridWidth }, (_, col) => {
            const x = minX + col;
            const y = minY + row;
            const tile = tileMap.get(`${x},${y}`);

            if (!tile) {
              // Empty gap
              return (
                <div
                  key={`${x},${y}`}
                  style={{ width: cellSize, height: cellSize }}
                  className="bg-slate-800/50"
                />
              );
            }

            const isValid = validTileIds.has(tile.id);
            const isSelected = selectedTileIds.has(tile.id);
            const hasFactory = !!tile.factoryId;

            return (
              <button
                key={tile.id}
                onClick={() => onTileClick(tile)}
                disabled={!isValid || hasFactory}
                style={{
                  width: cellSize,
                  height: cellSize,
                  backgroundColor: TERRAIN_COLORS[tile.terrainType],
                }}
                className={`relative flex items-center justify-center text-[10px] font-bold transition-all ${
                  isSelected
                    ? 'ring-2 ring-blue-400 ring-inset brightness-125 z-10'
                    : isValid && !hasFactory
                    ? 'ring-1 ring-emerald-400 ring-inset animate-pulse-subtle cursor-pointer hover:brightness-125'
                    : hasFactory
                    ? 'opacity-60 cursor-not-allowed'
                    : 'opacity-40 cursor-not-allowed'
                }`}
                title={`(${x},${y}) ${TERRAIN_LABELS[tile.terrainType]}${hasFactory ? ' [Factory]' : ''}`}
                aria-label={`Tile ${x},${y} - ${TERRAIN_LABELS[tile.terrainType]}${isValid ? ' (valid)' : ''}`}
              >
                {hasFactory && <span className="text-sm">🏭</span>}
                {isSelected && !hasFactory && <span className="text-white text-sm">✓</span>}
              </button>
            );
          }),
        )}
      </div>
    </div>
  );
}

/**
 * Try to find a width×height rectangular block of valid tiles starting from the clicked tile
 * as the top-left corner (or finds the best position containing the clicked tile).
 */
function findRectBlock(
  startTile: OwnedTile,
  width: number,
  height: number,
  allTiles: OwnedTile[],
  allowedTerrains: TerrainType[],
): OwnedTile[] | null {
  const tileMap = new Map<string, OwnedTile>();
  for (const t of allTiles) {
    if (!t.factoryId && allowedTerrains.includes(t.terrainType)) {
      tileMap.set(`${t.x},${t.y}`, t);
    }
  }

  // Try the clicked tile as each possible position within the block
  for (let offsetRow = 0; offsetRow < height; offsetRow++) {
    for (let offsetCol = 0; offsetCol < width; offsetCol++) {
      const topLeftX = startTile.x - offsetCol;
      const topLeftY = startTile.y - offsetRow;

      const block: OwnedTile[] = [];
      let valid = true;

      for (let row = 0; row < height && valid; row++) {
        for (let col = 0; col < width && valid; col++) {
          const key = `${topLeftX + col},${topLeftY + row}`;
          const tile = tileMap.get(key);
          if (tile) {
            block.push(tile);
          } else {
            valid = false;
          }
        }
      }

      if (valid && block.length === width * height) {
        return block;
      }
    }
  }

  return null;
}
