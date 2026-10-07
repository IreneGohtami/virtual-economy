import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Repository, DataSource } from 'typeorm';
import { Queue } from 'bullmq';
import {
  CommodityCategory,
  FactoryStatus,
  ProductionJobStatus,
  SeasonStatus,
} from '@sea-commodity-tycoon/shared-types';
import {
  calculateFinalYield,
  calculateIncrementInterval,
  calculateEffectiveProductionTime,
  YieldModifier,
} from '@sea-commodity-tycoon/game-rules';
import { ProductionJob } from '../entities/production-job.entity';
import { Factory } from '../entities/factory.entity';
import { Commodity } from '../entities/commodity.entity';
import { Recipe } from '../entities/recipe.entity';
import { RecipeInput } from '../entities/recipe-input.entity';
import { Inventory } from '../entities/inventory.entity';
import { WorkerAssignment } from '../entities/worker-assignment.entity';
import { PlayerSeason } from '../entities/player-season.entity';
import { Season } from '../entities/season.entity';
import { QUEUE_NAMES } from '../queue/queue.module';
import { InventoryService } from '../inventory/inventory.service';
import { StartProductionDto } from './dto';

/** Categories that require exclusive output selection before production */
const EXCLUSIVE_OUTPUT_CATEGORIES: string[] = [
  CommodityCategory.LIVESTOCK,
  CommodityCategory.FISHERY,
];

@Injectable()
export class ProductionService {
  private readonly logger = new Logger(ProductionService.name);

  constructor(
    @InjectRepository(ProductionJob)
    private readonly productionJobRepository: Repository<ProductionJob>,
    @InjectRepository(Factory)
    private readonly factoryRepository: Repository<Factory>,
    @InjectRepository(Commodity)
    private readonly commodityRepository: Repository<Commodity>,
    @InjectRepository(Recipe)
    private readonly recipeRepository: Repository<Recipe>,
    @InjectRepository(RecipeInput)
    private readonly recipeInputRepository: Repository<RecipeInput>,
    @InjectRepository(Inventory)
    private readonly inventoryRepository: Repository<Inventory>,
    @InjectRepository(WorkerAssignment)
    private readonly workerAssignmentRepository: Repository<WorkerAssignment>,
    @InjectRepository(PlayerSeason)
    private readonly playerSeasonRepository: Repository<PlayerSeason>,
    @InjectRepository(Season)
    private readonly seasonRepository: Repository<Season>,
    @InjectQueue(QUEUE_NAMES.PRODUCTION)
    private readonly productionQueue: Queue,
    private readonly dataSource: DataSource,
    private readonly inventoryService: InventoryService,
  ) {}

  /**
   * Start a production job at a factory.
   *
   * Flow:
   * 1. Validate factory belongs to player and is IDLE
   * 2. Validate factory has at least 1 worker assigned
   * 3. For exclusive-output factories: validate exclusive_output_slug is not NULL
   * 4. Get commodity/recipe configuration (base yield, production time)
   * 5. Calculate yield modifiers and final yield
   * 6. Calculate increment interval
   * 7. For L1/L2: validate and consume input commodities from inventory
   * 8. Create ProductionJob record (ACTIVE)
   * 9. Set factory status to PRODUCING
   * 10. Schedule first BullMQ job 'production.increment' with delay = increment_interval
   * 11. Return job details
   */
  async startProduction(playerId: string, dto: StartProductionDto): Promise<ProductionJob> {
    const season = await this.getActiveSeason();

    // 1. Validate factory belongs to player and is IDLE
    const factory = await this.factoryRepository.findOne({
      where: { id: dto.factoryId, playerId, seasonId: season.id },
      relations: ['commodity'],
    });

    if (!factory) {
      throw new NotFoundException(
        `Factory ${dto.factoryId} not found or does not belong to player`,
      );
    }

    if (factory.status !== FactoryStatus.IDLE) {
      throw new BadRequestException(
        `Factory must be IDLE to start production. Current status: ${factory.status}`,
      );
    }

    // 2. Validate factory has at least 1 worker assigned
    const workers = await this.workerAssignmentRepository.find({
      where: { factoryId: factory.id, seasonId: season.id },
      relations: ['workerProfile'],
    });

    if (workers.length === 0) {
      throw new BadRequestException(
        'Factory must have at least 1 worker assigned to start production',
      );
    }

    // 3. For exclusive-output factories: validate exclusive_output_slug is not NULL
    if (EXCLUSIVE_OUTPUT_CATEGORIES.includes(factory.category)) {
      if (!factory.exclusiveOutputSlug) {
        throw new BadRequestException(
          `Factory category ${factory.category} requires an exclusive output to be selected before production. Use POST /factories/:id/switch-output first.`,
        );
      }
    }

    // 4. Get commodity/recipe configuration
    const { commodity, recipe, baseYield, baseProductionTimeMinutes } =
      await this.resolveProductionConfig(factory, dto.recipeId);

    // 4b. Validate worker count meets recipe/level requirement
    // L2 (assembly) factories require at least 2 workers; recipe.workerRequirement takes precedence if set
    const requiredWorkers = recipe?.workerRequirement ?? (factory.factoryLevel === 2 ? 2 : 1);
    if (workers.length < requiredWorkers) {
      throw new BadRequestException(
        `This production requires at least ${requiredWorkers} worker(s), but factory has ${workers.length}. ` +
          (factory.factoryLevel === 2
            ? 'L2 assembly factories require 2 workers.'
            : `Recipe "${recipe?.name}" requires ${requiredWorkers} worker(s).`),
      );
    }

    // 5. Calculate yield modifiers and final yield
    const playerSeason = await this.playerSeasonRepository.findOne({
      where: { playerId, seasonId: season.id },
    });

    if (!playerSeason) {
      throw new BadRequestException('Player not enrolled in current season');
    }

    const modifiers = this.calculateModifiers(
      factory,
      workers,
      playerSeason,
    );

    const finalYield = calculateFinalYield(baseYield, modifiers.list);

    // 6. Calculate effective production time and increment interval
    const efficiency = parseFloat(factory.efficiency);
    const effectiveProductionTime = calculateEffectiveProductionTime(
      baseProductionTimeMinutes,
      efficiency,
    );
    const incrementInterval = calculateIncrementInterval(
      effectiveProductionTime,
      finalYield,
    );

    // Round increment interval to nearest whole minute (minimum 1 minute)
    const incrementIntervalMinutes = Math.max(1, Math.round(incrementInterval));

    // 7. For L1/L2 (recipes with inputs): validate and consume input commodities
    let inputSnapshot: Record<string, unknown> | null = null;

    if (recipe) {
      const inputs = await this.recipeInputRepository.find({
        where: { recipeId: recipe.id },
        relations: ['commodity'],
      });

      if (inputs.length > 0) {
        inputSnapshot = await this.validateAndConsumeInputs(
          playerId,
          season.id,
          inputs,
        );
      }
    }

    // 8-10. Create job, update factory, schedule BullMQ — all atomically
    const totalProductionTimeMs = effectiveProductionTime * 60 * 1000;
    const completesAt = new Date(Date.now() + totalProductionTimeMs);

    const job = await this.dataSource.transaction(async (manager) => {
      // Create ProductionJob record
      const productionJob = manager.create(ProductionJob, {
        playerId,
        factoryId: factory.id,
        recipeId: recipe?.id ?? null,
        commodityId: commodity.id,
        seasonId: season.id,
        status: ProductionJobStatus.ACTIVE,
        baseYield,
        finalYield,
        unitsProduced: 0,
        incrementIntervalMinutes,
        effectiveProductionTimeMinutes: Math.round(effectiveProductionTime),
        startedAt: new Date(),
        completesAt,
        pausedAt: null,
        completedAt: null,
        pauseReason: null,
        inputSnapshot,
        yieldModifiers: modifiers.breakdown,
      });

      const savedJob = await manager.save(ProductionJob, productionJob);

      // Set factory status to PRODUCING
      factory.status = FactoryStatus.PRODUCING;
      await manager.save(Factory, factory);

      return savedJob;
    });

    // 10. Schedule first BullMQ increment job
    const delayMs = incrementIntervalMinutes * 60 * 1000;
    await this.productionQueue.add(
      'production.increment',
      {
        jobId: job.id,
        playerId,
        factoryId: factory.id,
        commodityId: commodity.id,
        seasonId: season.id,
        finalYield,
        unitsProduced: 0,
        incrementIntervalMinutes,
      },
      {
        delay: delayMs,
        jobId: `increment-${job.id}-1`,
        removeOnComplete: true,
        removeOnFail: false,
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
      },
    );

    this.logger.log(
      `Production started: jobId=${job.id}, factory=${factory.id}, commodity=${commodity.slug}, ` +
        `finalYield=${finalYield}, interval=${incrementIntervalMinutes}min, player=${playerId}`,
    );

    return job;
  }

  /**
   * Get all production jobs for a player in the current season.
   */
  async getPlayerJobs(playerId: string): Promise<ProductionJob[]> {
    const season = await this.getActiveSeason();

    return this.productionJobRepository.find({
      where: { playerId, seasonId: season.id },
      relations: ['commodity', 'factory'],
      order: { startedAt: 'DESC' },
    });
  }

  /**
   * Get a specific production job by ID, ensuring it belongs to the player.
   */
  async getJobById(playerId: string, jobId: string): Promise<ProductionJob> {
    const job = await this.productionJobRepository.findOne({
      where: { id: jobId, playerId },
      relations: ['commodity', 'factory', 'recipe'],
    });

    if (!job) {
      throw new NotFoundException(`Production job ${jobId} not found`);
    }

    return job;
  }

  // --- Production Increment & Pause/Resume ---

  /**
   * Handle a production increment job from BullMQ.
   * This is the entry point called by the worker process.
   */
  async handleIncrementJob(data: {
    jobId: string;
    playerId: string;
    factoryId: string;
    commodityId: string;
    seasonId: string;
    finalYield: number;
    unitsProduced: number;
    incrementIntervalMinutes: number;
  }): Promise<{ status: 'produced' | 'paused' | 'completed' }> {
    return this.processIncrement(data.jobId);
  }

  /**
   * Process a single production increment.
   *
   * Called by the BullMQ worker when 'production.increment' job fires:
   * 1. Fetch job, validate still ACTIVE
   * 2. Check if player has storage capacity for 1 more unit
   * 3. If has capacity: add 1 unit to inventory, increment unitsProduced
   * 4. If full: set job PAUSED, set factory PAUSED, record pauseReason='STORAGE_FULL'
   * 5. If unitsProduced >= finalYield: mark COMPLETED, set factory back to IDLE
   * 6. Otherwise: schedule next increment job
   */
  async processIncrement(jobId: string): Promise<{ status: 'produced' | 'paused' | 'completed' }> {
    const job = await this.productionJobRepository.findOne({
      where: { id: jobId },
      relations: ['factory'],
    });

    if (!job) {
      throw new NotFoundException(`Production job ${jobId} not found`);
    }

    if (job.status !== ProductionJobStatus.ACTIVE) {
      this.logger.warn(
        `Increment skipped: job ${jobId} is ${job.status}, not ACTIVE`,
      );
      return { status: 'paused' };
    }

    // Check if player has storage capacity for 1 more unit of this commodity
    const hasCapacity = await this.inventoryService.hasCapacityFor(
      job.playerId,
      job.seasonId,
      job.commodityId,
      1,
    );

    if (!hasCapacity) {
      // Storage full — pause production
      await this.pauseProduction(jobId, 'STORAGE_FULL');
      return { status: 'paused' };
    }

    // Add 1 unit to player's inventory
    await this.inventoryService.addToInventory(
      job.playerId,
      job.seasonId,
      job.commodityId,
      1,
    );

    // Increment unitsProduced
    job.unitsProduced += 1;

    // Check if production is complete
    if (job.unitsProduced >= job.finalYield) {
      job.status = ProductionJobStatus.COMPLETED;
      job.completedAt = new Date();
      await this.productionJobRepository.save(job);

      // Set factory back to IDLE
      const factory = job.factory ?? await this.factoryRepository.findOneBy({ id: job.factoryId });
      if (factory) {
        factory.status = FactoryStatus.IDLE;
        await this.factoryRepository.save(factory);
      }

      this.logger.log(
        `Production completed: jobId=${jobId}, totalProduced=${job.unitsProduced}`,
      );

      return { status: 'completed' };
    }

    // Save updated units count
    await this.productionJobRepository.save(job);

    // Schedule next increment
    await this.scheduleNextIncrement(job);

    return { status: 'produced' };
  }

  /**
   * Pause a production job.
   *
   * Sets job to PAUSED, records pause reason and timestamp,
   * and sets factory status to PAUSED.
   */
  async pauseProduction(jobId: string, reason: string): Promise<ProductionJob> {
    const job = await this.productionJobRepository.findOne({
      where: { id: jobId },
    });

    if (!job) {
      throw new NotFoundException(`Production job ${jobId} not found`);
    }

    if (job.status !== ProductionJobStatus.ACTIVE) {
      throw new BadRequestException(
        `Cannot pause job: current status is ${job.status}, expected ACTIVE`,
      );
    }

    job.status = ProductionJobStatus.PAUSED;
    job.pausedAt = new Date();
    job.pauseReason = reason;
    await this.productionJobRepository.save(job);

    // Set factory to PAUSED
    const factory = await this.factoryRepository.findOneBy({ id: job.factoryId });
    if (factory) {
      factory.status = FactoryStatus.PAUSED;
      await this.factoryRepository.save(factory);
    }

    this.logger.log(
      `Production paused: jobId=${jobId}, reason=${reason}`,
    );

    return job;
  }

  /**
   * Resume a paused production job.
   *
   * Validates job is PAUSED, sets back to ACTIVE, clears pause fields,
   * and schedules the next increment from where production left off.
   */
  async resumeProduction(jobId: string): Promise<ProductionJob> {
    const job = await this.productionJobRepository.findOne({
      where: { id: jobId },
    });

    if (!job) {
      throw new NotFoundException(`Production job ${jobId} not found`);
    }

    if (job.status !== ProductionJobStatus.PAUSED) {
      throw new BadRequestException(
        `Cannot resume job: current status is ${job.status}, expected PAUSED`,
      );
    }

    // Set back to ACTIVE
    job.status = ProductionJobStatus.ACTIVE;
    job.pausedAt = null;
    job.pauseReason = null;

    // Recalculate completesAt based on remaining work
    const remainingUnits = job.finalYield - job.unitsProduced;
    const remainingTimeMs = remainingUnits * job.incrementIntervalMinutes * 60 * 1000;
    job.completesAt = new Date(Date.now() + remainingTimeMs);

    await this.productionJobRepository.save(job);

    // Set factory back to PRODUCING
    const factory = await this.factoryRepository.findOneBy({ id: job.factoryId });
    if (factory) {
      factory.status = FactoryStatus.PRODUCING;
      await this.factoryRepository.save(factory);
    }

    // Schedule next increment
    await this.scheduleNextIncrement(job);

    this.logger.log(
      `Production resumed: jobId=${jobId}, remaining=${remainingUnits} units`,
    );

    return job;
  }

  /**
   * Check and resume paused production jobs for a player when inventory changes.
   *
   * Called when inventory decreases (sell, list) or storage upgrades.
   * Finds all PAUSED jobs with pauseReason='STORAGE_FULL' and resumes
   * those that now have sufficient capacity.
   */
  async checkAndResumeForPlayer(playerId: string, seasonId: string): Promise<number> {
    const pausedJobs = await this.productionJobRepository.find({
      where: {
        playerId,
        seasonId,
        status: ProductionJobStatus.PAUSED,
        pauseReason: 'STORAGE_FULL',
      },
    });

    if (pausedJobs.length === 0) {
      return 0;
    }

    let resumedCount = 0;

    for (const job of pausedJobs) {
      const hasCapacity = await this.inventoryService.hasCapacityFor(
        playerId,
        seasonId,
        job.commodityId,
        1,
      );

      if (hasCapacity) {
        await this.resumeProduction(job.id);
        resumedCount++;
      }
    }

    if (resumedCount > 0) {
      this.logger.log(
        `Resumed ${resumedCount} paused production jobs for player ${playerId}`,
      );
    }

    return resumedCount;
  }

  // --- Private helpers ---

  /**
   * Resolve the output commodity and recipe for a production start.
   * - L0 factories: produce from the commodity directly (no recipe needed)
   * - L1/L2 factories: use the provided recipeId
   * - Exclusive output factories: resolve commodity from exclusive_output_slug
   */
  private async resolveProductionConfig(
    factory: Factory,
    recipeId?: string,
  ): Promise<{
    commodity: Commodity;
    recipe: Recipe | null;
    baseYield: number;
    baseProductionTimeMinutes: number;
  }> {
    // L1/L2: recipe-based production
    if (factory.factoryLevel > 0 || recipeId) {
      const effectiveRecipeId = recipeId ?? factory.recipeId;
      if (!effectiveRecipeId) {
        throw new BadRequestException(
          'Recipe ID is required for processing/assembly factories (L1/L2)',
        );
      }

      const recipe = await this.recipeRepository.findOne({
        where: { id: effectiveRecipeId },
        relations: ['outputCommodity'],
      });

      if (!recipe) {
        throw new NotFoundException(`Recipe ${effectiveRecipeId} not found`);
      }

      // Validate recipe belongs to this factory's category
      if (recipe.factoryCategory !== factory.category) {
        throw new BadRequestException(
          `Recipe "${recipe.name}" is for category ${recipe.factoryCategory}, but factory is category ${factory.category}`,
        );
      }

      return {
        commodity: recipe.outputCommodity,
        recipe,
        baseYield: recipe.outputQuantity,
        baseProductionTimeMinutes: recipe.processingTimeMinutes,
      };
    }

    // L0: direct commodity production
    // For exclusive-output factories, resolve from exclusive_output_slug
    if (factory.exclusiveOutputSlug) {
      const commodity = await this.commodityRepository.findOne({
        where: { slug: factory.exclusiveOutputSlug },
      });

      if (!commodity) {
        throw new BadRequestException(
          `Commodity with slug "${factory.exclusiveOutputSlug}" not found`,
        );
      }

      return {
        commodity,
        recipe: null,
        baseYield: commodity.baseYield,
        baseProductionTimeMinutes: commodity.baseProductionTimeMinutes,
      };
    }

    // Standard L0: use the factory's linked commodity
    if (!factory.commodityId) {
      throw new BadRequestException(
        'Factory has no commodity assigned. Cannot start production.',
      );
    }

    const commodity = factory.commodity ?? await this.commodityRepository.findOneBy({
      id: factory.commodityId,
    });

    if (!commodity) {
      throw new NotFoundException(`Commodity ${factory.commodityId} not found`);
    }

    return {
      commodity,
      recipe: null,
      baseYield: commodity.baseYield,
      baseProductionTimeMinutes: commodity.baseProductionTimeMinutes,
    };
  }

  /**
   * Calculate yield modifiers for the production job.
   *
   * Modifiers (additive):
   * - Specialty match: +10% if player's specialty matches factory category
   * - Second worker: +25% if 2 workers assigned
   * - Worker skill: +exp% for the worker whose specialty matches the factory category
   * - Fertilizer boost: configured value if active
   */
  private calculateModifiers(
    factory: Factory,
    workers: WorkerAssignment[],
    playerSeason: PlayerSeason,
  ): { list: YieldModifier[]; breakdown: Record<string, unknown> } {
    const modifiers: YieldModifier[] = [];
    const breakdown: Record<string, unknown> = {};

    // Specialty bonus: +10% if player specialty matches factory's commodity category
    // Player specialty is a commodity slug (e.g. "palm-fruit"), factory has a category (e.g. "AGRICULTURE")
    // We need to check if the specialty slug belongs to the factory's category
    const specialtyCategoryMap: Record<string, string> = {
      'rice': 'AGRICULTURE', 'palm-fruit': 'AGRICULTURE', 'cocoa': 'AGRICULTURE', 'coffee': 'AGRICULTURE',
      'crude-oil': 'ENERGY', 'natural-gas': 'ENERGY',
      'iron-ore': 'METAL', 'nickel-ore': 'METAL',
      'poultry': 'LIVESTOCK', 'cattle': 'LIVESTOCK',
      'fish': 'FISHERY',
      'timber': 'FORESTRY', 'rubber': 'FORESTRY',
    };
    const specialtyCategory = specialtyCategoryMap[playerSeason.specialty ?? ''];
    if (specialtyCategory && specialtyCategory === factory.category) {
      modifiers.push({ bonus: 0.10 });
      breakdown.specialtyBonus = 0.10;
    }

    // Second worker bonus: +25% if 2 workers assigned
    if (workers.length >= 2) {
      modifiers.push({ bonus: 0.25 });
      breakdown.secondWorkerBonus = 0.25;
    }

    // Worker skill bonus: experience% for workers with matching specialty role
    const roleToCategoryMap: Record<string, string> = {
      'farmer': 'AGRICULTURE',
      'miner': 'METAL',
      'fisherman': 'FISHERY',
      'driller': 'ENERGY',
      'rancher': 'LIVESTOCK',
      'lumberjack': 'FORESTRY',
      'shopkeeper': '',
    };
    let totalSkillBonus = 0;
    for (const assignment of workers) {
      const profile = assignment.workerProfile;
      if (!profile) continue;
      const spec = profile.specialty;
      let isMatch = false;
      if (factory.factoryLevel === 0) {
        // L0: only category-based L0 specialists
        isMatch = roleToCategoryMap[spec] === factory.category;
      } else if (factory.factoryLevel === 1) {
        if (['ENERGY', 'METAL', 'FORESTRY'].includes(factory.category)) {
          // Industrial L1: only engineers match
          isMatch = spec === 'engineer';
        } else {
          // Food/agri L1: parent L0 specialty matches
          isMatch = roleToCategoryMap[spec] === factory.category;
        }
      } else if (factory.factoryLevel === 2) {
        // L2: only technicians match
        isMatch = spec === 'technician';
      }
      if (isMatch) {
        const skillBonus = profile.experienceLevel / 100;
        totalSkillBonus += skillBonus;
      }
    }
    if (totalSkillBonus > 0) {
      modifiers.push({ bonus: totalSkillBonus });
      breakdown.workerSkillBonus = totalSkillBonus;
    }

    // Fertilizer bonus: if active on the factory
    if (factory.fertilizerBoostActive && factory.fertilizerBoostExpiresAt) {
      const now = new Date();
      if (factory.fertilizerBoostExpiresAt > now) {
        // Determine bonus from category: Agriculture 15%, Forestry 12%
        let fertilizerBonus = 0;
        if (factory.category === CommodityCategory.AGRICULTURE) {
          fertilizerBonus = 0.15;
        } else if (factory.category === CommodityCategory.FORESTRY) {
          fertilizerBonus = 0.12;
        }
        if (fertilizerBonus > 0) {
          modifiers.push({ bonus: fertilizerBonus });
          breakdown.fertilizerBonus = fertilizerBonus;
        }
      }
    }

    breakdown.totalBonus = modifiers.reduce((sum, m) => sum + m.bonus, 0);
    breakdown.workerCount = workers.length;

    return { list: modifiers, breakdown };
  }

  /**
   * Validate that the player has sufficient input commodities in inventory
   * and consume (deduct) them atomically.
   *
   * Returns an input snapshot for recording in the production job.
   */
  private async validateAndConsumeInputs(
    playerId: string,
    seasonId: string,
    inputs: RecipeInput[],
  ): Promise<Record<string, unknown>> {
    const snapshot: Record<string, { commodityId: string; slug: string; quantity: number }> = {};

    // Check all inputs have sufficient inventory
    for (const input of inputs) {
      const inventory = await this.inventoryRepository.findOne({
        where: { playerId, seasonId, commodityId: input.commodityId },
      });

      const available = inventory?.quantity ?? 0;
      if (available < input.quantity) {
        const commodityName = input.commodity?.name ?? input.commodityId;
        throw new BadRequestException(
          `Insufficient inventory for "${commodityName}": need ${input.quantity}, have ${available}`,
        );
      }

      snapshot[input.commodityId] = {
        commodityId: input.commodityId,
        slug: input.commodity?.slug ?? 'unknown',
        quantity: input.quantity,
      };
    }

    // Consume inputs atomically
    for (const input of inputs) {
      await this.inventoryRepository
        .createQueryBuilder()
        .update(Inventory)
        .set({ quantity: () => `quantity - ${input.quantity}` })
        .where('player_id = :playerId AND season_id = :seasonId AND commodity_id = :commodityId', {
          playerId,
          seasonId,
          commodityId: input.commodityId,
        })
        .execute();
    }

    return snapshot;
  }

  private async getActiveSeason(): Promise<Season> {
    const season = await this.seasonRepository.findOne({
      where: { status: SeasonStatus.ACTIVE },
      order: { startsAt: 'DESC' },
    });

    if (!season) {
      throw new BadRequestException('No active season');
    }

    return season;
  }

  /**
   * Schedule the next increment job for a production job.
   */
  private async scheduleNextIncrement(job: ProductionJob): Promise<void> {
    const delayMs = job.incrementIntervalMinutes * 60 * 1000;
    const nextUnit = job.unitsProduced + 1;

    await this.productionQueue.add(
      'production.increment',
      {
        jobId: job.id,
        playerId: job.playerId,
        factoryId: job.factoryId,
        commodityId: job.commodityId,
        seasonId: job.seasonId,
        finalYield: job.finalYield,
        unitsProduced: job.unitsProduced,
        incrementIntervalMinutes: job.incrementIntervalMinutes,
      },
      {
        delay: delayMs,
        jobId: `increment-${job.id}-${nextUnit}`,
        removeOnComplete: true,
        removeOnFail: false,
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
      },
    );
  }

  /**
   * Auto-start production on all idle factories that have at least 1 worker assigned.
   * Skips factories that require exclusive output selection but haven't set one.
   */
  async autoStartAllIdle(playerId: string): Promise<Array<{ factoryId: string; jobId: string }>> {
    const season = await this.getActiveSeason();

    // Find all idle factories for this player
    const idleFactories = await this.factoryRepository.find({
      where: { playerId, seasonId: season.id, status: FactoryStatus.IDLE },
    });

    const results: Array<{ factoryId: string; jobId: string }> = [];

    for (const factory of idleFactories) {
      // Check if factory has workers
      const workerCount = await this.workerAssignmentRepository.count({
        where: { factoryId: factory.id, seasonId: season.id },
      });
      if (workerCount === 0) continue;

      // Skip exclusive-output factories without a selection
      const needsExclusive = ['LIVESTOCK', 'FISHERY'].includes(factory.category);
      if (needsExclusive && !factory.exclusiveOutputSlug) continue;

      try {
        const job = await this.startProduction(playerId, { factoryId: factory.id });
        results.push({ factoryId: factory.id, jobId: job.id });
      } catch {
        // Skip factories that can't start (missing inputs, etc.)
        continue;
      }
    }

    return results;
  }

}
