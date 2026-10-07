'use client';

import React from 'react';

interface LayoutRequirement {
  commodity: string;
  icon: string;
  layout: string;
  tiles: number;
  terrain: string;
  terrainColor: string;
  terrainBg: string;
}

const COMMODITY_LAYOUTS: LayoutRequirement[] = [
  { commodity: 'Rice', icon: '🌾', layout: '3×3', tiles: 9, terrain: 'Fertile Soil', terrainColor: 'text-green-800', terrainBg: 'bg-green-100' },
  { commodity: 'Palm Fruit', icon: '🌴', layout: '3×3', tiles: 9, terrain: 'Fertile Soil', terrainColor: 'text-green-800', terrainBg: 'bg-green-100' },
  { commodity: 'Cocoa', icon: '🍫', layout: '3×3', tiles: 9, terrain: 'Fertile Soil', terrainColor: 'text-green-800', terrainBg: 'bg-green-100' },
  { commodity: 'Coffee', icon: '☕', layout: '3×3', tiles: 9, terrain: 'Fertile Soil', terrainColor: 'text-green-800', terrainBg: 'bg-green-100' },
  { commodity: 'Crude Oil', icon: '🛢️', layout: '3×2', tiles: 6, terrain: 'Mountain', terrainColor: 'text-stone-700', terrainBg: 'bg-stone-100' },
  { commodity: 'Natural Gas', icon: '🔥', layout: '3×2', tiles: 6, terrain: 'Mountain', terrainColor: 'text-stone-700', terrainBg: 'bg-stone-100' },
  { commodity: 'Iron Ore', icon: '⛏️', layout: '2×2', tiles: 4, terrain: 'Mountain', terrainColor: 'text-stone-700', terrainBg: 'bg-stone-100' },
  { commodity: 'Nickel Ore', icon: '🪨', layout: '2×2', tiles: 4, terrain: 'Mountain', terrainColor: 'text-stone-700', terrainBg: 'bg-stone-100' },
  { commodity: 'Poultry', icon: '🐔', layout: '3×2', tiles: 6, terrain: 'Farmland', terrainColor: 'text-emerald-700', terrainBg: 'bg-emerald-50' },
  { commodity: 'Cattle', icon: '🐄', layout: '3×2', tiles: 6, terrain: 'Farmland', terrainColor: 'text-emerald-700', terrainBg: 'bg-emerald-50' },
  { commodity: 'Fish', icon: '🐟', layout: '2×2', tiles: 4, terrain: 'Water + Land', terrainColor: 'text-blue-700', terrainBg: 'bg-blue-50' },
  { commodity: 'Timber', icon: '🪵', layout: '3×3', tiles: 9, terrain: 'Fertile Soil', terrainColor: 'text-green-800', terrainBg: 'bg-green-100' },
  { commodity: 'Rubber', icon: '🌳', layout: '3×3', tiles: 9, terrain: 'Fertile Soil', terrainColor: 'text-green-800', terrainBg: 'bg-green-100' },
];

export function CommodityLayoutInfo() {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4 shadow-sm">
      <h3 className="text-sm font-semibold text-gray-700 mb-3">Factory Land Requirements</h3>
      <p className="text-xs text-gray-500 mb-3">
        Select tiles matching the terrain and layout needed for your commodity.
      </p>
      <div className="space-y-1.5 max-h-[320px] overflow-y-auto pr-1">
        {COMMODITY_LAYOUTS.map((item) => (
          <div
            key={item.commodity}
            className="flex items-center gap-2 p-2 rounded-md hover:bg-gray-50 transition-colors"
          >
            <span className="text-lg shrink-0" aria-hidden="true">{item.icon}</span>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-gray-900 leading-tight">{item.commodity}</p>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${item.terrainColor} ${item.terrainBg}`}>
                  {item.terrain}
                </span>
              </div>
            </div>
            <div className="text-right shrink-0">
              <p className="text-xs font-bold text-gray-700">{item.layout}</p>
              <p className="text-[10px] text-gray-400">{item.tiles} tiles</p>
            </div>
          </div>
        ))}
      </div>

      {/* Terrain Legend */}
      <div className="mt-3 pt-3 border-t border-gray-100">
        <p className="text-[10px] font-medium text-gray-500 uppercase tracking-wide mb-2">Map Legend</p>
        <div className="grid grid-cols-2 gap-1.5">
          <LegendItem color="#166534" label="Fertile Soil" />
          <LegendItem color="#4ADE80" label="Farmland" />
          <LegendItem color="#78716C" label="Mountain" />
          <LegendItem color="#3B82F6" label="Water" />
          <LegendItem color="#F59E0B" label="City" />
        </div>
      </div>
    </div>
  );
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span
        className="w-3 h-3 rounded-sm shrink-0 border border-gray-200"
        style={{ backgroundColor: color }}
        aria-hidden="true"
      />
      <span className="text-[10px] text-gray-600">{label}</span>
    </div>
  );
}
