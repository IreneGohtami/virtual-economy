'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api-client';
import { TerrainType } from '@sea-commodity-tycoon/shared-types';

export interface MapTile {
  id: string;
  x: number;
  y: number;
  terrainType: TerrainType;
  ownerPlayerId: string | null;
  factoryId: string | null;
  purchasedAt: string | null;
}

export interface ViewportBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

interface UseMapTilesOptions {
  seasonId: string;
  chunkSize?: number;
}

export function useMapTiles({ seasonId, chunkSize = 50 }: UseMapTilesOptions) {
  const [tiles, setTiles] = useState<Map<string, MapTile>>(new Map());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadedChunksRef = useRef<Set<string>>(new Set());

  const getChunkKey = useCallback(
    (bounds: ViewportBounds) => `${bounds.minX},${bounds.minY},${bounds.maxX},${bounds.maxY}`,
    [],
  );

  const loadTilesForViewport = useCallback(
    async (bounds: ViewportBounds) => {
      // Align bounds to chunk grid
      const alignedMinX = Math.floor(bounds.minX / chunkSize) * chunkSize;
      const alignedMinY = Math.floor(bounds.minY / chunkSize) * chunkSize;
      const alignedMaxX = Math.ceil(bounds.maxX / chunkSize) * chunkSize;
      const alignedMaxY = Math.ceil(bounds.maxY / chunkSize) * chunkSize;

      const chunksToLoad: ViewportBounds[] = [];

      for (let x = alignedMinX; x < alignedMaxX; x += chunkSize) {
        for (let y = alignedMinY; y < alignedMaxY; y += chunkSize) {
          const chunk: ViewportBounds = {
            minX: x,
            minY: y,
            maxX: x + chunkSize,
            maxY: y + chunkSize,
          };
          const key = getChunkKey(chunk);
          if (!loadedChunksRef.current.has(key)) {
            chunksToLoad.push(chunk);
            loadedChunksRef.current.add(key);
          }
        }
      }

      if (chunksToLoad.length === 0) return;

      setLoading(true);
      setError(null);

      try {
        const results = await Promise.all(
          chunksToLoad.map((chunk) =>
            api.get<MapTile[]>(
              `/map/tiles?seasonId=${seasonId}&minX=${chunk.minX}&minY=${chunk.minY}&maxX=${chunk.maxX}&maxY=${chunk.maxY}`,
            ),
          ),
        );

        setTiles((prev) => {
          const next = new Map(prev);
          for (const batch of results) {
            for (const tile of batch) {
              next.set(tile.id, tile);
            }
          }
          return next;
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load map tiles');
        // Remove failed chunks so they can be retried
        for (const chunk of chunksToLoad) {
          loadedChunksRef.current.delete(getChunkKey(chunk));
        }
      } finally {
        setLoading(false);
      }
    },
    [seasonId, chunkSize, getChunkKey],
  );

  const resetTiles = useCallback(() => {
    setTiles(new Map());
    loadedChunksRef.current.clear();
    setError(null);
  }, []);

  // Reset when season changes
  useEffect(() => {
    resetTiles();
  }, [seasonId, resetTiles]);

  return {
    tiles,
    loading,
    error,
    loadTilesForViewport,
    resetTiles,
  };
}
