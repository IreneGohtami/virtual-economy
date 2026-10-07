'use client';

import React, { useEffect, useState } from 'react';
import { TerrainType } from '@sea-commodity-tycoon/shared-types';
import { api } from '@/lib/api-client';
import { useToast } from '@/lib/toast-context';
import { useWallet } from '@/lib/wallet-context';
import type { MapTile } from '../hooks/useMapTiles';

interface TilePurchasePanelProps {
  selectedTiles: MapTile[];
  currentPlayerId: string | null;
  seasonId: string;
  seasonStartedAt: string | null;
  onPurchaseComplete: () => void;
  onClearSelection: () => void;
}

const TERRAIN_LABELS: Record<TerrainType, string> = {
  [TerrainType.WATER_TERRAIN]: 'Water',
  [TerrainType.FERTILE_SOIL]: 'Fertile Soil',
  [TerrainType.FARMLAND]: 'Farmland',
  [TerrainType.MOUNTAIN]: 'Mountain',
  [TerrainType.CITY]: 'City',
};

function getCityLockDaysRemaining(seasonStartedAt: string | null): number {
  if (!seasonStartedAt) return 0;
  const start = new Date(seasonStartedAt).getTime();
  const now = Date.now();
  const daysSinceStart = (now - start) / (1000 * 60 * 60 * 24);
  const daysRemaining = Math.max(0, 5 - daysSinceStart);
  return Math.ceil(daysRemaining);
}

function formatCountdown(days: number): string {
  if (days <= 0) return '';
  if (days === 1) return '1 day remaining';
  return `${days} days remaining`;
}

/**
 * Estimates tile purchase cost using the same tiered formula as the backend.
 * Price per tile = 50 + 10 * tier, where tier = floor(tileIndex / 10)
 */
function estimatePurchaseCost(currentOwnedCount: number, tileCount: number): number {
  let total = 0;
  for (let i = 0; i < tileCount; i++) {
    const tileIndex = currentOwnedCount + i;
    const tier = Math.floor(tileIndex / 10);
    total += 50 + 10 * tier;
  }
  return total;
}

export function TilePurchasePanel({
  selectedTiles,
  currentPlayerId,
  seasonId,
  seasonStartedAt,
  onPurchaseComplete,
  onClearSelection,
}: TilePurchasePanelProps) {
  const { addToast } = useToast();
  const { refreshWallet } = useWallet();
  const [purchasing, setPurchasing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ownedCount, setOwnedCount] = useState(0);

  const cityLockDays = getCityLockDaysRemaining(seasonStartedAt);
  const hasCityTiles = selectedTiles.some((t) => t.terrainType === TerrainType.CITY);
  const cityLocked = hasCityTiles && cityLockDays > 0;

  const ownedTiles = selectedTiles.filter((t) => t.ownerPlayerId === currentPlayerId);
  const unownedTiles = selectedTiles.filter((t) => !t.ownerPlayerId);
  const otherOwnedTiles = selectedTiles.filter(
    (t) => t.ownerPlayerId && t.ownerPlayerId !== currentPlayerId,
  );

  const canPurchase = unownedTiles.length > 0 && !cityLocked && otherOwnedTiles.length === 0;

  // Fetch current owned tile count for cost estimation
  useEffect(() => {
    if (!currentPlayerId || !seasonId) return;
    api.get<MapTile[]>(`/map/tiles?seasonId=${seasonId}&minX=0&minY=0&maxX=100&maxY=100`)
      .then((tiles) => {
        const owned = tiles.filter((t) => t.ownerPlayerId === currentPlayerId);
        setOwnedCount(owned.length);
      })
      .catch(() => {});
  }, [currentPlayerId, seasonId]); // re-fetch on mount and after purchase via route change

  const estimatedCost = estimatePurchaseCost(ownedCount, unownedTiles.length);
  const isFree = estimatedCost === 0;

  async function handlePurchase() {
    if (!canPurchase) return;
    setPurchasing(true);
    setError(null);

    try {
      const result = await api.post<{ totalCost: number; newBalance: number; purchasedTiles: unknown[] }>(
        '/map/tiles/purchase',
        { tileIds: unownedTiles.map((t) => t.id) },
      );

      const cost = result.totalCost;
      const msg = cost > 0
        ? `Purchased ${unownedTiles.length} tile${unownedTiles.length > 1 ? 's' : ''} for ${cost} coins`
        : `Claimed ${unownedTiles.length} free tile${unownedTiles.length > 1 ? 's' : ''}!`;

      addToast(msg, 'success');
      refreshWallet();

      // Refresh map to show ownership changes
      onPurchaseComplete();
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Purchase failed';
      setError(errMsg);
      addToast(errMsg, 'error');
    } finally {
      setPurchasing(false);
    }
  }

  // If no tiles selected, show default state
  if (selectedTiles.length === 0) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-4 shadow-sm">
        <h3 className="text-sm font-semibold text-gray-700 mb-2">Tile Info</h3>
        <p className="text-xs text-gray-500">Click a tile on the map to view details or select tiles for purchase.</p>
        {cityLockDays > 0 && (
          <div className="mt-3 p-2 bg-amber-50 border border-amber-200 rounded text-xs text-amber-700">
            <span className="font-medium">City tiles locked:</span> {formatCountdown(cityLockDays)}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4 shadow-sm space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-700">
          Selected: {selectedTiles.length} tile{selectedTiles.length !== 1 ? 's' : ''}
        </h3>
        <button
          onClick={onClearSelection}
          className="text-xs text-gray-500 hover:text-gray-700 underline"
        >
          Clear
        </button>
      </div>

      {/* Terrain breakdown */}
      <div className="text-xs text-gray-600 space-y-1">
        {Object.values(TerrainType).map((terrain) => {
          const count = selectedTiles.filter((t) => t.terrainType === terrain).length;
          if (count === 0) return null;
          return (
            <div key={terrain} className="flex justify-between">
              <span>{TERRAIN_LABELS[terrain]}</span>
              <span className="font-medium">{count}</span>
            </div>
          );
        })}
      </div>

      {/* Cost estimate */}
      {unownedTiles.length > 0 && (
        <div className={`p-2.5 rounded-lg border ${isFree ? 'bg-green-50 border-green-200' : 'bg-blue-50 border-blue-200'}`}>
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-600">Estimated cost</span>
            <span className={`text-sm font-bold ${isFree ? 'text-green-700' : 'text-blue-700'}`}>
              {isFree ? 'FREE' : `${estimatedCost} coins`}
            </span>
          </div>
          <p className="text-[10px] text-gray-400 mt-1">
            You own {ownedCount} tile{ownedCount !== 1 ? 's' : ''}. Tier pricing: 50 + 10 per 10 tiles owned.
          </p>
        </div>
      )}

      {/* Ownership status */}
      {ownedTiles.length > 0 && (
        <div className="text-xs text-green-600">
          {ownedTiles.length} tile{ownedTiles.length !== 1 ? 's' : ''} already owned by you
        </div>
      )}
      {otherOwnedTiles.length > 0 && (
        <div className="text-xs text-red-600">
          {otherOwnedTiles.length} tile{otherOwnedTiles.length !== 1 ? 's' : ''} owned by another player
        </div>
      )}

      {/* City lock warning */}
      {cityLocked && (
        <div className="p-2 bg-amber-50 border border-amber-200 rounded text-xs text-amber-700">
          <span className="font-medium">City tiles are locked!</span>
          <br />
          {formatCountdown(cityLockDays)} until City tiles become available.
        </div>
      )}

      {/* Messages */}
      {error && (
        <div className="p-2 bg-red-50 border border-red-200 rounded text-xs text-red-700" role="alert">
          {error}
        </div>
      )}
      {/* Purchase button */}
      {unownedTiles.length > 0 && (
        <button
          onClick={handlePurchase}
          disabled={!canPurchase || purchasing}
          className="w-full py-2 px-3 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {purchasing
            ? 'Purchasing...'
            : isFree
            ? `Claim ${unownedTiles.length} Free Tile${unownedTiles.length !== 1 ? 's' : ''}`
            : `Purchase for ${estimatedCost} coins`}
        </button>
      )}
    </div>
  );
}
