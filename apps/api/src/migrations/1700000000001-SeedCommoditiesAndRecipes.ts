import { MigrationInterface, QueryRunner } from 'typeorm';
import * as path from 'path';
import * as fs from 'fs';

interface CommodityConfig {
  slug: string;
  name: string;
  category: string;
  level: number;
  base_price: number;
  production_time_minutes: number;
  base_yield: number;
  storage_size: number;
  max_workers: number;
  terrain_requirement: string;
  land_layout: string;
  setup_cost: number;
  [key: string]: unknown;
}

interface RecipeInputConfig {
  commodity_slug: string;
  quantity: number;
}

interface RecipeConfig {
  slug: string;
  name: string;
  factory_category: string;
  processing_time_minutes: number;
  worker_requirement: number;
  inputs: RecipeInputConfig[];
  output: {
    commodity_slug: string;
    quantity: number;
  };
  [key: string]: unknown;
}

interface ShopConfig {
  slug: string;
  name: string;
  type: string;
  setup_cost: number;
  storage_capacity: number;
  min_types_required: number;
  demand_rate_per_hour: number;
  accepted_commodities: string[];
  [key: string]: unknown;
}

interface GameRecipeConfig {
  commodities: {
    level_0: CommodityConfig[];
    level_1: CommodityConfig[];
    level_2: CommodityConfig[];
  };
  recipes: {
    level_1: RecipeConfig[];
    level_2: RecipeConfig[];
  };
  shops: ShopConfig[];
}

export class SeedCommoditiesAndRecipes1700000000001 implements MigrationInterface {
  name = 'SeedCommoditiesAndRecipes1700000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Load recipe-config.json from repository root
    const configPath = path.resolve(__dirname, '../../../../recipe-config.json');
    const configRaw = fs.readFileSync(configPath, 'utf-8');
    const config: GameRecipeConfig = JSON.parse(configRaw);

    // Insert all commodities (L0, L1, L2)
    const allCommodities = [
      ...config.commodities.level_0,
      ...config.commodities.level_1,
      ...config.commodities.level_2,
    ];

    for (const commodity of allCommodities) {
      await queryRunner.query(
        `INSERT INTO commodities (slug, name, category, level, base_price, base_production_time_minutes, base_yield, storage_size, max_workers, terrain_requirement, land_layout, setup_cost, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [
          commodity.slug,
          commodity.name,
          commodity.category,
          commodity.level,
          commodity.base_price,
          commodity.production_time_minutes,
          commodity.base_yield,
          commodity.storage_size,
          commodity.max_workers,
          commodity.terrain_requirement || null,
          commodity.land_layout || null,
          commodity.setup_cost || null,
          JSON.stringify({
            ...(commodity.land_tiles ? { land_tiles: commodity.land_tiles } : {}),
            ...(commodity.terrain_alternative ? { terrain_alternative: commodity.terrain_alternative } : {}),
            ...(commodity.destination_shop ? { destination_shop: commodity.destination_shop } : {}),
            ...(commodity.exclusive_output ? { exclusive_output: commodity.exclusive_output } : {}),
            ...(commodity.exclusive_group ? { exclusive_group: commodity.exclusive_group } : {}),
            ...(commodity.bypass_processing ? { bypass_processing: commodity.bypass_processing } : {}),
          }),
        ],
      );
    }

    // Insert all recipes (L1, L2)
    const allRecipes = [
      ...config.recipes.level_1,
      ...config.recipes.level_2,
    ];

    for (const recipe of allRecipes) {
      // Look up output commodity ID
      const outputResult = await queryRunner.query(
        `SELECT id FROM commodities WHERE slug = $1`,
        [recipe.output.commodity_slug],
      );

      if (outputResult.length === 0) {
        throw new Error(`Output commodity not found: ${recipe.output.commodity_slug}`);
      }

      const outputCommodityId = outputResult[0].id;

      // Insert recipe
      const recipeResult = await queryRunner.query(
        `INSERT INTO recipes (slug, name, processing_time_minutes, worker_requirement, output_commodity_id, output_quantity, factory_category, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id`,
        [
          recipe.slug,
          recipe.name,
          recipe.processing_time_minutes,
          recipe.worker_requirement,
          outputCommodityId,
          recipe.output.quantity,
          recipe.factory_category,
          JSON.stringify({
            ...(recipe.exclusive_output ? { exclusive_output: recipe.exclusive_output } : {}),
            ...(recipe.exclusive_group ? { exclusive_group: recipe.exclusive_group } : {}),
          }),
        ],
      );

      const recipeId = recipeResult[0].id;

      // Insert recipe inputs
      for (const input of recipe.inputs) {
        const inputResult = await queryRunner.query(
          `SELECT id FROM commodities WHERE slug = $1`,
          [input.commodity_slug],
        );

        if (inputResult.length === 0) {
          throw new Error(`Input commodity not found: ${input.commodity_slug}`);
        }

        await queryRunner.query(
          `INSERT INTO recipe_inputs (recipe_id, commodity_id, quantity) VALUES ($1, $2, $3)`,
          [recipeId, inputResult[0].id, input.quantity],
        );
      }
    }

    // Insert shop_accepted_commodities
    for (const shop of config.shops) {
      for (const commoditySlug of shop.accepted_commodities) {
        const commodityResult = await queryRunner.query(
          `SELECT id FROM commodities WHERE slug = $1`,
          [commoditySlug],
        );

        if (commodityResult.length === 0) {
          throw new Error(`Accepted commodity not found: ${commoditySlug}`);
        }

        await queryRunner.query(
          `INSERT INTO shop_accepted_commodities (shop_type, commodity_id, min_types_required)
           VALUES ($1, $2, $3)`,
          [shop.type, commodityResult[0].id, shop.min_types_required],
        );
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM shop_accepted_commodities`);
    await queryRunner.query(`DELETE FROM recipe_inputs`);
    await queryRunner.query(`DELETE FROM recipes`);
    await queryRunner.query(`DELETE FROM commodities`);
  }
}
