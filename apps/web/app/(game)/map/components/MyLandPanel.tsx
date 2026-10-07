'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { TerrainType } from '@sea-commodity-tycoon/shared-types';
import { api } from '@/lib/api-client';
import { useToast } from '@/lib/toast-context';
import { useWallet } from '@/lib/wallet-context';

interface OwnedTile {
  id: string;
  x: number;
  y: number;
  terrainType: TerrainType;
  ownerPlayerId: string | null;
  factoryId: string | null;
  purchasePrice: string | null;
  purchasedAt: string | null;
}

interface MyLandPanelProps {
  currentPlayerId: string | null;
  seasonId: string;
  onSellComplete: () => void;
  selectedOwnedTileIds?: Set<string>;
}

const TERRAIN_LABELS: Record<TerrainType, string> = {
  [TerrainType.WATER_TERRAIN]: 'Water',
  [TerrainType.FERTILE_SOIL]: 'Fertile Soil',
  [TerrainType.FARMLAND]: 'Farmland',
  [TerrainType.MOUNTAIN]: 'Mountain',
  [TerrainType.CITY]: 'City',
};

const TERRAIN_DOT_COLORS: Record<TerrainType, string> = {
  [TerrainType.WATER_TERRAIN]: '#3B82F6',
  [TerrainType.FERTILE_SOIL]: '#166534',
  [TerrainType.FARMLAND]: '#4ADE80',
  [TerrainType.MOUNTAIN]: '#78716C',
  [TerrainType.CITY]: '#F59E0B',
};

/**
 * Calculate resale price: 100% initially, drops 10% every 5 days, minimum 50%.
 */
function getResalePrice(tile: OwnedTile): number | string {
  if (!tile.purchasePrice) return '?';
  const price = parseFloat(tile.purchasePrice);
  if (!tile.purchasedAt) return Math.floor(price * 0.5);

  const daysSincePurchase = (Date.now() - new Date(tile.purchasedAt).getTime()) / (1000 * 60 * 60 * 24);
  const periods = Math.floor(daysSincePurchase / 5);
  const percent = Math.max(0.5, 1.0 - periods * 0.1);
  return Math.floor(price * percent);
}

export function MyLandPanel({ currentPlayerId, seasonId, onSellComplete, selectedOwnedTileIds }: MyLandPanelProps) {
  const { addToast } = useToast();
  const { refreshWallet } = useWallet();
  const [ownedTiles, setOwnedTiles] = useState<OwnedTile[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedForSale, setSelectedForSale] = useState<Set<string>>(new Set());
  const [selling, setSelling] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const fetchOwned = useCallback(async () => {
    if (!currentPlayerId || !seasonId) return;
    try {
      const tiles = await api.get<OwnedTile[]>(
        `/map/tiles?seasonId=${seasonId}&minX=0&minY=0&maxX=100&maxY=100`,
      );
      setOwnedTiles(tiles.filter((t) => t.ownerPlayerId === currentPlayerId));
    } catch {
      setOwnedTiles([]);
    } finally {
      setLoading(false);
    }
  }, [currentPlayerId, seasonId]);

  useEffect(() => {
    fetchOwned();
  }, [fetchOwned]);

  // Auto-select owned tiles that are selected on the map
  useEffect(() => {
    if (selectedOwnedTileIds && selectedOwnedTileIds.size > 0) {
      setSelectedForSale(selectedOwnedTileIds);
      setExpanded(true);
    }
  }, [selectedOwnedTileIds]);

  const toggleTileForSale = (tileId: string) => {
    setSelectedForSale((prev) => {
      const next = new Set(prev);
      if (next.has(tileId)) {
        next.delete(tileId);
      } else {
        next.add(tileId);
      }
      return next;
    });
  };

  const selectAllForSale = () => {
    const sellable = ownedTiles.filter((t) => !t.factoryId).map((t) => t.id);
    setSelectedForSale(new Set(sellable));
  };

  const clearSelection = () => {
    setSelectedForSale(new Set());
  };

  const handleSell = async () => {
    if (selectedForSale.size === 0) return;
    setSelling(true);
    try {
      const result = await api.post<{ totalRefund: number; newBalance: number }>('/map/tiles/resell', {
        tileIds: Array.from(selectedForSale),
      });
      addToast(`Sold ${selectedForSale.size} tile${selectedForSale.size > 1 ? 's' : ''} for ${result.totalRefund} coins`, 'success');
      refreshWallet();
      setSelectedForSale(new Set());
      await fetchOwned();
      onSellComplete();
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to sell tiles', 'error');
    } finally {
      setSelling(false);
    }
  };

  const sellableTiles = ownedTiles.filter((t) => !t.factoryId);
  const tilesWithFactory = ownedTiles.filter((t) => t.factoryId);
  const selectedSellable = Array.from(selectedForSale).filter((id) =>
    sellableTiles.some((t) => t.id === id),
  );

  // Group by terrain for summary
  const terrainCounts = ownedTiles.reduce<Record<string, number>>((acc, t) => {
    acc[t.terrainType] = (acc[t.terrainType] || 0) + 1;
    return acc;
  }, {});

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4 shadow-sm">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between text-sm font-semibold text-gray-700"
        aria-expanded={expanded}
      >
        <span>My Land ({ownedTiles.length} tiles)</span>
        <span className="text-gray-400">{expanded ? '▼' : '▶'}</span>
      </button>

      {expanded && (
        <div className="mt-3 space-y-3">
          {loading ? (
            <p className="text-xs text-gray-400">Loading...</p>
          ) : ownedTiles.length === 0 ? (
            <p className="text-xs text-gray-500">You don&apos;t own any land yet.</p>
          ) : (
            <>
              {/* Terrain summary */}
              <div className="flex flex-wrap gap-2">
                {Object.entries(terrainCounts).map(([terrain, count]) => (
                  <span
                    key={terrain}
                    className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-600"
                  >
                    <span
                      className="w-2 h-2 rounded-full"
                      style={{ backgroundColor: TERRAIN_DOT_COLORS[terrain as TerrainType] }}
                    />
                    {TERRAIN_LABELS[terrain as TerrainType]} × {count}
                  </span>
                ))}
              </div>

              {/* Sell controls */}
              {sellableTiles.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-gray-500">
                      Sellable: {sellableTiles.length} tile{sellableTiles.length !== 1 ? 's' : ''}
                    </p>
                    <div className="flex gap-2">
                      <button
                        onClick={selectAllForSale}
                        className="text-[10px] text-blue-600 hover:text-blue-800 underline"
                      >
                        Select all
                      </button>
                      {selectedForSale.size > 0 && (
                        <button
                          onClick={clearSelection}
                          className="text-[10px] text-gray-500 hover:text-gray-700 underline"
                        >
                          Clear
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Tile list */}
                  <div className="max-h-[180px] overflow-y-auto space-y-1 pr-1">
                    {sellableTiles.map((tile) => {
                      const isSelected = selectedForSale.has(tile.id);
                      const resalePrice = getResalePrice(tile);
                      return (
                        <label
                          key={tile.id}
                          className={`flex items-center gap-2 p-1.5 rounded cursor-pointer transition-colors ${
                            isSelected ? 'bg-red-50 border border-red-200' : 'hover:bg-gray-50 border border-transparent'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleTileForSale(tile.id)}
                            className="w-3.5 h-3.5 rounded border-gray-300 text-red-600 focus:ring-red-500"
                          />
                          <span
                            className="w-2.5 h-2.5 rounded-sm shrink-0"
                            style={{ backgroundColor: TERRAIN_DOT_COLORS[tile.terrainType] }}
                          />
                          <span className="text-xs text-gray-700 flex-1">
                            ({tile.x}, {tile.y})
                          </span>
                          <span className="text-[10px] text-gray-400">{resalePrice} coins</span>
                        </label>
                      );
                    })}
                  </div>

                  {/* Sell button */}
                  {selectedSellable.length > 0 && (
                    <button
                      onClick={handleSell}
                      disabled={selling}
                      className="w-full py-2 px-3 bg-red-600 text-white text-sm font-medium rounded-lg hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      {selling
                        ? 'Selling...'
                        : `Sell ${selectedSellable.length} tile${selectedSellable.length !== 1 ? 's' : ''}`}
                    </button>
                  )}
                </div>
              )}

              {/* Tiles with factories (can't sell) */}
              {tilesWithFactory.length > 0 && (
                <p className="text-[10px] text-amber-600">
                  {tilesWithFactory.length} tile{tilesWithFactory.length !== 1 ? 's' : ''} cannot be sold (factory placed)
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
