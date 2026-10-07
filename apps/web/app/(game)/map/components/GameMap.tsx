'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { TerrainType } from '@sea-commodity-tycoon/shared-types';
import type { MapTile, ViewportBounds } from '../hooks/useMapTiles';

const BASE_TILE_SIZE = 32;
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 2;
const ZOOM_STEP = 0.15;

const TERRAIN_COLORS: Record<TerrainType, string> = {
  [TerrainType.WATER_TERRAIN]: '#3B82F6',
  [TerrainType.FERTILE_SOIL]: '#166534',
  [TerrainType.FARMLAND]: '#4ADE80',
  [TerrainType.MOUNTAIN]: '#78716C',
  [TerrainType.CITY]: '#F59E0B',
};

const OWNER_HIGHLIGHT_COLOR = 'rgba(255, 255, 255, 0.35)';
const SELECTION_COLOR = 'rgba(59, 130, 246, 0.5)';
const SELECTION_BORDER_COLOR = '#2563EB';

interface GameMapProps {
  tiles: Map<string, MapTile>;
  currentPlayerId: string | null;
  selectedTileIds: Set<string>;
  onTileClick: (tile: MapTile) => void;
  onViewportChange: (bounds: ViewportBounds) => void;
  loading?: boolean;
}

export function GameMap({
  tiles,
  currentPlayerId,
  selectedTileIds,
  onTileClick,
  onViewportChange,
  loading,
}: GameMapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef({ x: 0, y: 0 });
  const offsetStartRef = useRef({ x: 0, y: 0 });

  const tileSize = BASE_TILE_SIZE * zoom;

  // Calculate viewport bounds and notify parent
  const getViewportBounds = useCallback((): ViewportBounds | null => {
    const container = containerRef.current;
    if (!container) return null;

    const { width, height } = container.getBoundingClientRect();
    const minX = Math.floor(-offset.x / tileSize);
    const minY = Math.floor(-offset.y / tileSize);
    const maxX = Math.ceil((width - offset.x) / tileSize);
    const maxY = Math.ceil((height - offset.y) / tileSize);

    return { minX, minY, maxX, maxY };
  }, [offset, tileSize]);

  // Notify parent of viewport changes (debounced)
  useEffect(() => {
    const timer = setTimeout(() => {
      const bounds = getViewportBounds();
      if (bounds) {
        onViewportChange(bounds);
      }
    }, 150);
    return () => clearTimeout(timer);
  }, [offset, zoom, getViewportBounds, onViewportChange]);

  // Initial viewport load
  useEffect(() => {
    const bounds = getViewportBounds();
    if (bounds) {
      onViewportChange(bounds);
    }
    // Only run on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Canvas rendering
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const { width, height } = container.getBoundingClientRect();
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, width, height);

    // Render tiles
    for (const tile of tiles.values()) {
      const px = tile.x * tileSize + offset.x;
      const py = tile.y * tileSize + offset.y;

      // Skip tiles outside canvas
      if (px + tileSize < 0 || py + tileSize < 0 || px > width || py > height) {
        continue;
      }

      // Base terrain color
      ctx.fillStyle = TERRAIN_COLORS[tile.terrainType] || '#333';
      ctx.fillRect(px, py, tileSize, tileSize);

      // Owned tile highlight
      if (tile.ownerPlayerId === currentPlayerId) {
        ctx.fillStyle = OWNER_HIGHLIGHT_COLOR;
        ctx.fillRect(px, py, tileSize, tileSize);
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = Math.max(1, 2 * zoom);
        ctx.strokeRect(px + 1, py + 1, tileSize - 2, tileSize - 2);

        // Factory occupied marker
        if (tile.factoryId) {
          ctx.fillStyle = 'rgba(239, 68, 68, 0.7)';
          const markerSize = Math.max(4, tileSize * 0.3);
          ctx.fillRect(px + tileSize - markerSize - 1, py + 1, markerSize, markerSize);
          // Draw a small "F" if tile is big enough
          if (tileSize >= 20) {
            ctx.fillStyle = '#fff';
            ctx.font = `bold ${Math.max(8, Math.floor(tileSize * 0.25))}px sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('F', px + tileSize / 2, py + tileSize / 2);
          }
        }
      }

      // Selected tile highlight
      if (selectedTileIds.has(tile.id)) {
        ctx.fillStyle = SELECTION_COLOR;
        ctx.fillRect(px, py, tileSize, tileSize);
        ctx.strokeStyle = SELECTION_BORDER_COLOR;
        ctx.lineWidth = Math.max(2, 3 * zoom);
        ctx.strokeRect(px + 1.5, py + 1.5, tileSize - 3, tileSize - 3);
      }
    }

    // Grid lines (subtle, only when zoomed in enough)
    if (tileSize >= 12) {
      ctx.strokeStyle = 'rgba(255,255,255,0.08)';
      ctx.lineWidth = 0.5;
      const startX = ((offset.x % tileSize) + tileSize) % tileSize;
      const startY = ((offset.y % tileSize) + tileSize) % tileSize;
      for (let x = startX; x < width; x += tileSize) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
      }
      for (let y = startY; y < height; y += tileSize) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      }
    }
  }, [tiles, offset, zoom, tileSize, currentPlayerId, selectedTileIds]);

  // Resize observer
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const resizeObserver = new ResizeObserver(() => {
      setOffset((o) => ({ ...o }));
    });
    resizeObserver.observe(container);
    return () => resizeObserver.disconnect();
  }, []);

  // Scroll-wheel zoom (zooms toward cursor)
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    function handleWheel(e: WheelEvent) {
      e.preventDefault();
      const rect = container!.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      setZoom((prevZoom) => {
        const direction = e.deltaY < 0 ? 1 : -1;
        const newZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, prevZoom + direction * ZOOM_STEP));
        if (newZoom === prevZoom) return prevZoom;

        // Adjust offset so the point under cursor stays fixed
        const scale = newZoom / prevZoom;
        setOffset((prevOffset) => ({
          x: mouseX - (mouseX - prevOffset.x) * scale,
          y: mouseY - (mouseY - prevOffset.y) * scale,
        }));

        return newZoom;
      });
    }

    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => container.removeEventListener('wheel', handleWheel);
  }, []);

  // Mouse handlers for panning
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      setIsDragging(true);
      dragStartRef.current = { x: e.clientX, y: e.clientY };
      offsetStartRef.current = { x: offset.x, y: offset.y };
    },
    [offset],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!isDragging) return;
      const dx = e.clientX - dragStartRef.current.x;
      const dy = e.clientY - dragStartRef.current.y;
      setOffset({
        x: offsetStartRef.current.x + dx,
        y: offsetStartRef.current.y + dy,
      });
    },
    [isDragging],
  );

  const handleMouseUp = useCallback(
    (e: React.MouseEvent) => {
      if (!isDragging) return;
      setIsDragging(false);

      // Only trigger click if we didn't drag significantly
      const dx = Math.abs(e.clientX - dragStartRef.current.x);
      const dy = Math.abs(e.clientY - dragStartRef.current.y);
      if (dx < 3 && dy < 3) {
        const rect = canvasRef.current?.getBoundingClientRect();
        if (!rect) return;
        const canvasX = e.clientX - rect.left;
        const canvasY = e.clientY - rect.top;
        const tileX = Math.floor((canvasX - offset.x) / tileSize);
        const tileY = Math.floor((canvasY - offset.y) / tileSize);

        for (const tile of tiles.values()) {
          if (tile.x === tileX && tile.y === tileY) {
            onTileClick(tile);
            break;
          }
        }
      }
    },
    [isDragging, offset, tileSize, tiles, onTileClick],
  );

  const handleZoomIn = () => {
    setZoom((z) => Math.min(MAX_ZOOM, z + ZOOM_STEP));
  };

  const handleZoomOut = () => {
    setZoom((z) => Math.max(MIN_ZOOM, z - ZOOM_STEP));
  };

  const zoomPercent = Math.round(zoom * 100);

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full overflow-hidden bg-slate-900 select-none"
    >
      <canvas
        ref={canvasRef}
        className={`cursor-${isDragging ? 'grabbing' : 'grab'}`}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={() => setIsDragging(false)}
      />

      {/* Zoom controls */}
      <div className="absolute top-3 left-3 flex flex-col gap-1">
        <button
          onClick={handleZoomIn}
          disabled={zoom >= MAX_ZOOM}
          className="w-8 h-8 bg-black/70 text-white rounded flex items-center justify-center hover:bg-black/90 disabled:opacity-30 text-lg font-bold"
          aria-label="Zoom in"
        >
          +
        </button>
        <div className="w-8 h-6 bg-black/70 text-white rounded flex items-center justify-center text-[10px]">
          {zoomPercent}%
        </div>
        <button
          onClick={handleZoomOut}
          disabled={zoom <= MIN_ZOOM}
          className="w-8 h-8 bg-black/70 text-white rounded flex items-center justify-center hover:bg-black/90 disabled:opacity-30 text-lg font-bold"
          aria-label="Zoom out"
        >
          −
        </button>
      </div>

      {loading && (
        <div className="absolute top-3 right-3 bg-black/60 text-white text-xs px-2 py-1 rounded">
          Loading tiles...
        </div>
      )}

      {/* Terrain legend */}
      <div className="absolute bottom-3 left-3 bg-black/60 text-white text-xs px-3 py-2 rounded space-y-1">
        <div className="font-semibold mb-1">Terrain</div>
        <div className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 rounded-sm" style={{ background: TERRAIN_COLORS[TerrainType.WATER_TERRAIN] }} />
          <span>Water</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 rounded-sm" style={{ background: TERRAIN_COLORS[TerrainType.FERTILE_SOIL] }} />
          <span>Fertile Soil</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 rounded-sm" style={{ background: TERRAIN_COLORS[TerrainType.FARMLAND] }} />
          <span>Farmland</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 rounded-sm" style={{ background: TERRAIN_COLORS[TerrainType.MOUNTAIN] }} />
          <span>Mountain</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 rounded-sm" style={{ background: TERRAIN_COLORS[TerrainType.CITY] }} />
          <span>City</span>
        </div>
      </div>

      {/* Controls hint */}
      <div className="absolute bottom-3 right-3 bg-black/60 text-white text-[10px] px-2 py-1.5 rounded">
        Scroll to zoom · Drag to pan · Click to select
      </div>
    </div>
  );
}
