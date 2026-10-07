// SEA Commodity Tycoon - Configuration Package
// Loads, validates, and exports typed game configuration from recipe-config.json

export { GameConfigLoader, ConfigurationError } from './loader.js';
export type { ConfigChangeListener } from './loader.js';

export {
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

export type {
  GameConfig,
  CommodityConfig,
  RecipeConfig,
  ShopConfig,
  EventConfig,
  EconomicParameters,
  FertilizerConfig,
  Level0Commodity,
  Level1Commodity,
  Level2Commodity,
  CommodityCategory,
  TerrainType,
  ShopType,
  EventType,
} from './types.js';
