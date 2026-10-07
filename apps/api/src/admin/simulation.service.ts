import {
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  calculateDynamicPrice,
  calculateFinalYield,
  calculateEffectiveProductionTime,
  calculateIncrementInterval,
  calculateShopRevenue,
} from '@sea-commodity-tycoon/game-rules';
import { SimulationRun } from '../entities/simulation-run.entity';
import { Commodity } from '../entities/commodity.entity';
import { Recipe } from '../entities/recipe.entity';
import { RecipeInput } from '../entities/recipe-input.entity';

// ---------- Input/Output interfaces ----------

export interface SimulationInputParameters {
  /** Number of days to simulate */
  simulatedDays: number;
  /** Override base prices keyed by commodity slug */
  basePrices?: Record<string, number>;
  /** Override production times (minutes) keyed by commodity slug */
  productionTimes?: Record<string, number>;
  /** Override base yields keyed by commodity slug */
  yields?: Record<string, number>;
  /** Override recipe processing times keyed by recipe slug */
  recipeProcessingTimes?: Record<string, number>;
  /** Average worker salary for cost projection */
  averageSalary?: number;
  /** Storage tier costs override */
  storageCosts?: number[];
  /** Shop demand rates keyed by shop type */
  demandRates?: Record<string, number>;
  /** Factory efficiency percentage (0-100) */
  factoryEfficiency?: number;
  /** Number of production cycles per day per factory */
  productionCyclesPerDay?: number;
  /** Number of simulated players */
  playerCount?: number;
  /** Label for this simulation run */
  label?: string;
}

export interface CommodityProjection {
  slug: string;
  name: string;
  category: string;
  level: number;
  /** Daily production units */
  dailyProduction: number;
  /** Price trajectory per day */
  priceTrajectory: number[];
  /** Cumulative supply over simulation */
  cumulativeSupply: number;
  /** Cumulative demand over simulation */
  cumulativeDemand: number;
  /** Final equilibrium price */
  finalPrice: number;
}

export interface ChainEarnings {
  /** Chain name (e.g., "Palm Oil → Cooking Oil") */
  chainName: string;
  /** Total revenue from selling final product */
  totalRevenue: number;
  /** Total input cost (raw materials) */
  totalInputCost: number;
  /** Net profit from the chain */
  netProfit: number;
  /** Daily profit averaged over simulation */
  dailyProfit: number;
}

export interface SimulationOutputResults {
  /** Projected earnings per production chain */
  chainEarnings: ChainEarnings[];
  /** Price trajectories and supply/demand per commodity */
  commodityProjections: CommodityProjection[];
  /** Days at which supply ≈ demand for each commodity */
  equilibriumPoints: Record<string, number | null>;
  /** Commodity flow ratios: production vs consumption */
  flowRatios: Record<string, number>;
  /** Summary metrics */
  summary: {
    totalDaysSimulated: number;
    totalCommoditiesModeled: number;
    averagePriceVolatility: number;
    mostProfitableChain: string;
    leastProfitableChain: string;
  };
}

@Injectable()
export class SimulationService {
  private readonly logger = new Logger(SimulationService.name);

  /** Stabilization period: prices hold at base for first N days */
  private readonly STABILIZATION_DAYS = 7;

  /** Supply/demand multiplier clamp bounds */
  private readonly MULTIPLIER_MIN = 0.5;
  private readonly MULTIPLIER_MAX = 2.0;

  constructor(
    @InjectRepository(SimulationRun)
    private readonly simulationRunRepository: Repository<SimulationRun>,
    @InjectRepository(Commodity)
    private readonly commodityRepository: Repository<Commodity>,
    @InjectRepository(Recipe)
    private readonly recipeRepository: Repository<Recipe>,
    @InjectRepository(RecipeInput)
    private readonly recipeInputRepository: Repository<RecipeInput>,
  ) {}

  /**
   * Run a simulation and persist results.
   */
  async runSimulation(
    operatorId: string,
    params: SimulationInputParameters,
  ): Promise<SimulationRun> {
    // Create the simulation run record
    const run = this.simulationRunRepository.create({
      operatorId,
      inputParameters: params as unknown as Record<string, unknown>,
      simulatedDays: params.simulatedDays,
      status: 'RUNNING',
      startedAt: new Date(),
    });
    const savedRun = await this.simulationRunRepository.save(run);

    try {
      const results = await this.executeSimulation(params);
      savedRun.outputResults = results as unknown as Record<string, unknown>;
      savedRun.status = 'COMPLETED';
      savedRun.completedAt = new Date();
    } catch (error) {
      savedRun.status = 'FAILED';
      savedRun.completedAt = new Date();
      savedRun.outputResults = {
        error: error instanceof Error ? error.message : 'Unknown error',
      };
      this.logger.error(`Simulation ${savedRun.id} failed`, error);
    }

    return this.simulationRunRepository.save(savedRun);
  }

  /**
   * Get a simulation run by ID.
   */
  async getSimulationResult(id: string): Promise<SimulationRun> {
    const run = await this.simulationRunRepository.findOne({ where: { id } });
    if (!run) {
      throw new NotFoundException(`Simulation run '${id}' not found`);
    }
    return run;
  }

  /**
   * List all simulation runs (most recent first).
   */
  async listSimulations(): Promise<SimulationRun[]> {
    return this.simulationRunRepository.find({
      order: { startedAt: 'DESC' },
      take: 50,
    });
  }

  /**
   * Execute the simulation engine.
   * Isolated from live state — operates on copies of commodity/recipe data.
   */
  async executeSimulation(
    params: SimulationInputParameters,
  ): Promise<SimulationOutputResults> {
    const {
      simulatedDays,
      basePrices = {},
      productionTimes = {},
      yields = {},
      recipeProcessingTimes = {},
      factoryEfficiency = 100,
      productionCyclesPerDay = 1,
      playerCount = 10,
      demandRates = {},
    } = params;

    // Load current commodity and recipe data as simulation baseline
    const commodities = await this.commodityRepository.find({
      where: { active: true },
    });
    const recipes = await this.recipeRepository.find({
      where: { active: true },
      relations: ['inputs', 'outputCommodity'],
    });

    // Build commodity lookup with parameter overrides applied
    const commodityMap = new Map<string, {
      slug: string;
      name: string;
      category: string;
      level: number;
      basePrice: number;
      baseYield: number;
      productionTimeMinutes: number;
    }>();

    for (const c of commodities) {
      commodityMap.set(c.slug, {
        slug: c.slug,
        name: c.name,
        category: c.category,
        level: c.level,
        basePrice: basePrices[c.slug] ?? parseFloat(c.basePrice),
        baseYield: yields[c.slug] ?? c.baseYield,
        productionTimeMinutes: productionTimes[c.slug] ?? c.baseProductionTimeMinutes,
      });
    }

    // Build recipe lookup with overrides
    const recipeList = recipes.map((r) => ({
      slug: r.slug,
      name: r.name,
      outputSlug: r.outputCommodity?.slug ?? '',
      outputQuantity: r.outputQuantity,
      processingTimeMinutes: recipeProcessingTimes[r.slug] ?? r.processingTimeMinutes,
      inputs: (r.inputs ?? []).map((i) => ({
        commodityId: i.commodityId,
        quantity: i.quantity,
      })),
      factoryCategory: r.factoryCategory,
    }));

    // --- Simulation State ---
    // Per-commodity daily tracking
    const dailySupply: Record<string, number[]> = {};
    const dailyDemand: Record<string, number[]> = {};
    const priceTrajectories: Record<string, number[]> = {};
    const cumulativeSupply: Record<string, number> = {};
    const cumulativeDemand: Record<string, number> = {};

    for (const [slug] of commodityMap) {
      dailySupply[slug] = [];
      dailyDemand[slug] = [];
      priceTrajectories[slug] = [];
      cumulativeSupply[slug] = 0;
      cumulativeDemand[slug] = 0;
    }

    // --- Day-by-Day Simulation Loop ---
    for (let day = 1; day <= simulatedDays; day++) {
      for (const [slug, commodity] of commodityMap) {
        // Calculate daily production for L0 commodities
        let dailyProd = 0;
        if (commodity.level === 0) {
          const effectiveTime = calculateEffectiveProductionTime(
            commodity.productionTimeMinutes,
            factoryEfficiency,
          );
          const finalYield = calculateFinalYield(commodity.baseYield, [
            { bonus: 0.10 }, // specialty bonus
          ]);
          // Production cycles per day based on time
          const minutesPerDay = 24 * 60;
          const cyclesFromTime = Math.floor(minutesPerDay / effectiveTime);
          const effectiveCycles = Math.min(cyclesFromTime, productionCyclesPerDay);
          dailyProd = finalYield * effectiveCycles * playerCount;
        }

        // Calculate daily production for processed commodities (L1/L2) via recipes
        for (const recipe of recipeList) {
          if (recipe.outputSlug === slug) {
            const effectiveTime = calculateEffectiveProductionTime(
              recipe.processingTimeMinutes,
              factoryEfficiency,
            );
            const minutesPerDay = 24 * 60;
            const cyclesFromTime = Math.floor(minutesPerDay / effectiveTime);
            const effectiveCycles = Math.min(cyclesFromTime, productionCyclesPerDay);
            dailyProd += recipe.outputQuantity * effectiveCycles * Math.ceil(playerCount * 0.5);
          }
        }

        // Demand: base marketplace purchases + shop consumption
        const baseDemandRate = demandRates[slug] ?? (commodity.basePrice > 50 ? 5 : 10);
        const dailyDem = baseDemandRate * playerCount;

        // Accumulate supply and demand
        cumulativeSupply[slug] += dailyProd;
        cumulativeDemand[slug] += dailyDem;

        dailySupply[slug].push(dailyProd);
        dailyDemand[slug].push(dailyDem);

        // Calculate price using dynamic pricing formula
        let supplyMultiplier = 1.0;
        let demandMultiplier = 1.0;

        if (day > this.STABILIZATION_DAYS) {
          // Supply multiplier: higher supply → lower price
          const supplyRatio = dailyProd > 0 ? cumulativeSupply[slug] / (cumulativeDemand[slug] || 1) : 1;
          supplyMultiplier = Math.max(
            this.MULTIPLIER_MIN,
            Math.min(this.MULTIPLIER_MAX, 1 / supplyRatio),
          );

          // Demand multiplier: higher demand → higher price
          const demandRatio = dailyDem > 0 ? cumulativeDemand[slug] / (cumulativeSupply[slug] || 1) : 1;
          demandMultiplier = Math.max(
            this.MULTIPLIER_MIN,
            Math.min(this.MULTIPLIER_MAX, demandRatio),
          );
        }

        const price = calculateDynamicPrice(
          commodity.basePrice,
          supplyMultiplier,
          demandMultiplier,
        );
        priceTrajectories[slug].push(price);
      }
    }

    // --- Compute Chain Earnings ---
    const chainEarnings = this.computeChainEarnings(
      recipeList,
      commodityMap,
      priceTrajectories,
      simulatedDays,
      productionCyclesPerDay,
      playerCount,
      factoryEfficiency,
    );

    // --- Compute Equilibrium Points ---
    const equilibriumPoints: Record<string, number | null> = {};
    for (const [slug] of commodityMap) {
      const supply = dailySupply[slug];
      const demand = dailyDemand[slug];
      let eqDay: number | null = null;
      for (let d = 0; d < simulatedDays; d++) {
        if (Math.abs(supply[d] - demand[d]) <= Math.max(supply[d], demand[d]) * 0.1) {
          eqDay = d + 1;
          break;
        }
      }
      equilibriumPoints[slug] = eqDay;
    }

    // --- Flow Ratios (production / consumption) ---
    const flowRatios: Record<string, number> = {};
    for (const [slug] of commodityMap) {
      const totalSupply = cumulativeSupply[slug];
      const totalDemand = cumulativeDemand[slug];
      flowRatios[slug] = totalDemand > 0 ? totalSupply / totalDemand : 0;
    }

    // --- Commodity Projections ---
    const commodityProjections: CommodityProjection[] = [];
    for (const [slug, commodity] of commodityMap) {
      const trajectory = priceTrajectories[slug];
      const avgDailyProd = dailySupply[slug].reduce((s, v) => s + v, 0) / simulatedDays;
      commodityProjections.push({
        slug,
        name: commodity.name,
        category: commodity.category,
        level: commodity.level,
        dailyProduction: avgDailyProd,
        priceTrajectory: trajectory,
        cumulativeSupply: cumulativeSupply[slug],
        cumulativeDemand: cumulativeDemand[slug],
        finalPrice: trajectory[trajectory.length - 1] ?? commodity.basePrice,
      });
    }

    // --- Summary ---
    const priceVolatilities: number[] = [];
    for (const [slug] of commodityMap) {
      const traj = priceTrajectories[slug];
      if (traj.length > 1) {
        const mean = traj.reduce((s, v) => s + v, 0) / traj.length;
        const variance = traj.reduce((s, v) => s + (v - mean) ** 2, 0) / traj.length;
        priceVolatilities.push(Math.sqrt(variance) / (mean || 1));
      }
    }
    const avgVolatility = priceVolatilities.length > 0
      ? priceVolatilities.reduce((s, v) => s + v, 0) / priceVolatilities.length
      : 0;

    const sortedChains = [...chainEarnings].sort((a, b) => b.netProfit - a.netProfit);
    const mostProfitable = sortedChains[0]?.chainName ?? 'N/A';
    const leastProfitable = sortedChains[sortedChains.length - 1]?.chainName ?? 'N/A';

    return {
      chainEarnings,
      commodityProjections,
      equilibriumPoints,
      flowRatios,
      summary: {
        totalDaysSimulated: simulatedDays,
        totalCommoditiesModeled: commodityProjections.length,
        averagePriceVolatility: Math.round(avgVolatility * 10000) / 10000,
        mostProfitableChain: mostProfitable,
        leastProfitableChain: leastProfitable,
      },
    };
  }

  /**
   * Compute earnings for each production chain (L0 → L1 → sale).
   */
  private computeChainEarnings(
    recipes: Array<{
      slug: string;
      name: string;
      outputSlug: string;
      outputQuantity: number;
      processingTimeMinutes: number;
      inputs: Array<{ commodityId: string; quantity: number }>;
      factoryCategory: string;
    }>,
    commodityMap: Map<string, {
      slug: string;
      name: string;
      category: string;
      level: number;
      basePrice: number;
      baseYield: number;
      productionTimeMinutes: number;
    }>,
    priceTrajectories: Record<string, number[]>,
    simulatedDays: number,
    cyclesPerDay: number,
    playerCount: number,
    factoryEfficiency: number,
  ): ChainEarnings[] {
    const earnings: ChainEarnings[] = [];

    // Build slug-by-id lookup from commodityMap for recipe input matching
    // (recipes reference commodity IDs but we work with slugs in simulation)
    // For simulation purposes we'll match by the output commodity slug
    for (const recipe of recipes) {
      const outputCommodity = commodityMap.get(recipe.outputSlug);
      if (!outputCommodity) continue;

      // Find input commodities (match by checking which L0 commodities feed this recipe)
      // In simulation, we estimate input cost from base prices of the recipe's category L0 items
      const inputSlugs: string[] = [];
      for (const [slug, c] of commodityMap) {
        if (c.level === 0 && c.category === outputCommodity.category) {
          inputSlugs.push(slug);
        }
      }

      // Calculate total revenue from selling output over simulation period
      const outputPrices = priceTrajectories[recipe.outputSlug] ?? [];
      const effectiveTime = calculateEffectiveProductionTime(
        recipe.processingTimeMinutes,
        factoryEfficiency,
      );
      const minutesPerDay = 24 * 60;
      const cyclesFromTime = Math.floor(minutesPerDay / effectiveTime);
      const dailyCycles = Math.min(cyclesFromTime, cyclesPerDay);
      const dailyOutput = recipe.outputQuantity * dailyCycles;

      let totalRevenue = 0;
      for (let d = 0; d < simulatedDays; d++) {
        const price = outputPrices[d] ?? outputCommodity.basePrice;
        totalRevenue += dailyOutput * price;
      }

      // Calculate input cost (average price of inputs over simulation)
      let totalInputCost = 0;
      for (const inputSlug of inputSlugs) {
        const inputPrices = priceTrajectories[inputSlug] ?? [];
        const inputCommodity = commodityMap.get(inputSlug);
        if (!inputCommodity) continue;
        for (let d = 0; d < simulatedDays; d++) {
          const price = inputPrices[d] ?? inputCommodity.basePrice;
          totalInputCost += price * dailyCycles; // 1 unit input per cycle (simplified)
        }
      }

      const netProfit = totalRevenue - totalInputCost;
      const chainName = inputSlugs.length > 0
        ? `${inputSlugs[0]} → ${recipe.name}`
        : recipe.name;

      earnings.push({
        chainName,
        totalRevenue: Math.round(totalRevenue * 100) / 100,
        totalInputCost: Math.round(totalInputCost * 100) / 100,
        netProfit: Math.round(netProfit * 100) / 100,
        dailyProfit: Math.round((netProfit / simulatedDays) * 100) / 100,
      });
    }

    return earnings;
  }

  /**
   * Get all commodities from the database, grouped by level.
   */
  async getCommoditiesFromDb(): Promise<Record<string, unknown[]>> {
    const commodities = await this.commodityRepository.find({
      where: { active: true },
      order: { level: 'ASC', name: 'ASC' },
    });

    const grouped: Record<string, unknown[]> = {};
    for (const c of commodities) {
      const key = `level_${c.level}`;
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push({
        slug: c.slug,
        name: c.name,
        category: c.category,
        level: c.level,
        base_price: parseFloat(c.basePrice),
        production_time_minutes: c.baseProductionTimeMinutes,
        base_yield: c.baseYield,
        storage_size: c.storageSize,
        max_workers: c.maxWorkers,
        terrain_requirement: c.terrainRequirement,
        land_layout: c.landLayout,
        setup_cost: c.setupCost ? parseFloat(c.setupCost) : 0,
      });
    }
    return grouped;
  }

  /**
   * Get all recipes from the database with their inputs, grouped by output commodity level.
   */
  async getRecipesFromDb(): Promise<Record<string, unknown[]>> {
    const recipes = await this.recipeRepository.find({
      where: { active: true },
      relations: ['inputs', 'inputs.commodity', 'outputCommodity'],
      order: { name: 'ASC' },
    });

    const grouped: Record<string, unknown[]> = {};
    for (const r of recipes) {
      const outputLevel = r.outputCommodity?.level ?? 1;
      const key = `level_${outputLevel}`;
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push({
        slug: r.slug,
        name: r.name,
        factory_category: r.factoryCategory,
        processing_time_minutes: r.processingTimeMinutes,
        worker_requirement: r.workerRequirement,
        inputs: (r.inputs || []).map((i: any) => ({
          commodity_slug: i.commodity?.slug || i.commodityId,
          quantity: i.quantity,
        })),
        output: {
          commodity_slug: r.outputCommodity?.slug || '',
          quantity: r.outputQuantity,
        },
      });
    }
    return grouped;
  }


  /**
   * Get all commodities merged with their recipe data (if any) in a single flat list.
   * For L1/L2 commodities, includes the recipe inputs and processing time.
   */
  async getCombinedCommodityData(): Promise<unknown[]> {
    const commodities = await this.commodityRepository.find({
      where: { active: true },
      order: { level: 'ASC', category: 'ASC', name: 'ASC' },
    });

    const recipes = await this.recipeRepository.find({
      where: { active: true },
      relations: ['inputs', 'inputs.commodity', 'outputCommodity'],
    });

    // Map recipes by output commodity ID for quick lookup
    const recipeByOutputId = new Map<string, any>();
    for (const r of recipes) {
      if (r.outputCommodity) {
        recipeByOutputId.set(r.outputCommodity.id, r);
      }
    }

    return commodities.map((c) => {
      const recipe = recipeByOutputId.get(c.id);
      return {
        id: c.id,
        slug: c.slug,
        name: c.name,
        category: c.category,
        level: c.level,
        base_price: parseFloat(c.basePrice),
        production_time_minutes: recipe ? recipe.processingTimeMinutes : c.baseProductionTimeMinutes,
        base_yield: recipe ? recipe.outputQuantity : c.baseYield,
        storage_size: c.storageSize,
        setup_cost: c.setupCost ? parseFloat(c.setupCost) : 0,
        recipe_inputs: recipe
          ? (recipe.inputs || []).map((i: any) => ({
              commodity_slug: i.commodity?.slug || '',
              commodity_name: i.commodity?.name || '',
              quantity: i.quantity,
            }))
          : [],
        recipe_id: recipe?.id || null,
        recipe_slug: recipe?.slug || null,
      };
    });
  }

  /**
   * Update a single commodity's editable fields.
   */
  async updateCommodity(
    commodityId: string,
    updates: { base_price?: number; production_time_minutes?: number; base_yield?: number; storage_size?: number; setup_cost?: number },
  ): Promise<void> {
    const updateFields: Record<string, unknown> = {};
    if (updates.base_price !== undefined) updateFields.basePrice = updates.base_price.toFixed(2);
    if (updates.storage_size !== undefined) updateFields.storageSize = updates.storage_size;
    if (updates.setup_cost !== undefined) updateFields.setupCost = updates.setup_cost.toFixed(2);

    // For L0: update baseProductionTimeMinutes and baseYield on commodity
    if (updates.production_time_minutes !== undefined) updateFields.baseProductionTimeMinutes = updates.production_time_minutes;
    if (updates.base_yield !== undefined) updateFields.baseYield = updates.base_yield;

    if (Object.keys(updateFields).length > 0) {
      await this.commodityRepository.update(commodityId, updateFields);
    }
  }

  /**
   * Update a recipe's processing time and output quantity.
   */
  async updateRecipe(
    recipeId: string,
    updates: { processing_time_minutes?: number; output_quantity?: number },
  ): Promise<void> {
    const updateFields: Record<string, unknown> = {};
    if (updates.processing_time_minutes !== undefined) updateFields.processingTimeMinutes = updates.processing_time_minutes;
    if (updates.output_quantity !== undefined) updateFields.outputQuantity = updates.output_quantity;

    if (Object.keys(updateFields).length > 0) {
      await this.recipeRepository.update(recipeId, updateFields);
    }
  }


  /**
   * Update recipe inputs (delete existing and recreate).
   */
  async updateRecipeInputs(
    recipeId: string,
    inputs: Array<{ commodity_slug: string; quantity: number }>,
  ): Promise<void> {
    // Delete existing inputs
    await this.recipeInputRepository.delete({ recipeId });

    // Insert new inputs
    for (const inp of inputs) {
      // Look up commodity by slug
      const commodity = await this.commodityRepository.findOne({ where: { slug: inp.commodity_slug } });
      if (!commodity) continue;

      const recipeInput = this.recipeInputRepository.create({
        recipeId,
        commodityId: commodity.id,
        quantity: inp.quantity,
      });
      await this.recipeInputRepository.save(recipeInput);
    }
  }


  /**
   * Generate extra random workers for the active season.
   * Loads salary config from game_config if available.
   */
  async generateExtraWorkers(count: number): Promise<{ generated: number; seasonId: string }> {
    // Find active season via raw query
    const seasonRows = await this.commodityRepository.manager.query(
      "SELECT id FROM seasons WHERE status = 'ACTIVE' ORDER BY starts_at DESC LIMIT 1",
    );
    if (!seasonRows || seasonRows.length === 0) {
      throw new Error('No active season found');
    }
    const seasonId = seasonRows[0].id;

    // Load salary config (specialty-based with per-level salary)
    let specialtyConfigs: Record<string, number[]> = {
      farmer: [10, 12, 15, 18, 22],
      driller: [14, 17, 21, 25, 31],
      miner: [13, 16, 20, 24, 30],
      rancher: [11, 13, 16, 19, 24],
      fisherman: [10, 12, 15, 18, 22],
      lumberjack: [11, 13, 16, 19, 24],
      shopkeeper: [12, 15, 18, 22, 28],
      engineer: [20, 25, 32, 40, 50],
      technician: [30, 38, 48, 60, 75],
    };

    try {
      const configRows = await this.commodityRepository.manager.query(
        "SELECT value FROM game_config WHERE key = 'salary_config'",
      );
      if (configRows && configRows.length > 0 && configRows[0].value) {
        const val = configRows[0].value;
        if (val.specialties) {
          specialtyConfigs = {};
          for (const s of val.specialties) {
            specialtyConfigs[s.key] = s.baseSalary;
          }
        }
      }
    } catch { /* use defaults */ }

    const FIRST_NAMES_MALE = ['Ahmad','Budi','Cahya','Dimas','Eko','Fajar','Gilang','Hadi','Irfan','Joko','Kurnia','Lukman','Maulana','Naufal','Omar','Prasetyo','Rizky','Surya','Taufik','Umar'];
    const FIRST_NAMES_FEMALE = ['Ayu','Bunga','Citra','Dewi','Eka','Fitri','Gita','Hani','Indah','Jasmine','Kartika','Lestari','Maya','Nisa','Oktavia','Putri','Rani','Sari','Tika','Utami'];
    const LAST_NAMES = ['Wijaya','Santoso','Pratama','Putra','Sari','Utomo','Hidayat','Susanto','Nugroho','Saputra','Wibowo','Kurniawan','Setiawan','Permana','Rahman'];
    const SPECIALTIES = ['farmer','miner','fisherman','driller','rancher','lumberjack','shopkeeper','engineer','technician'];

    const workers: any[] = [];
    for (let i = 0; i < count; i++) {
      const gender = Math.random() < 0.5 ? 'male' : 'female';
      const firstNames = gender === 'male' ? FIRST_NAMES_MALE : FIRST_NAMES_FEMALE;
      const firstName = firstNames[Math.floor(Math.random() * firstNames.length)];
      const lastName = LAST_NAMES[Math.floor(Math.random() * LAST_NAMES.length)];
      const age = 18 + Math.floor(Math.random() * 32);
      const specialty = SPECIALTIES[Math.floor(Math.random() * SPECIALTIES.length)];
      const experienceLevel = 1 + Math.floor(Math.random() * 5);
      const commitmentLevel = 70 + Math.floor(Math.random() * 31);

      // Look up salary from config: specialtyConfigs[specialty][experienceLevel-1]
      const salaryLevels = specialtyConfigs[specialty] || [10, 12, 15, 18, 22];
      const baseSalary = salaryLevels[experienceLevel - 1] || salaryLevels[0];
      // Add small random variance ±10%
      const variance = 0.9 + Math.random() * 0.2;
      const salary = Math.round(baseSalary * variance * 100) / 100;

      workers.push({
        name: firstName + ' ' + lastName,
        age,
        gender,
        specialty,
        salary: salary.toFixed(2),
        experienceLevel,
        commitmentLevel: commitmentLevel.toFixed(2),
        seasonId,
        unlocked: true,
      });
    }

    // Batch insert using raw query
    for (const w of workers) {
      await this.commodityRepository.manager.query(
        `INSERT INTO worker_profiles (id, name, age, gender, specialty, salary, experience_level, commitment_level, season_id, unlocked)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [w.name, w.age, w.gender, w.specialty, w.salary, w.experienceLevel, w.commitmentLevel, w.seasonId, w.unlocked],
      );
    }

    return { generated: count, seasonId };
  }

}
