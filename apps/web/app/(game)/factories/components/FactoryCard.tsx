'use client';

import React from 'react';
import Link from 'next/link';
import { Card } from '@sea-commodity-tycoon/ui';
import { FactoryStatus, CommodityCategory } from '@sea-commodity-tycoon/shared-types';

export interface FactoryCardData {
  id: string;
  name: string;
  category: CommodityCategory;
  commoditySlug: string | null;
  commodityName: string | null;
  isShop: boolean;
  factoryLevel: number;
  status: FactoryStatus;
  efficiency: number;
  maintenanceCount: number;
  setupCost: number;
  exclusiveOutputSlug: string | null;
  outputSwitchCooldownUntil: string | null;
  fertilizerBoostActive: boolean;
  fertilizerBoostExpiresAt: string | null;
  constructedAt: string;
  workerCount?: number;
}

const STATUS_COLORS: Record<FactoryStatus, string> = {
  [FactoryStatus.IDLE]: 'bg-red-100 text-red-700',
  [FactoryStatus.PRODUCING]: 'bg-green-100 text-green-700',
  [FactoryStatus.PAUSED]: 'bg-yellow-100 text-yellow-700',
};

const CATEGORY_COLORS: Record<CommodityCategory, string> = {
  [CommodityCategory.AGRICULTURE]: 'text-green-600',
  [CommodityCategory.ENERGY]: 'text-yellow-600',
  [CommodityCategory.METAL]: 'text-gray-600',
  [CommodityCategory.LIVESTOCK]: 'text-orange-600',
  [CommodityCategory.FISHERY]: 'text-blue-600',
  [CommodityCategory.FORESTRY]: 'text-emerald-600',
  [CommodityCategory.ELECTRONICS]: 'text-purple-600',
  [CommodityCategory.AUTOMOTIVE]: 'text-red-600',
};

function getLevelLabel(level: number): string {
  switch (level) {
    case 0: return 'L0 - Raw';
    case 1: return 'L1 - Processing';
    case 2: return 'L2 - Assembly';
    default: return `L${level}`;
  }
}

function getMaxEfficiency(maintenanceCount: number): number {
  return Math.max(50, 100 - maintenanceCount * 5);
}

export function FactoryCard({ factory }: { factory: FactoryCardData }) {
  const maxEfficiency = getMaxEfficiency(factory.maintenanceCount);

  return (
    <Link href={`/factories/${factory.id}`} className="block">
      <Card className="hover:border-blue-300 hover:shadow-md transition-all cursor-pointer">
        <div className="flex items-start justify-between">
          <div>
            <span className={`text-sm font-medium ${CATEGORY_COLORS[factory.category]}`}>
              {factory.name}
            </span>
            <p className="text-xs text-gray-500 mt-0.5">
              {factory.isShop
                ? '🏪 Shop'
                : `${factory.commodityName ?? factory.category.replace('_', ' ')} · ${getLevelLabel(factory.factoryLevel)}`}
            </p>
          </div>
          <span
            className={`px-2 py-0.5 text-xs font-medium rounded-full ${STATUS_COLORS[factory.status]}`}
          >
            {factory.isShop
              ? factory.status === FactoryStatus.PRODUCING ? 'SELLING' : 'CLOSED'
              : factory.status}
          </span>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
          <div>
            <span className="text-gray-500">Efficiency</span>
            <div className="flex items-center gap-1">
              <div className="flex-1 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full ${
                    factory.efficiency > 70 ? 'bg-green-500' :
                    factory.efficiency > 50 ? 'bg-yellow-500' : 'bg-red-500'
                  }`}
                  style={{ width: `${factory.efficiency}%` }}
                />
              </div>
              <span className="text-xs font-medium text-gray-700">
                {factory.efficiency}%
              </span>
            </div>
          </div>
          <div>
            <span className="text-gray-500">Max Efficiency</span>
            <p className="font-medium text-gray-900">{maxEfficiency}%</p>
          </div>
          <div>
            <span className="text-gray-500">Maintenance</span>
            <p className="font-medium text-gray-900">{factory.maintenanceCount}×</p>
          </div>
          <div>
            <span className="text-gray-500">Employees</span>
            <p className="font-medium text-gray-900">{factory.workerCount ?? 0}/2</p>
          </div>
        </div>

        <div className="mt-2 flex items-center justify-between text-xs text-gray-500">
          <span>Deconstruction fee: {Math.round(factory.setupCost * 0.25)} coins</span>
        </div>

        {factory.fertilizerBoostActive && (
          <div className="mt-2 flex items-center gap-1 text-xs text-green-600">
            <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
            </svg>
            Fertilizer Active
          </div>
        )}

        {factory.exclusiveOutputSlug && (
          <div className="mt-1 text-xs text-gray-500">
            Output: <span className="font-medium">{factory.exclusiveOutputSlug}</span>
          </div>
        )}
      </Card>
    </Link>
  );
}
