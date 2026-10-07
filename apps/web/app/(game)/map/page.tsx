'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api-client';
import { useAuth } from '@/app/providers';
import { GameMap } from './components/GameMap';
import { TilePurchasePanel } from './components/TilePurchasePanel';
import { CommodityLayoutInfo } from './components/CommodityLayoutInfo';
import { MyLandPanel } from './components/MyLandPanel';
import { useMapTiles, type MapTile, type ViewportBounds } from './hooks/useMapTiles';

interface SeasonInfo {
  id: string;
  startsAt: string;
  endsAt: string;
}

export default function MapPage() {
  const { player } = useAuth();
  const [season, setSeason] = useState<SeasonInfo | null>(null);
  const [selectedTileIds, setSelectedTileIds] = useState<Set<string>>(new Set());
  const [seasonLoading, setSeasonLoading] = useState(true);

  // Fetch current season
  useEffect(() => {
    setSeasonLoading(true);
    api
      .get<SeasonInfo>('/season/current')
      .then((data) => setSeason(data))
      .catch(() => setSeason(null))
      .finally(() => setSeasonLoading(false));
  }, []);

  const { tiles, loading, loadTilesForViewport, resetTiles } = useMapTiles({
    seasonId: season?.id || '',
  });

  const handleViewportChange = useCallback(
    (bounds: ViewportBounds) => {
      if (season?.id) {
        loadTilesForViewport(bounds);
      }
    },
    [season?.id, loadTilesForViewport],
  );

  const handleTileClick = useCallback((tile: MapTile) => {
    setSelectedTileIds((prev) => {
      const next = new Set(prev);
      if (next.has(tile.id)) {
        next.delete(tile.id);
      } else {
        next.add(tile.id);
      }
      return next;
    });
  }, []);

  const handleClearSelection = useCallback(() => {
    setSelectedTileIds(new Set());
  }, []);

  const handlePurchaseComplete = useCallback(() => {
    // Reset and reload tiles to reflect ownership changes
    resetTiles();
    setSelectedTileIds(new Set());
    // Trigger a viewport change to reload
    const container = document.querySelector('[data-map-container]');
    if (container) {
      const rect = container.getBoundingClientRect();
      loadTilesForViewport({
        minX: 0,
        minY: 0,
        maxX: Math.ceil(rect.width / 32),
        maxY: Math.ceil(rect.height / 32),
      });
    }
  }, [resetTiles, loadTilesForViewport]);

  const selectedTiles = Array.from(selectedTileIds)
    .map((id) => tiles.get(id))
    .filter((t): t is MapTile => t !== undefined);

  if (seasonLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-gray-500">Loading season data...</div>
      </div>
    );
  }

  if (!season) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-gray-500">No active season found.</div>
      </div>
    );
  }

  return (
    <div className="flex h-screen">
      {/* Map canvas - main area */}
      <div className="flex-1 relative" data-map-container>
        <GameMap
          tiles={tiles}
          currentPlayerId={player?.id || null}
          selectedTileIds={selectedTileIds}
          onTileClick={handleTileClick}
          onViewportChange={handleViewportChange}
          loading={loading}
        />
      </div>

      {/* Side panel */}
      <aside className="w-80 border-l border-gray-200 bg-gray-50 p-4 overflow-y-auto space-y-4">
        <h2 className="text-lg font-bold text-gray-900">Map</h2>
        <TilePurchasePanel
          selectedTiles={selectedTiles}
          currentPlayerId={player?.id || null}
          seasonId={season.id}
          seasonStartedAt={season.startsAt}
          onPurchaseComplete={handlePurchaseComplete}
          onClearSelection={handleClearSelection}
        />
        <MyLandPanel
          currentPlayerId={player?.id || null}
          seasonId={season.id}
          onSellComplete={handlePurchaseComplete}
          selectedOwnedTileIds={new Set(selectedTiles.filter(t => t.ownerPlayerId === player?.id).map(t => t.id))}
        />
        <CommodityLayoutInfo />
        <div className="text-xs text-gray-500 space-y-1">
          <p>Drag to pan the map.</p>
          <p>Click tiles to select them for purchase.</p>
        </div>
      </aside>
    </div>
  );
}
