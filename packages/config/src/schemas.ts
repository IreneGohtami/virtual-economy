import { z } from 'zod';

// ============================================================
// Enums
// ============================================================

export const CommodityCategorySchema = z.enum([
  'AGRICULTURE',
  'ENERGY',
  'METAL',
  'LIVESTOCK',
  'FISHERY',
  'FORESTRY',
  'ELECTRONICS',
  'AUTOMOTIVE',
]);

export const TerrainTypeSchema = z.enum([
  'WATER_TERRAIN',
  'FERTILE_SOIL',
  'FARMLAND',
  'MOUNTAIN',
  'CITY',
]);

export const ShopTypeSchema = z.enum([
  'SUPERMARKET',
  'BUTCHER',
  'CAFE',
  'PETROL_STATION',
  'FURNITURE',
  'ELECTRONICS',
  'CAR_STORE',
]);

export const EventTypeSchema = z.enum(['POSITIVE', 'NEGATIVE']);

// ============================================================
// Commodity Schemas
// ============================================================

const BaseCommoditySchema = z.object({
  slug: z.string(),
  name: z.string(),
  category: CommodityCategorySchema,
  level: z.number().int().min(0).max(2),
  base_price: z.number().positive(),
  production_time_minutes: z.number().int().positive(),
  base_yield: z.number().int().positive(),
  storage_size: z.number().int().positive(),
  max_workers: z.number().int().positive(),
  terrain_requirement: TerrainTypeSchema,
  land_layout: z.string(),
  land_tiles: z.number().int().positive(),
  setup_cost: z.number().nonnegative(),
});

export const Level0CommoditySchema = BaseCommoditySchema.extend({
  level: z.literal(0),
  gross_per_cycle: z.number().nonnegative(),
  gross_per_day: z.number().nonnegative(),
  terrain_alternative: TerrainTypeSchema.optional(),
  land_layout_note: z.string().optional(),
  destination_shop: z.string().optional(),
  bypass_processing: z.boolean().optional(),
});

const EconomicsSchema = z.object({
  input_cost: z.string(),
  labor_cost: z.string(),
  total_cost_per_batch: z.number(),
  output_quantity: z.number().int().positive(),
  cost_per_unit: z.number(),
  selling_price: z.number(),
  margin_percent: z.number(),
  rationale: z.string(),
  gross_per_cycle: z.number().optional(),
  cycles_per_day: z.number().optional(),
  gross_per_day: z.number().optional(),
});

export const Level1CommoditySchema = BaseCommoditySchema.extend({
  level: z.literal(1),
  destination_shop: z.string().nullable().optional(),
  destination_note: z.string().optional(),
  terrain_alternative: TerrainTypeSchema.optional(),
  economics: EconomicsSchema.optional(),
  exclusive_output: z.boolean().optional(),
  exclusive_group: z.string().optional(),
});

export const Level2CommoditySchema = BaseCommoditySchema.extend({
  level: z.literal(2),
  destination_shop: z.string().nullable().optional(),
  terrain_alternative: TerrainTypeSchema.optional(),
  economics: EconomicsSchema.optional(),
});

export const CommoditiesSchema = z.object({
  level_0: z.array(Level0CommoditySchema),
  level_1: z.array(Level1CommoditySchema),
  level_2: z.array(Level2CommoditySchema),
});

// ============================================================
// Recipe Schemas
// ============================================================

const RecipeInputSchema = z.object({
  commodity_slug: z.string(),
  quantity: z.number().int().positive(),
});

const RecipeOutputSchema = z.object({
  commodity_slug: z.string(),
  quantity: z.number().int().positive(),
});

const BaseRecipeSchema = z.object({
  slug: z.string(),
  name: z.string(),
  factory_category: CommodityCategorySchema,
  processing_time_minutes: z.number().int().positive(),
  worker_requirement: z.number().int().positive(),
  inputs: z.array(RecipeInputSchema).min(1),
  output: RecipeOutputSchema,
  exclusive_output: z.boolean().optional(),
  exclusive_group: z.string().optional(),
});

export const RecipesSchema = z.object({
  level_1: z.array(BaseRecipeSchema),
  level_2: z.array(BaseRecipeSchema),
});

// ============================================================
// Shop Schema
// ============================================================

export const ShopDefinitionSchema = z.object({
  slug: z.string(),
  name: z.string(),
  type: ShopTypeSchema,
  setup_cost: z.number().nonnegative(),
  storage_capacity: z.number().int().positive(),
  min_types_required: z.number().int().positive(),
  demand_rate_per_hour: z.number().positive(),
  accepted_commodities: z.array(z.string()).min(1),
  revenue_multiplier: z.number().positive(),
  terrain_requirement: z.literal('CITY'),
  land_tiles: z.literal(1),
  description: z.string(),
});

// ============================================================
// Fertilizer Config Schema
// ============================================================

const FertilizerQuotaSchema = z.object({
  units_required: z.number().int().positive(),
  yield_bonus_percent: z.number().positive(),
  description: z.string(),
});

export const FertilizerConfigSchema = z.object({
  boost_duration_days: z.number().int().positive(),
  applicable_categories: z.array(CommodityCategorySchema),
  quotas: z.record(CommodityCategorySchema, FertilizerQuotaSchema),
  auto_reapply: z.boolean(),
});

// ============================================================
// Economic Parameters Schema
// ============================================================

const LandPricingSchema = z.object({
  base_price_per_tile: z.number().positive(),
  increment_per_tier: z.number().positive(),
  tier_size: z.number().int().positive(),
  resale_percent: z.number().positive().max(100),
});

const StorageUpgradeSchema = z.object({
  capacity: z.number().int().positive(),
  cost: z.number().nonnegative(),
});

const WorkerConfigSchema = z.object({
  total_pool_size: z.number().int().positive(),
  salary_range_min: z.number().positive(),
  salary_range_max: z.number().positive(),
  experience_range_min: z.number().int().positive(),
  experience_range_max: z.number().int().positive(),
  commitment_range_min: z.number().positive(),
  commitment_range_max: z.number().positive().max(100),
  max_workers_per_factory: z.number().int().positive(),
  disruption_check_interval_hours: z.number().positive(),
});

const FactoryDepreciationSchema = z.object({
  depreciation_rate_percent: z.number().positive(),
  depreciation_interval_days: z.number().int().positive(),
  minimum_efficiency_percent: z.number().nonnegative().max(100),
  maintenance_cost_percent_of_setup: z.number().positive(),
  maintenance_cap_degradation_percent: z.number().positive(),
  deconstruction_fee_percent: z.number().positive(),
});

const LoanConfigSchema = z.object({
  minimum_loan: z.number().positive(),
  maximum_loan_percent_of_net_worth: z.number().positive().max(100),
  interest_rate_per_period: z.number().nonnegative(),
  installment_interval_days: z.number().int().positive(),
  max_duration_days: z.number().int().positive(),
  allow_early_repayment: z.boolean(),
  allow_multiple_concurrent: z.boolean(),
});

const HappinessBoostSchema = z.object({
  slug: z.string(),
  name: z.string(),
  cost: z.number().positive(),
  happiness_increase: z.number().positive(),
});

const WorkforceHappinessSchema = z.object({
  starting_happiness: z.number().positive().max(100),
  daily_decay_percent: z.number().positive(),
  warning_threshold: z.number().positive().max(100),
  critical_threshold: z.number().positive().max(100),
  firing_penalty_percent: z.number().positive(),
  neutral_baseline: z.number().positive().max(100),
  boosts: z.array(HappinessBoostSchema),
});

const TerrainDistributionSchema = z.record(TerrainTypeSchema, z.number().min(0).max(1));

const MapGenerationSchema = z.object({
  terrain_distribution: TerrainDistributionSchema,
  tolerance_percent: z.number().nonnegative(),
  city_note: z.string().optional(),
});

const SupplyDemandMultiplierSchema = z.object({
  min_multiplier: z.number().positive(),
  max_multiplier: z.number().positive(),
  baseline_supply_per_commodity: z.union([z.string(), z.number()]),
  baseline_demand_per_commodity: z.union([z.string(), z.number()]),
});

export const EconomicParametersSchema = z.object({
  starting_coins: z.number().nonnegative(),
  starting_storage: z.number().int().positive(),
  season_duration_days: z.number().int().positive(),
  specialty_bonus_percent: z.number().nonnegative(),
  second_worker_bonus_percent: z.number().nonnegative(),
  instant_sell_discount_percent: z.number().nonnegative().max(100),
  price_stabilization_days: z.number().int().positive(),
  price_recalibration_time: z.string(),
  land_pricing: LandPricingSchema,
  storage_upgrades: z.array(StorageUpgradeSchema).min(1),
  worker_config: WorkerConfigSchema,
  factory_depreciation: FactoryDepreciationSchema,
  loan_config: LoanConfigSchema,
  workforce_happiness: WorkforceHappinessSchema,
  map_generation: MapGenerationSchema,
  supply_demand_multiplier: SupplyDemandMultiplierSchema,
});

// ============================================================
// Event Schema
// ============================================================

export const EventDefinitionSchema = z.object({
  slug: z.string(),
  name: z.string(),
  type: EventTypeSchema,
  affected_categories: z.array(CommodityCategorySchema).min(1),
  production_modifier: z.number(),
  demand_modifier: z.number(),
  price_modifier: z.number(),
  duration_days_min: z.number().int().positive(),
  duration_days_max: z.number().int().positive(),
  description: z.string(),
});

// ============================================================
// Top-Level Game Configuration Schema
// ============================================================

export const GameConfigSchema = z.object({
  $schema: z.string().optional(),
  description: z.string().optional(),
  commodities: CommoditiesSchema,
  recipes: RecipesSchema,
  shops: z.array(ShopDefinitionSchema),
  fertilizer_config: FertilizerConfigSchema,
  economic_parameters: EconomicParametersSchema,
  events: z.array(EventDefinitionSchema),
  _notes: z.record(z.unknown()).optional(),
});
