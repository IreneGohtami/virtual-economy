import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  calculateDynamicPrice,
  calculateFinalYield,
  calculateEffectiveProductionTime,
  calculateLandPrice,
  calculateLoanInstallment,
  calculateNetWorth,
} from '@sea-commodity-tycoon/game-rules';
import { SimulationRun } from '../entities/simulation-run.entity';
import { Commodity } from '../entities/commodity.entity';
import { Recipe } from '../entities/recipe.entity';
import { RecipeInput } from '../entities/recipe-input.entity';

// ---------- Enums & Types ----------

type PlayerArchetype = 'conservative' | 'balanced' | 'aggressive';
type EventFrequency = 'low' | 'medium' | 'high';

const L0_CATEGORIES = ['Agriculture', 'Livestock', 'Fishery', 'Forestry', 'Metal', 'Energy'] as const;
type L0Category = (typeof L0_CATEGORIES)[number];

// Terrain distribution for map capacity analysis
const TERRAIN_DISTRIBUTION: Record<string, number> = {
  Water: 0.15,
  'Fertile Soil': 0.25,
  Farmland: 0.25,
  Mountain: 0.20,
  City: 0.15,
};

// Category weights for random specialty assignment
const CATEGORY_WEIGHTS: Record<L0Category, number> = {
  Agriculture: 0.22,
  Livestock: 0.18,
  Fishery: 0.15,
  Forestry: 0.15,
  Metal: 0.15,
  Energy: 0.15,
};

// ---------- Simulation Interfaces ----------

interface SimulatedFactory {
  category: string;
  level: number;
  efficiency: number;
}

interface ActiveLoan {
  principal: number;
  outstandingBalance: number;
  interestRate: number;
  numInstallments: number;
  installmentsPaid: number;
  dayTaken: number;
}

interface SimulatedPlayer {
  id: number;
  archetype: PlayerArchetype;
  coins: number;
  specialty: L0Category;
  tilesOwned: number;
  factories: SimulatedFactory[];
  workersHired: number;
  inventory: Record<string, number>;
  storageCapacity: number;
  storageUsed: number;
  activeLoans: ActiveLoan[];
  happiness: number;
  netWorth: number;
  initialCoins: number;
  survived: boolean;
  shopsBuilt: number;
}

interface RandomEvent {
  type: string;
  day: number;
  duration: number;
  affectedCategory: string;
  productionModifier: number;
  demandModifier: number;
  impact: string;
}

interface CommodityData {
  slug: string;
  name: string;
  category: string;
  level: number;
  basePrice: number;
  baseYield: number;
  productionTimeMinutes: number;
  terrainRequirement: string | null;
  setupCost: number;
  storageSize: number;
}

interface RecipeData {
  slug: string;
  name: string;
  outputSlug: string;
  outputQuantity: number;
  processingTimeMinutes: number;
  factoryCategory: string;
  inputs: { commoditySlug: string; quantity: number }[];
}

// ---------- Report Interfaces ----------

export interface AdvancedSimulationReport {
  playerCount: number;
  simulatedDays: number;
  mapSize: { width: number; height: number };

  mapCapacity: {
    totalTiles: number;
    tilesPerTerrain: Record<string, number>;
    tilesNeededPerPlayer: number;
    totalTilesNeeded: number;
    saturationPercent: number;
    sufficient: boolean;
    terrainBottlenecks: string[];
  };

  economyHealth: {
    isBalanced: boolean;
    averageNetWorth: number;
    medianNetWorth: number;
    topPlayerNetWorth: number;
    bottomPlayerNetWorth: number;
    giniCoefficient: number;
    wealthDistribution: { bracket: string; count: number; percentage: number }[];
  };

  strategyAnalysis: {
    conservative: { avgNetWorth: number; avgROI: number; survivedPercent: number };
    balanced: { avgNetWorth: number; avgROI: number; survivedPercent: number };
    aggressive: { avgNetWorth: number; avgROI: number; survivedPercent: number };
    dominantStrategy: string | null;
  };

  marketplaceLiquidity: {
    avgDailyVolume: number;
    liquidCommodities: string[];
    illiquidCommodities: string[];
    averageFillRate: number;
  };

  loanAnalysis: {
    totalLoansTaken: number;
    avgLoanAmount: number;
    defaultRate: number;
    avgRepaymentDays: number;
    sustainable: boolean;
  };

  priceAnalysis: {
    avgVolatility: number;
    mostVolatileCommodity: string;
    leastVolatileCommodity: string;
    priceTrajectories: Record<string, number[]>;
    stabilizationEffective: boolean;
  };

  eventImpact: {
    eventsTriggered: { type: string; day: number; duration: number; impact: string }[];
    avgPriceImpact: number;
    recoveryDays: number;
  };

  l2Viability: {
    canBreakEvenByDay15: boolean;
    avgBreakEvenDay: number;
    l2ProducerCount: number;
    l2ProfitMargin: number;
  };

  recommendations: string[];
}

export interface AdvancedSimulationParams {
  playerCount: number;
  days: number;
  mapWidth?: number;
  mapHeight?: number;
  eventFrequency?: EventFrequency;
}

// ---------- Service ----------

@Injectable()
export class AdvancedSimulationService {
  private readonly logger = new Logger(AdvancedSimulationService.name);

  private readonly STABILIZATION_DAYS = 7;
  private readonly MULTIPLIER_MIN = 0.5;
  private readonly MULTIPLIER_MAX = 2.0;
  private readonly LOAN_INTEREST_RATE = 0.02;
  private readonly LOAN_INSTALLMENTS = 6;
  private readonly WORKER_SALARY = 20;
  private readonly CITY_UNLOCK_DAY = 6;

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
   * Run the advanced simulation and persist results.
   */
  async runAdvancedSimulation(
    operatorId: string,
    params: AdvancedSimulationParams,
  ): Promise<SimulationRun> {
    const run = this.simulationRunRepository.create({
      operatorId,
      inputParameters: params as unknown as Record<string, unknown>,
      simulatedDays: params.days,
      status: 'RUNNING',
      startedAt: new Date(),
    });
    const savedRun = await this.simulationRunRepository.save(run);

    try {
      const report = await this.executeAdvancedSimulation(params);
      savedRun.outputResults = report as unknown as Record<string, unknown>;
      savedRun.status = 'COMPLETED';
      savedRun.completedAt = new Date();
    } catch (error) {
      savedRun.status = 'FAILED';
      savedRun.completedAt = new Date();
      savedRun.outputResults = {
        error: error instanceof Error ? error.message : 'Unknown error',
      };
      this.logger.error(`Advanced simulation ${savedRun.id} failed`, error);
    }

    return this.simulationRunRepository.save(savedRun);
  }

  /**
   * Core simulation engine — runs entirely in memory.
   */
  async executeAdvancedSimulation(
    params: AdvancedSimulationParams,
  ): Promise<AdvancedSimulationReport> {
    const {
      playerCount,
      days,
      mapWidth = 100,
      mapHeight = 100,
      eventFrequency = 'medium',
    } = params;

    // Load commodity and recipe data
    const { commodityMap, recipeList } = await this.loadGameData();

    // Initialize players
    const players = this.initializePlayers(playerCount);

    // Generate random events schedule
    const events = this.generateRandomEvents(days, eventFrequency);

    // Marketplace state
    const marketSupply: Record<string, number> = {};
    const marketDemand: Record<string, number> = {};
    const priceTrajectories: Record<string, number[]> = {};
    const dailyVolumes: number[] = [];

    // Initialize market tracking
    for (const [slug] of commodityMap) {
      marketSupply[slug] = 0;
      marketDemand[slug] = 0;
      priceTrajectories[slug] = [];
    }

    // Track active events
    const activeEvents: Array<RandomEvent & { endsOnDay: number }> = [];

    // Loan tracking
    let totalLoansTaken = 0;
    let totalLoanAmount = 0;
    let totalRepaymentDays = 0;
    let loansRepaid = 0;
    let loansDefaulted = 0;

    // L2 tracking
    const l2BreakEvenDays: number[] = [];
    const l2DailyCosts: Record<number, number> = {};
    const l2DailyRevenue: Record<number, number> = {};

    // --- Day-by-day simulation ---
    for (let day = 1; day <= days; day++) {
      // Activate new events for this day
      for (const event of events) {
        if (event.day === day) {
          activeEvents.push({ ...event, endsOnDay: day + event.duration });
        }
      }
      // Remove expired events
      for (let i = activeEvents.length - 1; i >= 0; i--) {
        if (day >= activeEvents[i].endsOnDay) {
          activeEvents.splice(i, 1);
        }
      }

      // Calculate production modifiers from active events
      const productionMods: Record<string, number> = {};
      const demandMods: Record<string, number> = {};
      for (const event of activeEvents) {
        const cat = event.affectedCategory;
        productionMods[cat] = (productionMods[cat] ?? 1) * (1 + event.productionModifier);
        demandMods[cat] = (demandMods[cat] ?? 1) * (1 + event.demandModifier);
      }

      // Calculate current prices
      const currentPrices: Record<string, number> = {};
      for (const [slug, commodity] of commodityMap) {
        let supplyMult = 1.0;
        let demandMult = 1.0;

        if (day > this.STABILIZATION_DAYS) {
          const totalSup = marketSupply[slug] || 1;
          const totalDem = marketDemand[slug] || 1;
          const supplyRatio = totalSup / totalDem;
          supplyMult = Math.max(this.MULTIPLIER_MIN, Math.min(this.MULTIPLIER_MAX, 1 / supplyRatio));
          demandMult = Math.max(this.MULTIPLIER_MIN, Math.min(this.MULTIPLIER_MAX, totalDem / totalSup));
        }

        // Apply event demand modifiers
        const categoryDemandMod = demandMods[commodity.category] ?? 1;
        demandMult = Math.max(
          this.MULTIPLIER_MIN,
          Math.min(this.MULTIPLIER_MAX, demandMult * categoryDemandMod),
        );

        const price = calculateDynamicPrice(commodity.basePrice, supplyMult, demandMult);
        currentPrices[slug] = price;
        priceTrajectories[slug].push(Math.round(price * 100) / 100);
      }

      let dailyVolume = 0;

      // Process each player's actions for this day
      for (const player of players) {
        if (!player.survived) continue;

        // --- Happiness decay ---
        player.happiness = Math.max(0, player.happiness - 1);

        // --- Pay worker salaries ---
        const salaryCost = player.workersHired * this.WORKER_SALARY;
        player.coins -= salaryCost;

        // --- Loan installments (every 5 days) ---
        if (day % 5 === 0) {
          for (let i = player.activeLoans.length - 1; i >= 0; i--) {
            const loan = player.activeLoans[i];
            const installment = calculateLoanInstallment(
              loan.principal,
              loan.outstandingBalance,
              loan.interestRate,
              loan.numInstallments,
            );
            if (player.coins >= installment * 0.5) {
              // Pay what we can (at least half)
              const payment = Math.min(installment, player.coins * 0.5);
              player.coins -= payment;
              loan.outstandingBalance -= payment * 0.8; // 80% goes to principal
              loan.installmentsPaid++;
              if (loan.outstandingBalance <= 0 || loan.installmentsPaid >= loan.numInstallments) {
                totalRepaymentDays += day - loan.dayTaken;
                loansRepaid++;
                player.activeLoans.splice(i, 1);
              }
            } else {
              // Can't pay even half — small penalty but don't spiral
              loan.outstandingBalance += loan.outstandingBalance * 0.01;
            }
          }
        }

        // --- Survival check ---
        if (player.coins < -200) {
          player.survived = false;
          loansDefaulted += player.activeLoans.length;
          continue;
        }

        // --- Buy happiness boosts ---
        if (player.happiness < 50 && player.coins > 200) {
          player.coins -= 100;
          player.happiness = Math.min(100, player.happiness + 20);
        }

        // --- Archetype-driven actions ---
        this.executePlayerActions(
          player,
          day,
          commodityMap,
          recipeList,
          currentPrices,
          productionMods,
        );

        // --- Trade on marketplace ---
        const tradeResult = this.executeMarketplaceTrade(
          player,
          commodityMap,
          recipeList,
          currentPrices,
        );
        dailyVolume += tradeResult.volume;
        for (const [slug, qty] of Object.entries(tradeResult.sold)) {
          marketSupply[slug] = (marketSupply[slug] || 0) + qty;
        }
        for (const [slug, qty] of Object.entries(tradeResult.bought)) {
          marketDemand[slug] = (marketDemand[slug] || 0) + qty;
        }

        // --- Take loans ---
        if (this.shouldTakeLoan(player, day)) {
          const loanAmount = this.calculateLoanAmount(player);
          if (loanAmount > 0) {
            player.activeLoans.push({
              principal: loanAmount,
              outstandingBalance: loanAmount,
              interestRate: this.LOAN_INTEREST_RATE,
              numInstallments: this.LOAN_INSTALLMENTS,
              installmentsPaid: 0,
              dayTaken: day,
            });
            player.coins += loanAmount;
            totalLoansTaken++;
            totalLoanAmount += loanAmount;
          }
        }

        // --- Upgrade storage ---
        if (player.storageUsed > player.storageCapacity * 0.8) {
          const upgradeCost = 200;
          if (player.coins >= upgradeCost) {
            player.coins -= upgradeCost;
            player.storageCapacity += 250;
          }
        }

        // --- Build shops (balanced/aggressive, after city unlock) ---
        // Build shops (all archetypes eventually, aggressive earlier and more)
        const shopDay = player.archetype === 'aggressive' ? this.CITY_UNLOCK_DAY + 2 : 
                        player.archetype === 'balanced' ? this.CITY_UNLOCK_DAY + 5 : this.CITY_UNLOCK_DAY + 10;
        const maxShops = player.archetype === 'aggressive' ? 4 : player.archetype === 'balanced' ? 2 : 1;
        if (day > shopDay && player.shopsBuilt < maxShops && player.coins > 400) {
          player.coins -= 250;
          player.shopsBuilt++;
        }

        // --- Shop revenue ---
        if (player.shopsBuilt > 0) {
          // Shop revenue scales with inventory level and market prices
          const shopRevenue = player.shopsBuilt * 60; // ~60 coins/day/shop from auto-consumption
          player.coins += shopRevenue;
        }

        // --- L2 tracking ---
        const l2Factories = player.factories.filter((f) => f.level === 2);
        if (l2Factories.length > 0) {
          const playerId = player.id;
          if (!l2DailyCosts[playerId]) l2DailyCosts[playerId] = 0;
          if (!l2DailyRevenue[playerId]) l2DailyRevenue[playerId] = 0;
          // Rough cost: worker salary + input costs
          l2DailyCosts[playerId] += l2Factories.length * this.WORKER_SALARY * 2;
          // Revenue tracked via trades (simplified)
          l2DailyRevenue[playerId] += l2Factories.length * 50;
          if (
            l2DailyRevenue[playerId] > l2DailyCosts[playerId] &&
            !l2BreakEvenDays.includes(playerId)
          ) {
            l2BreakEvenDays.push(day);
          }
        }

        // --- Update net worth ---
        const totalDebt = player.activeLoans.reduce((s, l) => s + l.outstandingBalance, 0);
        const inventoryValue = Object.entries(player.inventory).reduce((sum, [slug, qty]) => {
          return sum + (currentPrices[slug] || 0) * qty;
        }, 0);
        const factoryValue = player.factories.reduce((sum, f) => sum + (f.level + 1) * 200, 0);
        const landValue = player.tilesOwned * 30;

        player.netWorth = calculateNetWorth(
          player.coins,
          landValue,
          factoryValue,
          inventoryValue,
          totalDebt,
        );
      }

      dailyVolumes.push(dailyVolume);
    }

    // --- Compile report ---
    return this.compileReport(
      params,
      players,
      priceTrajectories,
      commodityMap,
      events,
      dailyVolumes,
      totalLoansTaken,
      totalLoanAmount,
      loansDefaulted,
      loansRepaid,
      totalRepaymentDays,
      l2BreakEvenDays,
      mapWidth,
      mapHeight,
    );
  }

  // ---------- Data Loading ----------

  private async loadGameData(): Promise<{
    commodityMap: Map<string, CommodityData>;
    recipeList: RecipeData[];
  }> {
    const commodities = await this.commodityRepository.find({ where: { active: true } });
    const recipes = await this.recipeRepository.find({
      where: { active: true },
      relations: ['inputs', 'inputs.commodity', 'outputCommodity'],
    });

    const commodityMap = new Map<string, CommodityData>();
    for (const c of commodities) {
      commodityMap.set(c.slug, {
        slug: c.slug,
        name: c.name,
        category: c.category,
        level: c.level,
        basePrice: parseFloat(c.basePrice),
        baseYield: c.baseYield,
        productionTimeMinutes: c.baseProductionTimeMinutes,
        terrainRequirement: c.terrainRequirement,
        setupCost: c.setupCost ? parseFloat(c.setupCost) : 0,
        storageSize: c.storageSize,
      });
    }

    const recipeList: RecipeData[] = recipes.map((r) => ({
      slug: r.slug,
      name: r.name,
      outputSlug: r.outputCommodity?.slug ?? '',
      outputQuantity: r.outputQuantity,
      processingTimeMinutes: r.processingTimeMinutes,
      factoryCategory: r.factoryCategory,
      inputs: (r.inputs ?? []).map((i) => ({
        commoditySlug: i.commodity?.slug ?? '',
        quantity: i.quantity,
      })),
    }));

    return { commodityMap, recipeList };
  }

  // ---------- Player Initialization ----------

  private initializePlayers(count: number): SimulatedPlayer[] {
    const players: SimulatedPlayer[] = [];
    for (let i = 0; i < count; i++) {
      const archetype = this.randomArchetype();
      const specialty = this.randomSpecialty();
      players.push({
        id: i,
        archetype,
        coins: 2000,
        specialty,
        tilesOwned: 0,
        factories: [],
        workersHired: 0,
        inventory: {},
        storageCapacity: 500,
        storageUsed: 0,
        activeLoans: [],
        happiness: 80,
        netWorth: 1000,
        initialCoins: 2000,
        survived: true,
        shopsBuilt: 0,
      });
    }
    return players;
  }

  private randomArchetype(): PlayerArchetype {
    const r = Math.random();
    if (r < 0.40) return 'conservative';
    if (r < 0.75) return 'balanced';
    return 'aggressive';
  }

  private randomSpecialty(): L0Category {
    const r = Math.random();
    let cumulative = 0;
    for (const cat of L0_CATEGORIES) {
      cumulative += CATEGORY_WEIGHTS[cat];
      if (r < cumulative) return cat;
    }
    return 'Agriculture';
  }

  // ---------- Player Actions ----------

  private executePlayerActions(
    player: SimulatedPlayer,
    day: number,
    commodityMap: Map<string, CommodityData>,
    recipeList: RecipeData[],
    currentPrices: Record<string, number>,
    productionMods: Record<string, number>,
  ): void {
    // Buy land
    this.buyLand(player);

    // Build factories
    this.buildFactories(player, day, commodityMap);

    // Hire workers
    this.hireWorkers(player);

    // Produce commodities
    this.produce(player, commodityMap, recipeList, currentPrices, productionMods);
  }

  private buyLand(player: SimulatedPlayer): void {
    const targetTiles = this.getTargetTiles(player);
    if (player.tilesOwned >= targetTiles) return;

    const tilesToBuy = Math.min(2, targetTiles - player.tilesOwned);
    const cost = calculateLandPrice(player.tilesOwned, tilesToBuy);

    // Only buy if we can afford it AND still have reserves for operations
    const reserveNeeded = 200;
    if (player.coins >= cost + reserveNeeded) {
      player.coins -= cost;
      player.tilesOwned += tilesToBuy;
    }
  }

  private getTargetTiles(player: SimulatedPlayer): number {
    switch (player.archetype) {
      case 'conservative':
        return Math.min(6, player.factories.length + 2);
      case 'balanced':
        return Math.min(12, player.factories.length + 4);
      case 'aggressive':
        return Math.min(20, player.factories.length + 6);
    }
  }

  private buildFactories(
    player: SimulatedPlayer,
    day: number,
    commodityMap: Map<string, CommodityData>,
  ): void {
    // Check if player has tiles available for a new factory
    const usedTiles = player.factories.length; // Simplified: 1 tile per factory
    if (usedTiles >= player.tilesOwned) return;

    const maxLevel = this.getMaxFactoryLevel(player);
    const maxFactories = this.getMaxFactories(player);
    if (player.factories.length >= maxFactories) return;

    // Pick what to build based on strategy
    let targetLevel = 0;
    if (maxLevel >= 2 && day > 8 && player.archetype === 'aggressive' && player.factories.filter((f) => f.level === 2).length < 2) {
      targetLevel = 2;
    } else if (maxLevel >= 2 && day > 20 && player.archetype === 'balanced' && player.factories.filter((f) => f.level === 2).length < 1) {
      targetLevel = 2;
    } else if (maxLevel >= 1 && day > 4 && player.archetype !== 'conservative' && player.factories.filter((f) => f.level === 1).length < 3) {
      targetLevel = 1;
    }

    // Find setup cost for target factory
    let setupCost = 150 + targetLevel * 200;
    for (const [, c] of commodityMap) {
      if (c.level === targetLevel && c.category === player.specialty) {
        setupCost = c.setupCost || setupCost;
        break;
      }
    }

    if (player.coins >= setupCost) {
      player.coins -= setupCost;
      player.factories.push({
        category: player.specialty,
        level: targetLevel,
        efficiency: 100,
      });
      // Player self-operates the factory (counts as 1 worker, no salary)
      if (player.workersHired < 1) {
        player.workersHired = 1;
      }
    }
  }

  private getMaxFactoryLevel(player: SimulatedPlayer): number {
    switch (player.archetype) {
      case 'conservative': return 1;
      case 'balanced': return 2;
      case 'aggressive': return 2;
    }
  }

  private getMaxFactories(player: SimulatedPlayer): number {
    switch (player.archetype) {
      case 'conservative': return 4;
      case 'balanced': return 7;
      case 'aggressive': return 10;
    }
  }

  private hireWorkers(player: SimulatedPlayer): void {
    const maxWorkers = player.factories.length * 2;
    if (player.workersHired >= maxWorkers) return;

    const toHire = Math.min(1, maxWorkers - player.workersHired);
    // Only hire if we can afford 10 days of salary on top of hire cost
    const hireCost = toHire * 50;
    const salaryReserve = toHire * this.WORKER_SALARY * 10;
    if (player.coins >= hireCost + salaryReserve) {
      player.coins -= hireCost;
      player.workersHired += toHire;
    }
  }

  private produce(
    player: SimulatedPlayer,
    commodityMap: Map<string, CommodityData>,
    recipeList: RecipeData[],
    currentPrices: Record<string, number>,
    productionMods: Record<string, number>,
  ): void {
    for (const factory of player.factories) {
      if (factory.level === 0) {
        // L0 direct production
        const commodity = this.findCommodityForFactory(factory, commodityMap);
        if (!commodity) continue;

        const effectiveTime = calculateEffectiveProductionTime(
          commodity.productionTimeMinutes,
          factory.efficiency,
        );
        const minutesPerDay = 24 * 60;
        const cycles = Math.floor(minutesPerDay / effectiveTime);
        const yieldPerCycle = calculateFinalYield(commodity.baseYield, [
          { bonus: player.specialty === commodity.category ? 0.10 : 0 },
        ]);

        let production = yieldPerCycle * Math.max(1, Math.min(cycles, 6)); // up to 6 cycles per day for fast commodities
        // Apply event modifiers
        const mod = productionMods[commodity.category] ?? 1;
        production = Math.floor(production * mod);

        // Sell production immediately — aggressive sell more, conservative sell most
        const sellRatio = player.archetype === 'conservative' ? 0.8 : player.archetype === 'balanced' ? 0.6 : 0.5;
        const sellImmediately = Math.floor(production * sellRatio);
        const keepForInventory = production - sellImmediately;
        
        // Revenue from immediate sale
        if (sellImmediately > 0 && currentPrices[commodity.slug]) {
          player.coins += sellImmediately * currentPrices[commodity.slug] * 0.9; // 90% market price
        }
        
        // Add remainder to inventory if storage allows
        const spaceLeft = player.storageCapacity - player.storageUsed;
        const stored = Math.min(keepForInventory, spaceLeft);
        if (stored > 0) {
          player.inventory[commodity.slug] = (player.inventory[commodity.slug] || 0) + stored;
          player.storageUsed += stored * (commodity.storageSize || 1);
        }
      } else {
        // L1/L2 production via recipes
        const recipe = recipeList.find(
          (r) => r.factoryCategory === factory.category && this.getRecipeLevel(r, commodityMap) === factory.level,
        );
        if (!recipe) continue;

        // Check if player has all inputs
        let canProduce = true;
        for (const input of recipe.inputs) {
          const available = player.inventory[input.commoditySlug] || 0;
          if (available < input.quantity) {
            canProduce = false;
            break;
          }
        }
        if (!canProduce) continue;

        // Consume inputs
        for (const input of recipe.inputs) {
          player.inventory[input.commoditySlug] -= input.quantity;
          const inputCommodity = commodityMap.get(input.commoditySlug);
          if (inputCommodity) {
            player.storageUsed -= input.quantity * (inputCommodity.storageSize || 1);
          }
        }

        // Produce output
        const outputCommodity = commodityMap.get(recipe.outputSlug);
        const outputQty = recipe.outputQuantity;
        const spaceLeft = player.storageCapacity - player.storageUsed;
        const storable = Math.min(outputQty, Math.floor(spaceLeft / (outputCommodity?.storageSize || 1)));
        if (storable > 0) {
          player.inventory[recipe.outputSlug] = (player.inventory[recipe.outputSlug] || 0) + storable;
          player.storageUsed += storable * (outputCommodity?.storageSize || 1);
        }
      }
    }
  }

  private findCommodityForFactory(
    factory: SimulatedFactory,
    commodityMap: Map<string, CommodityData>,
  ): CommodityData | undefined {
    for (const [, c] of commodityMap) {
      if (c.level === factory.level && c.category === factory.category) {
        return c;
      }
    }
    return undefined;
  }

  private getRecipeLevel(recipe: RecipeData, commodityMap: Map<string, CommodityData>): number {
    const output = commodityMap.get(recipe.outputSlug);
    return output?.level ?? 1;
  }

  // ---------- Marketplace Trading ----------

  private executeMarketplaceTrade(
    player: SimulatedPlayer,
    commodityMap: Map<string, CommodityData>,
    recipeList: RecipeData[],
    currentPrices: Record<string, number>,
  ): { volume: number; sold: Record<string, number>; bought: Record<string, number> } {
    const sold: Record<string, number> = {};
    const bought: Record<string, number> = {};
    let volume = 0;

    // Sell excess inventory
    for (const [slug, qty] of Object.entries(player.inventory)) {
      if (qty <= 0) continue;

      // Conservative: sell when > 50% storage; Balanced: > 30%; Aggressive: sell immediately
      const threshold =
        player.archetype === 'conservative' ? 0.5 :
        player.archetype === 'balanced' ? 0.3 : 0.1;

      const commodity = commodityMap.get(slug);
      if (!commodity) continue;

      // Only sell L0/L1 products that player won't use as inputs
      const isNeededAsInput = this.isNeededAsInput(slug, player, recipeList, commodityMap);
      if (isNeededAsInput && player.archetype !== 'conservative') continue;

      if (player.storageUsed > player.storageCapacity * threshold || commodity.level > 0) {
        const sellQty = Math.ceil(qty * 0.5);
        const price = currentPrices[slug] || commodity.basePrice;
        const revenue = price * sellQty * 0.9; // 10% marketplace fee
        player.coins += revenue;
        player.inventory[slug] -= sellQty;
        player.storageUsed -= sellQty * (commodity.storageSize || 1);
        sold[slug] = (sold[slug] || 0) + sellQty;
        volume += revenue;
      }
    }

    // Buy inputs for L1/L2 production
    if (player.archetype !== 'conservative') {
      for (const factory of player.factories) {
        if (factory.level === 0) continue;
        const recipe = recipeList.find(
          (r) => r.factoryCategory === factory.category && this.getRecipeLevel(r, commodityMap) === factory.level,
        );
        if (!recipe) continue;

        for (const input of recipe.inputs) {
          const currentStock = player.inventory[input.commoditySlug] || 0;
          if (currentStock < input.quantity * 3) {
            const buyQty = input.quantity * 2;
            const price = currentPrices[input.commoditySlug] || 10;
            const cost = price * buyQty;
            if (player.coins >= cost) {
              player.coins -= cost;
              player.inventory[input.commoditySlug] = (player.inventory[input.commoditySlug] || 0) + buyQty;
              const inputComm = commodityMap.get(input.commoditySlug);
              player.storageUsed += buyQty * (inputComm?.storageSize || 1);
              bought[input.commoditySlug] = (bought[input.commoditySlug] || 0) + buyQty;
              volume += cost;
            }
          }
        }
      }
    }

    return { volume, sold, bought };
  }

  private isNeededAsInput(
    slug: string,
    player: SimulatedPlayer,
    recipeList: RecipeData[],
    commodityMap: Map<string, CommodityData>,
  ): boolean {
    for (const factory of player.factories) {
      if (factory.level === 0) continue;
      const recipe = recipeList.find(
        (r) => r.factoryCategory === factory.category && this.getRecipeLevel(r, commodityMap) === factory.level,
      );
      if (recipe?.inputs.some((i) => i.commoditySlug === slug)) return true;
    }
    return false;
  }

  // ---------- Loans ----------

  private shouldTakeLoan(player: SimulatedPlayer, day: number): boolean {
    if (player.activeLoans.length >= 3) return false;

    switch (player.archetype) {
      case 'conservative':
        return false;
      case 'balanced':
        return day > 10 && player.coins < 200 && Math.random() < 0.1;
      case 'aggressive':
        return day > 3 && player.coins < 500 && Math.random() < 0.4;
    }
  }

  private calculateLoanAmount(player: SimulatedPlayer): number {
    const maxLoan = player.netWorth * 0.5;
    const currentDebt = player.activeLoans.reduce((s, l) => s + l.outstandingBalance, 0);
    const available = Math.max(0, maxLoan - currentDebt);

    switch (player.archetype) {
      case 'conservative':
        return 0;
      case 'balanced':
        return Math.min(available, 300 + Math.random() * 200);
      case 'aggressive':
        return Math.min(available, 500 + Math.random() * 500);
    }
  }

  // ---------- Random Events ----------

  private generateRandomEvents(days: number, frequency: EventFrequency): RandomEvent[] {
    const events: RandomEvent[] = [];
    const seasonLength = 30;
    const numSeasons = Math.ceil(days / seasonLength);

    const eventsPerSeason = frequency === 'low' ? 2 : frequency === 'medium' ? 3 : 4;

    const eventTemplates: Array<{
      type: string;
      affectedCategory: string;
      productionModifier: number;
      demandModifier: number;
      minDuration: number;
      maxDuration: number;
      impact: string;
    }> = [
      { type: 'Flood', affectedCategory: 'Agriculture', productionModifier: -0.3, demandModifier: 0, minDuration: 2, maxDuration: 5, impact: '-30% Agriculture production' },
      { type: 'Livestock Disease', affectedCategory: 'Livestock', productionModifier: -0.4, demandModifier: 0, minDuration: 3, maxDuration: 6, impact: '-40% Livestock production' },
      { type: 'Storm', affectedCategory: 'Fishery', productionModifier: -0.3, demandModifier: 0, minDuration: 1, maxDuration: 3, impact: '-30% Fishery production' },
      { type: 'Forest Fire', affectedCategory: 'Forestry', productionModifier: -0.5, demandModifier: 0, minDuration: 2, maxDuration: 4, impact: '-50% Forestry production' },
      { type: 'Excellent Harvest', affectedCategory: 'Agriculture', productionModifier: 0.2, demandModifier: 0, minDuration: 3, maxDuration: 7, impact: '+20% Agriculture production' },
      { type: 'Infrastructure Program', affectedCategory: 'Metal', productionModifier: 0, demandModifier: 0.3, minDuration: 5, maxDuration: 10, impact: '+30% Metal demand' },
      { type: 'EV Incentive', affectedCategory: 'Energy', productionModifier: 0, demandModifier: 0.4, minDuration: 5, maxDuration: 10, impact: '+40% Energy demand' },
    ];

    for (let season = 0; season < numSeasons; season++) {
      const seasonStart = season * seasonLength + 1;
      const seasonEnd = Math.min((season + 1) * seasonLength, days);

      for (let e = 0; e < eventsPerSeason; e++) {
        const template = eventTemplates[Math.floor(Math.random() * eventTemplates.length)];
        const day = seasonStart + Math.floor(Math.random() * (seasonEnd - seasonStart));
        const duration = template.minDuration + Math.floor(Math.random() * (template.maxDuration - template.minDuration + 1));

        events.push({
          type: template.type,
          day,
          duration,
          affectedCategory: template.affectedCategory,
          productionModifier: template.productionModifier,
          demandModifier: template.demandModifier,
          impact: template.impact,
        });
      }
    }

    return events;
  }

  // ---------- Report Compilation ----------

  private compileReport(
    params: AdvancedSimulationParams,
    players: SimulatedPlayer[],
    priceTrajectories: Record<string, number[]>,
    commodityMap: Map<string, CommodityData>,
    events: RandomEvent[],
    dailyVolumes: number[],
    totalLoansTaken: number,
    totalLoanAmount: number,
    loansDefaulted: number,
    loansRepaid: number,
    totalRepaymentDays: number,
    l2BreakEvenDays: number[],
    mapWidth: number,
    mapHeight: number,
  ): AdvancedSimulationReport {
    const { playerCount, days } = params;
    const survivedPlayers = players.filter((p) => p.survived);

    // --- Map Capacity ---
    const totalTiles = mapWidth * mapHeight;
    const tilesPerTerrain: Record<string, number> = {};
    for (const [terrain, pct] of Object.entries(TERRAIN_DISTRIBUTION)) {
      tilesPerTerrain[terrain] = Math.floor(totalTiles * pct);
    }
    const tilesNeededPerPlayer = 8; // avg factory footprint + expansion
    const totalTilesNeeded = playerCount * tilesNeededPerPlayer;
    const saturationPercent = Math.round((totalTilesNeeded / totalTiles) * 10000) / 100;
    const terrainBottlenecks: string[] = [];
    // Check which terrains would be saturated
    const terrainDemand: Record<string, number> = { Water: 0, 'Fertile Soil': 0, Farmland: 0, Mountain: 0, City: 0 };
    for (const p of players) {
      for (const f of p.factories) {
        const cat = f.category;
        if (cat === 'Fishery') terrainDemand['Water'] += 1;
        else if (cat === 'Agriculture') terrainDemand['Fertile Soil'] += 1;
        else if (cat === 'Livestock') terrainDemand['Farmland'] += 1;
        else if (cat === 'Forestry' || cat === 'Metal') terrainDemand['Mountain'] += 1;
        else terrainDemand['City'] += 1;
      }
    }
    for (const [terrain, available] of Object.entries(tilesPerTerrain)) {
      if ((terrainDemand[terrain] || 0) > available * 0.8) {
        terrainBottlenecks.push(terrain);
      }
    }

    // --- Economy Health ---
    const netWorths = players.map((p) => p.netWorth).sort((a, b) => a - b);
    const averageNetWorth = netWorths.length > 0 ? Math.round(netWorths.reduce((s, v) => s + v, 0) / netWorths.length) : 0;
    const medianNetWorth = netWorths.length > 0 ? netWorths[Math.floor(netWorths.length / 2)] : 0;
    const topPlayerNetWorth = netWorths[netWorths.length - 1] || 0;
    const bottomPlayerNetWorth = netWorths[0] || 0;
    const giniCoefficient = this.calculateGini(netWorths);

    const wealthDistribution = this.calculateWealthBrackets(netWorths, playerCount);

    // Check balance: no strategy dominates by >2x
    const stratGroups = this.groupByArchetype(players);
    const avgByStrat = {
      conservative: this.avgNetWorthForGroup(stratGroups.conservative),
      balanced: this.avgNetWorthForGroup(stratGroups.balanced),
      aggressive: this.avgNetWorthForGroup(stratGroups.aggressive),
    };
    const maxStrat = Math.max(avgByStrat.conservative, avgByStrat.balanced, avgByStrat.aggressive);
    const minStrat = Math.max(1, Math.min(avgByStrat.conservative, avgByStrat.balanced, avgByStrat.aggressive));
    const isBalanced = maxStrat / minStrat <= 2;

    // --- Strategy Analysis ---
    const strategyAnalysis = {
      conservative: this.analyzeStrategy(stratGroups.conservative, players.filter((p) => p.archetype === 'conservative')),
      balanced: this.analyzeStrategy(stratGroups.balanced, players.filter((p) => p.archetype === 'balanced')),
      aggressive: this.analyzeStrategy(stratGroups.aggressive, players.filter((p) => p.archetype === 'aggressive')),
      dominantStrategy: null as string | null,
    };
    if (!isBalanced) {
      if (avgByStrat.conservative === maxStrat) strategyAnalysis.dominantStrategy = 'conservative';
      else if (avgByStrat.balanced === maxStrat) strategyAnalysis.dominantStrategy = 'balanced';
      else strategyAnalysis.dominantStrategy = 'aggressive';
    }

    // --- Marketplace Liquidity ---
    const avgDailyVolume = dailyVolumes.length > 0
      ? Math.round(dailyVolumes.reduce((s, v) => s + v, 0) / dailyVolumes.length)
      : 0;
    const liquidCommodities: string[] = [];
    const illiquidCommodities: string[] = [];
    for (const [slug] of commodityMap) {
      const trajectory = priceTrajectories[slug];
      if (!trajectory || trajectory.length === 0) continue;
      // If prices remain stable or drop, likely liquid
      const lastPrice = trajectory[trajectory.length - 1];
      const basePrice = commodityMap.get(slug)!.basePrice;
      if (lastPrice <= basePrice * 1.3) {
        liquidCommodities.push(slug);
      } else {
        illiquidCommodities.push(slug);
      }
    }
    const averageFillRate = liquidCommodities.length / Math.max(1, liquidCommodities.length + illiquidCommodities.length);

    // --- Loan Analysis ---
    const totalLoansInSystem = totalLoansTaken;
    const avgLoanAmount = totalLoansTaken > 0 ? Math.round(totalLoanAmount / totalLoansTaken) : 0;
    const totalCompleted = loansRepaid + loansDefaulted;
    const defaultRate = totalCompleted > 0 ? Math.round((loansDefaulted / totalCompleted) * 10000) / 100 : 0;
    const avgRepaymentDays = loansRepaid > 0 ? Math.round(totalRepaymentDays / loansRepaid) : 0;
    const loanSustainable = defaultRate < 20;

    // --- Price Analysis ---
    const volatilities: { slug: string; volatility: number }[] = [];
    let stabilizationEffective = true;
    for (const [slug, trajectory] of Object.entries(priceTrajectories)) {
      if (trajectory.length < 2) continue;
      const mean = trajectory.reduce((s, v) => s + v, 0) / trajectory.length;
      const variance = trajectory.reduce((s, v) => s + (v - mean) ** 2, 0) / trajectory.length;
      const vol = Math.sqrt(variance) / (mean || 1);
      volatilities.push({ slug, volatility: vol });

      // Check stabilization: first 7 days should be base price
      const basePrice = commodityMap.get(slug)?.basePrice ?? 0;
      const first7 = trajectory.slice(0, Math.min(7, trajectory.length));
      for (const p of first7) {
        if (Math.abs(p - basePrice) > basePrice * 0.05) {
          stabilizationEffective = false;
        }
      }
    }
    volatilities.sort((a, b) => b.volatility - a.volatility);
    const avgVolatility = volatilities.length > 0
      ? Math.round((volatilities.reduce((s, v) => s + v.volatility, 0) / volatilities.length) * 10000) / 10000
      : 0;
    const mostVolatileCommodity = volatilities[0]?.slug ?? 'N/A';
    const leastVolatileCommodity = volatilities[volatilities.length - 1]?.slug ?? 'N/A';

    // --- Event Impact ---
    const eventImpactEntries = events.map((e) => ({
      type: e.type,
      day: e.day,
      duration: e.duration,
      impact: e.impact,
    }));
    // Estimate avg price impact from events
    let totalPriceImpact = 0;
    let recoverySum = 0;
    for (const event of events) {
      totalPriceImpact += Math.abs(event.productionModifier) + Math.abs(event.demandModifier);
      recoverySum += event.duration + 2; // estimated recovery time
    }
    const avgPriceImpact = events.length > 0
      ? Math.round((totalPriceImpact / events.length) * 10000) / 10000
      : 0;
    const recoveryDays = events.length > 0 ? Math.round(recoverySum / events.length) : 0;

    // --- L2 Viability ---
    const l2Producers = players.filter((p) => p.factories.some((f) => f.level === 2));
    const avgBreakEvenDay = l2BreakEvenDays.length > 0
      ? Math.round(l2BreakEvenDays.reduce((s, v) => s + v, 0) / l2BreakEvenDays.length)
      : days;
    const canBreakEvenByDay15 = avgBreakEvenDay <= 15;
    const l2ProfitMargin = l2Producers.length > 0
      ? Math.round(
          (l2Producers.reduce((s, p) => s + p.netWorth, 0) / l2Producers.length - 1000) /
          Math.max(1, averageNetWorth - 1000) * 100,
        ) / 100
      : 0;

    // --- Recommendations ---
    const recommendations: string[] = [];
    if (!isBalanced) {
      recommendations.push(`Strategy imbalance detected: "${strategyAnalysis.dominantStrategy}" dominates. Consider adjusting progression costs or production yields.`);
    }
    if (saturationPercent > 80) {
      recommendations.push(`Map saturation at ${saturationPercent}%. Consider increasing map size or reducing tile requirements.`);
    }
    if (terrainBottlenecks.length > 0) {
      recommendations.push(`Terrain bottlenecks: ${terrainBottlenecks.join(', ')}. Consider adjusting terrain distribution.`);
    }
    if (defaultRate > 15) {
      recommendations.push(`High loan default rate (${defaultRate}%). Consider reducing interest rates or loan limits.`);
    }
    if (illiquidCommodities.length > liquidCommodities.length) {
      recommendations.push(`Marketplace liquidity issues: ${illiquidCommodities.length} illiquid commodities. Consider increasing production or reducing demand scaling.`);
    }
    if (!stabilizationEffective) {
      recommendations.push('Price stabilization ineffective in first 7 days. Check supply/demand initialization.');
    }
    if (giniCoefficient > 0.6) {
      recommendations.push(`High wealth inequality (Gini: ${giniCoefficient}). Consider wealth redistribution mechanics or catch-up bonuses.`);
    }
    if (!canBreakEvenByDay15) {
      recommendations.push(`L2 factories cannot break even by day 15 (avg: day ${avgBreakEvenDay}). Consider reducing L2 input costs or increasing output value.`);
    }
    if (recommendations.length === 0) {
      recommendations.push('Economy appears healthy. All metrics within acceptable ranges.');
    }

    return {
      playerCount,
      simulatedDays: days,
      mapSize: { width: mapWidth, height: mapHeight },
      mapCapacity: {
        totalTiles,
        tilesPerTerrain,
        tilesNeededPerPlayer,
        totalTilesNeeded,
        saturationPercent,
        sufficient: saturationPercent < 100,
        terrainBottlenecks,
      },
      economyHealth: {
        isBalanced,
        averageNetWorth,
        medianNetWorth,
        topPlayerNetWorth,
        bottomPlayerNetWorth,
        giniCoefficient,
        wealthDistribution,
      },
      strategyAnalysis,
      marketplaceLiquidity: {
        avgDailyVolume,
        liquidCommodities,
        illiquidCommodities,
        averageFillRate: Math.round(averageFillRate * 10000) / 100,
      },
      loanAnalysis: {
        totalLoansTaken: totalLoansInSystem,
        avgLoanAmount,
        defaultRate,
        avgRepaymentDays,
        sustainable: loanSustainable,
      },
      priceAnalysis: {
        avgVolatility,
        mostVolatileCommodity,
        leastVolatileCommodity,
        priceTrajectories,
        stabilizationEffective,
      },
      eventImpact: {
        eventsTriggered: eventImpactEntries,
        avgPriceImpact,
        recoveryDays,
      },
      l2Viability: {
        canBreakEvenByDay15,
        avgBreakEvenDay,
        l2ProducerCount: l2Producers.length,
        l2ProfitMargin,
      },
      recommendations,
    };
  }

  // ---------- Utility Functions ----------

  private calculateGini(sorted: number[]): number {
    const n = sorted.length;
    if (n === 0) return 0;
    const sum = sorted.reduce((s, v) => s + v, 0);
    if (sum === 0) return 0;

    let numerator = 0;
    for (let i = 0; i < n; i++) {
      numerator += (2 * (i + 1) - n - 1) * sorted[i];
    }
    return Math.round((numerator / (n * sum)) * 10000) / 10000;
  }

  private calculateWealthBrackets(
    sortedNetWorths: number[],
    totalPlayers: number,
  ): { bracket: string; count: number; percentage: number }[] {
    const brackets = [
      { bracket: '< 500', min: -Infinity, max: 500 },
      { bracket: '500 - 1000', min: 500, max: 1000 },
      { bracket: '1000 - 2500', min: 1000, max: 2500 },
      { bracket: '2500 - 5000', min: 2500, max: 5000 },
      { bracket: '5000 - 10000', min: 5000, max: 10000 },
      { bracket: '> 10000', min: 10000, max: Infinity },
    ];

    return brackets.map(({ bracket, min, max }) => {
      const count = sortedNetWorths.filter((w) => w >= min && w < max).length;
      return {
        bracket,
        count,
        percentage: Math.round((count / Math.max(1, totalPlayers)) * 10000) / 100,
      };
    });
  }

  private groupByArchetype(
    players: SimulatedPlayer[],
  ): Record<PlayerArchetype, SimulatedPlayer[]> {
    return {
      conservative: players.filter((p) => p.archetype === 'conservative'),
      balanced: players.filter((p) => p.archetype === 'balanced'),
      aggressive: players.filter((p) => p.archetype === 'aggressive'),
    };
  }

  private avgNetWorthForGroup(group: SimulatedPlayer[]): number {
    if (group.length === 0) return 0;
    return Math.round(group.reduce((s, p) => s + p.netWorth, 0) / group.length);
  }

  private analyzeStrategy(
    survived: SimulatedPlayer[],
    all: SimulatedPlayer[],
  ): { avgNetWorth: number; avgROI: number; survivedPercent: number } {
    const avgNetWorth = this.avgNetWorthForGroup(survived);
    const avgROI = survived.length > 0
      ? Math.round(
          (survived.reduce((s, p) => s + (p.netWorth - p.initialCoins) / p.initialCoins, 0) / survived.length) * 10000,
        ) / 100
      : 0;
    const survivedPercent = all.length > 0
      ? Math.round((survived.length / all.length) * 10000) / 100
      : 0;
    return { avgNetWorth, avgROI, survivedPercent };
  }
}
