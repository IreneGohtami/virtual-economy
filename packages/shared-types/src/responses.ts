// SEA Commodity Tycoon - Response Interfaces

import { CommodityCategory, FactoryStatus, SeasonStatus } from './enums';

/** Full player state returned by GET /players/me */
export interface PlayerState {
  playerId: string;
  displayName: string;
  avatarConfig: Record<string, unknown>;
  seasonId: string;
  specialty: CommodityCategory | null;
  coins: number;
  storageCapacity: number;
  workforceHappiness: number;
  lastActiveAt: string;
  seasonStatus: SeasonStatus;
}

/** Net worth breakdown returned by GET /players/me/net-worth */
export interface NetWorthBreakdown {
  cash: number;
  landValue: number;
  factoryValue: number;
  inventoryMarketValue: number;
  outstandingDebt: number;
  totalNetWorth: number;
}

/** Current price info for a commodity */
export interface PriceInfo {
  commodityId: string;
  commoditySlug: string;
  currentPrice: number;
  basePrice: number;
  supplyMultiplier: number;
  demandMultiplier: number;
  lastUpdatedAt: string;
}

/** Yield calculation result for a production preview */
export interface YieldCalculation {
  factoryId: string;
  recipeId: string | null;
  baseYield: number;
  finalYield: number;
  modifiers: YieldModifiers;
  incrementIntervalMinutes: number;
  effectiveProductionTimeMinutes: number;
  factoryEfficiency: number;
}

/** Breakdown of yield modifiers */
export interface YieldModifiers {
  specialtyBonus: number;
  secondWorkerBonus: number;
  workerSkillBonus: number;
  fertilizerBonus: number;
}

/** Result of a marketplace trade */
export interface TradeResult {
  tradeId: string;
  commodityId: string;
  quantity: number;
  pricePerUnit: number;
  totalPrice: number;
  buyerId: string;
  sellerId: string;
  tradedAt: string;
}

/** Factory summary info */
export interface FactoryInfo {
  factoryId: string;
  category: CommodityCategory;
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
}
