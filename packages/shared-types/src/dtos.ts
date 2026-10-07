// SEA Commodity Tycoon - Data Transfer Objects (DTOs)

import { CommodityCategory, EventType, ShopType } from './enums';

/** Start a production job at a factory */
export interface StartProductionDto {
  factoryId: string;
  recipeId?: string;
}

/** Construct a new factory on owned land */
export interface ConstructFactoryDto {
  tileIds: string[];
  commodityId?: string;
  recipeId?: string;
  category: CommodityCategory;
}

/** Construct a new shop on a CITY tile */
export interface ConstructShopDto {
  tileId: string;
  shopType: ShopType;
}

/** List inventory for sale on the marketplace */
export interface ListItemDto {
  commodityId: string;
  quantity: number;
}

/** Purchase a commodity from the marketplace */
export interface PurchaseDto {
  commodityId: string;
  quantity: number;
}

/** Instantly sell inventory to the bank at 90% market price */
export interface InstantSellDto {
  commodityId: string;
  quantity: number;
}

/** Request a loan from the bank */
export interface LoanRequestDto {
  amount: number;
}

/** Create or update a player profile */
export interface CreateProfileDto {
  displayName: string;
  avatarConfig: Record<string, unknown>;
}

/** Admin: trigger a game event */
export interface TriggerEventDto {
  eventType: EventType;
  name: string;
  description?: string;
  durationMinutes: number;
  affectedCategories: CommodityCategory[];
  productionModifier?: number;
  demandModifier?: number;
  priceModifier?: number;
}
