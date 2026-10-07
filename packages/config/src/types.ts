import { z } from 'zod';
import {
  GameConfigSchema,
  CommoditiesSchema,
  RecipesSchema,
  ShopDefinitionSchema,
  FertilizerConfigSchema,
  EconomicParametersSchema,
  EventDefinitionSchema,
  Level0CommoditySchema,
  Level1CommoditySchema,
  Level2CommoditySchema,
  CommodityCategorySchema,
  TerrainTypeSchema,
  ShopTypeSchema,
  EventTypeSchema,
} from './schemas.js';

// ============================================================
// Inferred Types from Zod Schemas
// ============================================================

/** Full game configuration matching recipe-config.json */
export type GameConfig = z.infer<typeof GameConfigSchema>;

/** All commodity definitions grouped by level */
export type CommodityConfig = z.infer<typeof CommoditiesSchema>;

/** All recipe definitions grouped by level */
export type RecipeConfig = z.infer<typeof RecipesSchema>;

/** Single shop type definition */
export type ShopConfig = z.infer<typeof ShopDefinitionSchema>;

/** Single event definition */
export type EventConfig = z.infer<typeof EventDefinitionSchema>;

/** All tunable economic parameters */
export type EconomicParameters = z.infer<typeof EconomicParametersSchema>;

/** Fertilizer boost configuration */
export type FertilizerConfig = z.infer<typeof FertilizerConfigSchema>;

/** Individual commodity at each level */
export type Level0Commodity = z.infer<typeof Level0CommoditySchema>;
export type Level1Commodity = z.infer<typeof Level1CommoditySchema>;
export type Level2Commodity = z.infer<typeof Level2CommoditySchema>;

/** Enum value types */
export type CommodityCategory = z.infer<typeof CommodityCategorySchema>;
export type TerrainType = z.infer<typeof TerrainTypeSchema>;
export type ShopType = z.infer<typeof ShopTypeSchema>;
export type EventType = z.infer<typeof EventTypeSchema>;
