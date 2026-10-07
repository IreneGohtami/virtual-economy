import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Repository, DataSource, In } from 'typeorm';
import { Queue } from 'bullmq';
import {
  CommodityCategory,
  FactoryStatus,
  ProductionJobStatus,
  SeasonStatus,
  TransactionType,
} from '@sea-commodity-tycoon/shared-types';
import {
  calculateDeconstructionFee,
  calculateMaintenanceCost,
  calculateMaxEfficiency,
} from '@sea-commodity-tycoon/game-rules';
import { Factory } from '../entities/factory.entity';
import { ProductionJob } from '../entities/production-job.entity';
import { MapTile } from '../entities/map-tile.entity';
import { Season } from '../entities/season.entity';
import { Commodity } from '../entities/commodity.entity';
import { MapService } from '../map/map.service';
import { WalletService } from '../wallet/wallet.service';
import { InventoryService } from '../inventory/inventory.service';
import { QUEUE_NAMES } from '../queue/queue.module';
import { ConstructFactoryDto } from './dto';

/**
 * Setup costs by category and level.
 * L0: Agriculture 300, Energy 500, Metal 500, Livestock/Fishery 400, Forestry 300
 * L1: Agriculture 350, Energy 600, Metal 650, Livestock 350, Forestry 400
 * L2: Electronics 800, Automotive 1000
 */
const SETUP_COSTS: Record<CommodityCategory, Record<number, number>> = {
  [CommodityCategory.AGRICULTURE]: { 0: 300, 1: 350 },
  [CommodityCategory.ENERGY]: { 0: 500, 1: 600 },
  [CommodityCategory.METAL]: { 0: 500, 1: 650 },
  [CommodityCategory.LIVESTOCK]: { 0: 400, 1: 350 },
  [CommodityCategory.FISHERY]: { 0: 400, 1: 0 },
  [CommodityCategory.FORESTRY]: { 0: 300, 1: 400 },
  [CommodityCategory.ELECTRONICS]: { 2: 800 },
  [CommodityCategory.AUTOMOTIVE]: { 2: 1000 },
};

/**
 * Valid levels per category.
 * L0/L1 categories: levels 0-1 only.
 * L2 categories: level 2 only.
 */
const VALID_LEVELS: Record<CommodityCategory, number[]> = {
  [CommodityCategory.AGRICULTURE]: [0, 1],
  [CommodityCategory.ENERGY]: [0, 1],
  [CommodityCategory.METAL]: [0, 1],
  [CommodityCategory.LIVESTOCK]: [0, 1],
  [CommodityCategory.FISHERY]: [0, 1],
  [CommodityCategory.FORESTRY]: [0, 1],
  [CommodityCategory.ELECTRONICS]: [2],
  [CommodityCategory.AUTOMOTIVE]: [2],
};

/**
 * Exclusive output groups define which recipe output slugs are valid
 * for factories that require exclusive output switching.
 *
 * - Poultry Processing: chicken-meat OR eggs
 * - Cattle Processing: beef OR milk
 * - Fishery: fish (direct to Butcher) OR frozen-fish (processed to Supermarket)
 */
const EXCLUSIVE_OUTPUT_GROUPS: Record<string, string[]> = {
  [CommodityCategory.LIVESTOCK]: ['chicken-meat', 'eggs', 'beef', 'milk'],
  [CommodityCategory.FISHERY]: ['fish', 'frozen-fish'],
};

/**
 * Sub-groups within categories to prevent cross-group switching.
 * e.g., a Poultry factory cannot switch to beef output.
 */
const EXCLUSIVE_OUTPUT_SUBGROUPS: Record<string, string[][]> = {
  [CommodityCategory.LIVESTOCK]: [
    ['chicken-meat', 'eggs'],   // poultry-processing
    ['beef', 'milk'],           // cattle-processing
  ],
  [CommodityCategory.FISHERY]: [
    ['fish', 'frozen-fish'],    // fishery
  ],
};

/** Duration of the output switch cooldown in milliseconds (72 hours). */
const OUTPUT_SWITCH_COOLDOWN_MS = 72 * 60 * 60 * 1000;

/**
 * Fertilizer configuration per category.
 * - Agriculture: 4 units of fertilizer for a 15% yield bonus
 * - Forestry: 6 units of fertilizer for a 12% yield bonus
 */
const FERTILIZER_CONFIG: Record<string, { quantity: number; bonus: number }> = {
  [CommodityCategory.AGRICULTURE]: { quantity: 4, bonus: 0.15 },
  [CommodityCategory.FORESTRY]: { quantity: 6, bonus: 0.12 },
};

/** Duration of the fertilizer boost in milliseconds (5 days). */
const FERTILIZER_BOOST_DURATION_MS = 5 * 24 * 60 * 60 * 1000;

/** Slug of the fertilizer commodity. */
const FERTILIZER_COMMODITY_SLUG = 'fertilizer';

@Injectable()
export class FactoryService {
  private readonly logger = new Logger(FactoryService.name);

  constructor(
    @InjectRepository(Factory)
    private readonly factoryRepository: Repository<Factory>,
    @InjectRepository(ProductionJob)
    private readonly productionJobRepository: Repository<ProductionJob>,
    @InjectRepository(MapTile)
    private readonly mapTileRepository: Repository<MapTile>,
    @InjectRepository(Season)
    private readonly seasonRepository: Repository<Season>,
    @InjectRepository(Commodity)
    private readonly commodityRepository: Repository<Commodity>,
    @InjectQueue(QUEUE_NAMES.FERTILIZER)
    private readonly fertilizerQueue: Queue,
    private readonly mapService: MapService,
    private readonly walletService: WalletService,
    private readonly inventoryService: InventoryService,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Construct a new factory on owned tiles.
   *
   * Validates:
   * - All tiles are owned by the player
   * - No tiles already have a factory assigned
   * - Terrain matches the category requirements (rejects CITY terrain)
   * - Factory level is valid for the category
   * - Player has sufficient coins
   *
   * Atomically:
   * - Deducts setup cost from wallet
   * - Creates factory record
   * - Marks tiles with the factory ID
   */
  async construct(playerId: string, dto: ConstructFactoryDto): Promise<Factory> {
    const level = dto.level ?? this.getDefaultLevel(dto.category);

    // Validate level is valid for this category
    const validLevels = VALID_LEVELS[dto.category];
    if (!validLevels || !validLevels.includes(level)) {
      throw new BadRequestException(
        `Level ${level} is not valid for category ${dto.category}. Valid levels: ${validLevels?.join(', ') ?? 'none'}`,
      );
    }

    // Get setup cost
    const setupCost = SETUP_COSTS[dto.category]?.[level];
    if (setupCost === undefined) {
      throw new BadRequestException(
        `No setup cost defined for category ${dto.category} at level ${level}`,
      );
    }

    // Get the active season
    const season = await this.seasonRepository.findOne({
      where: { status: SeasonStatus.ACTIVE },
    });
    if (!season) {
      throw new BadRequestException('No active season');
    }

    // Validate terrain
    if (dto.isShop) {
      // Shops require exactly 1 CITY tile
      if (dto.tileIds.length !== 1) {
        throw new BadRequestException('Shops require exactly 1 tile');
      }
      const shopTile = await this.mapTileRepository.findOneBy({ id: dto.tileIds[0] });
      if (!shopTile) {
        throw new BadRequestException('Tile not found');
      }
      if (shopTile.terrainType !== 'CITY') {
        throw new BadRequestException('Shops can only be built on CITY tiles');
      }
    } else {
      // Factory terrain validation via MapService
      const terrainValidation = await this.mapService.validateTerrain(dto.tileIds, dto.category, level);
      if (!terrainValidation.valid) {
        throw new BadRequestException(
          `Terrain validation failed: ${terrainValidation.errors.join('; ')}`,
        );
      }
    }

    // Fetch all tiles and validate ownership
    const tiles = await this.mapTileRepository.findBy({ id: In(dto.tileIds) });
    if (tiles.length !== dto.tileIds.length) {
      throw new BadRequestException(
        `Some tile IDs were not found. Expected ${dto.tileIds.length}, found ${tiles.length}`,
      );
    }

    for (const tile of tiles) {
      if (tile.ownerPlayerId !== playerId) {
        throw new ForbiddenException(
          `Tile ${tile.id} at (${tile.x}, ${tile.y}) is not owned by the player`,
        );
      }
      if (tile.factoryId !== null) {
        throw new BadRequestException(
          `Tile ${tile.id} at (${tile.x}, ${tile.y}) already has a factory assigned`,
        );
      }
    }

    // Execute atomically: deduct coins, create factory, assign tiles
    return this.dataSource.transaction(async (manager) => {
      // Deduct setup cost from wallet
      await this.walletService.executeTransactionWithManager(
        manager,
        playerId,
        season.id,
        TransactionType.FACTORY_PURCHASE,
        -setupCost,
        {
          referenceType: 'factory',
          description: `Factory construction: ${dto.category} L${level}`,
        },
      );

      // Create factory record
      // Resolve commodityId from slug if provided
      let resolvedCommodityId: string | null = dto.commodityId ?? null;
      if (resolvedCommodityId && !resolvedCommodityId.match(/^[0-9a-f]{8}-/i)) {
        // It's a slug, not a UUID — look it up
        const commodity = await manager.findOne(Commodity, { where: { slug: resolvedCommodityId } });
        resolvedCommodityId = commodity?.id ?? null;
      }

      const factory = manager.create(Factory, {
        playerId,
        seasonId: season.id,
        name: dto.name || `${dto.isShop ? 'Shop' : 'Factory'} ${await this.getNextFactoryNumber(manager, playerId, season.id)}`,
        commodityId: resolvedCommodityId,
        recipeId: dto.recipeId ?? null,
        category: dto.category,
        factoryLevel: level,
        isShop: dto.isShop ?? false,
        status: FactoryStatus.IDLE,
        efficiency: '100.00',
        maintenanceCount: 0,
        setupCost: setupCost.toFixed(2),
        lastDepreciationAt: null,
        fertilizerBoostActive: false,
        fertilizerBoostExpiresAt: null,
        exclusiveOutputSlug: null,
        outputSwitchCooldownUntil: null,
      });

      const savedFactory = await manager.save(Factory, factory);

      // Assign factory ID to all tiles
      await manager
        .createQueryBuilder()
        .update(MapTile)
        .set({ factoryId: savedFactory.id })
        .where('id IN (:...tileIds)', { tileIds: dto.tileIds })
        .execute();

      this.logger.log(
        `Factory constructed: id=${savedFactory.id}, category=${dto.category}, level=${level}, player=${playerId}`,
      );

      return savedFactory;
    });
  }

  /**
   * Get the next factory number for auto-naming.
   */
  private async getNextFactoryNumber(manager: any, playerId: string, seasonId: string): Promise<number> {
    const factories = await manager.find(Factory, { where: { playerId, seasonId }, select: ['id'] });
    return (factories?.length ?? 0) + 1;
  }

  /**
   * Rename a factory.
   */
  async renameFactory(playerId: string, factoryId: string, name: string): Promise<Factory> {
    const factory = await this.factoryRepository.findOne({
      where: { id: factoryId, playerId },
    });
    if (!factory) {
      throw new NotFoundException('Factory not found');
    }
    factory.name = name;
    return this.factoryRepository.save(factory);
  }

  /**
   * Get all factories for a player in the current active season.
   */
  async findAllByPlayer(playerId: string): Promise<Factory[]> {
    const season = await this.seasonRepository.findOne({
      where: { status: SeasonStatus.ACTIVE },
    });
    if (!season) {
      return [];
    }

    return this.factoryRepository.find({
      where: { playerId, seasonId: season.id },
      relations: ['workerAssignments', 'commodity'],
      order: { constructedAt: 'DESC' },
    });
  }

  /**
   * Get a single factory by ID, ensuring it belongs to the player.
   */
  async findOneByPlayer(playerId: string, factoryId: string): Promise<Factory> {
    const factory = await this.factoryRepository.findOne({
      where: { id: factoryId, playerId },
      relations: ['workerAssignments', 'workerAssignments.workerProfile', 'commodity', 'recipe'],
    });

    if (!factory) {
      throw new NotFoundException(`Factory ${factoryId} not found`);
    }

    return factory;
  }

  /**
   * Get recipe inputs for a factory with current player inventory quantities.
   * Returns empty array for L0 factories or factories without recipes.
   */
  async getRecipeInputsWithInventory(playerId: string, factory: Factory): Promise<{
    commodityId: string;
    commodityName: string;
    commoditySlug: string;
    quantityRequired: number;
    quantityInInventory: number;
  }[]> {
    if (!factory.recipeId && factory.factoryLevel === 0) return [];

    // Find recipe for this factory (by commodity or explicit recipeId)
    let recipeId = factory.recipeId;
    if (!recipeId && factory.commodityId) {
      // Find recipe that outputs this commodity
      const recipe = await this.dataSource.query(
        `SELECT id FROM recipes WHERE output_commodity_id = $1 LIMIT 1`,
        [factory.commodityId],
      );
      if (recipe.length > 0) recipeId = recipe[0].id;
    }

    if (!recipeId) return [];

    // Get recipe inputs
    const inputs = await this.dataSource.query(
      `SELECT ri.quantity, c.id as commodity_id, c.name, c.slug
       FROM recipe_inputs ri
       JOIN commodities c ON ri.commodity_id = c.id
       WHERE ri.recipe_id = $1`,
      [recipeId],
    );

    if (inputs.length === 0) return [];

    // Get player's current inventory for these commodities
    const season = await this.seasonRepository.findOne({ where: { status: SeasonStatus.ACTIVE } });
    if (!season) return inputs.map((i: any) => ({
      commodityId: i.commodity_id,
      commodityName: i.name,
      commoditySlug: i.slug,
      quantityRequired: i.quantity,
      quantityInInventory: 0,
    }));

    const inventoryRows = await this.dataSource.query(
      `SELECT commodity_id, quantity FROM inventory
       WHERE player_id = $1 AND season_id = $2 AND commodity_id = ANY($3)`,
      [playerId, season.id, inputs.map((i: any) => i.commodity_id)],
    );

    const inventoryMap = new Map(inventoryRows.map((r: any) => [r.commodity_id, r.quantity]));

    return inputs.map((i: any) => ({
      commodityId: i.commodity_id,
      commodityName: i.name,
      commoditySlug: i.slug,
      quantityRequired: i.quantity,
      quantityInInventory: inventoryMap.get(i.commodity_id) ?? 0,
    }));
  }

  /**
   * Get accepted goods for a shop, with current player inventory quantities.
   */
  async getShopAcceptedGoods(playerId: string, factory: Factory): Promise<{
    commodityId: string;
    commodityName: string;
    commoditySlug: string;
    quantityInInventory: number;
  }[]> {
    if (!factory.isShop) return [];

    // Determine shop type from factory name/category
    const shopTypeMap: Record<string, string> = {
      'AGRICULTURE': 'SUPERMARKET',
      'LIVESTOCK': 'BUTCHER',
      'ENERGY': 'PETROL_STATION',
      'FORESTRY': 'FURNITURE',
      'ELECTRONICS': 'ELECTRONICS',
      'AUTOMOTIVE': 'CAR_STORE',
    };

    // Check if shop name hints at a specific type
    const nameLower = factory.name.toLowerCase();
    let shopType = shopTypeMap[factory.category] || 'SUPERMARKET';
    if (nameLower.includes('butcher')) shopType = 'BUTCHER';
    if (nameLower.includes('cafe') || nameLower.includes('coffee')) shopType = 'CAFE';
    if (nameLower.includes('petrol') || nameLower.includes('gas') || nameLower.includes('fuel')) shopType = 'PETROL_STATION';
    if (nameLower.includes('furniture')) shopType = 'FURNITURE';
    if (nameLower.includes('electronic')) shopType = 'ELECTRONICS';
    if (nameLower.includes('car') || nameLower.includes('auto')) shopType = 'CAR_STORE';

    const accepted = await this.dataSource.query(
      `SELECT sac.commodity_id, c.name, c.slug
       FROM shop_accepted_commodities sac
       JOIN commodities c ON sac.commodity_id = c.id
       WHERE sac.shop_type = $1`,
      [shopType],
    );

    if (accepted.length === 0) return [];

    const season = await this.seasonRepository.findOne({ where: { status: SeasonStatus.ACTIVE } });
    if (!season) return accepted.map((a: any) => ({
      commodityId: a.commodity_id, commodityName: a.name, commoditySlug: a.slug, quantityInInventory: 0,
    }));

    const inventoryRows = await this.dataSource.query(
      `SELECT commodity_id, quantity FROM inventory WHERE player_id = $1 AND season_id = $2 AND commodity_id = ANY($3)`,
      [playerId, season.id, accepted.map((a: any) => a.commodity_id)],
    );
    const invMap = new Map(inventoryRows.map((r: any) => [r.commodity_id, r.quantity]));

    return accepted.map((a: any) => ({
      commodityId: a.commodity_id,
      commodityName: a.name,
      commoditySlug: a.slug,
      quantityInInventory: invMap.get(a.commodity_id) ?? 0,
    }));
  }

  /**
   * Deconstruct a factory, releasing its tiles and charging a 25% fee.
   *
   * Validates:
   * - Factory exists and belongs to the player
   * - Factory is IDLE (no active production)
   *
   * Atomically:
   * - Charges deconstruction fee (25% of setupCost) from wallet
   * - Releases all tiles (sets factoryId to null)
   * - Deletes the factory record
   *
   * Validates: Requirements 21.1, 21.2, 21.3, 21.5, 21.6, 21.7
   */
  async deconstruct(playerId: string, factoryId: string): Promise<{ fee: number }> {
    // Find factory and validate ownership
    const factory = await this.factoryRepository.findOne({
      where: { id: factoryId, playerId },
    });

    if (!factory) {
      throw new NotFoundException(`Factory ${factoryId} not found`);
    }

    // Factory must be IDLE to deconstruct
    if (factory.status !== FactoryStatus.IDLE) {
      throw new BadRequestException(
        `Factory must be IDLE to deconstruct. Current status: ${factory.status}`,
      );
    }

    const setupCost = parseFloat(factory.setupCost);
    const fee = calculateDeconstructionFee(setupCost);

    return this.dataSource.transaction(async (manager) => {
      // Charge deconstruction fee
      await this.walletService.executeTransactionWithManager(
        manager,
        playerId,
        factory.seasonId,
        TransactionType.FACTORY_DECONSTRUCTION,
        -fee,
        {
          referenceType: 'factory',
          referenceId: factoryId,
          description: `Factory deconstruction fee: ${factory.category} L${factory.factoryLevel}`,
        },
      );

      // Release all tiles assigned to this factory
      await manager
        .createQueryBuilder()
        .update(MapTile)
        .set({ factoryId: null })
        .where('factory_id = :factoryId', { factoryId })
        .execute();

      // Delete the factory record
      await manager.remove(Factory, factory);

      this.logger.log(
        `Factory deconstructed: id=${factoryId}, fee=${fee.toFixed(2)}, player=${playerId}`,
      );

      return { fee };
    });
  }

  /**
   * Perform maintenance on a factory, restoring efficiency.
   *
   * Validates:
   * - Factory exists and belongs to the player
   * - Factory efficiency is below maximum (maintenance would have an effect)
   *
   * Atomically:
   * - Charges maintenance cost (15% of setupCost) from wallet
   * - Increments maintenanceCount
   * - Restores efficiency to max: 100 - (maintenanceCount * 5)
   *
   * Validates: Requirements 22.4, 22.5, 22.6
   */
  async performMaintenance(
    playerId: string,
    factoryId: string,
  ): Promise<{ newEfficiency: number; maintenanceCount: number; cost: number }> {
    // Find factory and validate ownership
    const factory = await this.factoryRepository.findOne({
      where: { id: factoryId, playerId },
    });

    if (!factory) {
      throw new NotFoundException(`Factory ${factoryId} not found`);
    }

    const setupCost = parseFloat(factory.setupCost);
    const cost = calculateMaintenanceCost(setupCost);

    // Calculate what the new max efficiency would be after this maintenance
    const newMaintenanceCount = factory.maintenanceCount + 1;
    const newMaxEfficiency = calculateMaxEfficiency(newMaintenanceCount);

    // Check if maintenance is useful (efficiency can still be restored)
    const currentEfficiency = parseFloat(factory.efficiency);
    if (currentEfficiency >= newMaxEfficiency) {
      throw new BadRequestException(
        `Factory is already at or above the maximum achievable efficiency (${newMaxEfficiency}%). Maintenance would have no effect.`,
      );
    }

    return this.dataSource.transaction(async (manager) => {
      // Charge maintenance cost
      await this.walletService.executeTransactionWithManager(
        manager,
        playerId,
        factory.seasonId,
        TransactionType.FACTORY_MAINTENANCE,
        -cost,
        {
          referenceType: 'factory',
          referenceId: factoryId,
          description: `Factory maintenance: ${factory.category} L${factory.factoryLevel}`,
        },
      );

      // Update factory: increment maintenance count and restore efficiency
      factory.maintenanceCount = newMaintenanceCount;
      factory.efficiency = newMaxEfficiency.toFixed(2);
      await manager.save(Factory, factory);

      this.logger.log(
        `Factory maintained: id=${factoryId}, newEfficiency=${newMaxEfficiency}%, maintenanceCount=${newMaintenanceCount}, cost=${cost.toFixed(2)}, player=${playerId}`,
      );

      return {
        newEfficiency: newMaxEfficiency,
        maintenanceCount: newMaintenanceCount,
        cost,
      };
    });
  }

  /**
   * Switch a factory's exclusive output recipe.
   *
   * Validates:
   * - Factory exists and belongs to the player
   * - Factory category supports exclusive output switching (LIVESTOCK or FISHERY)
   * - The new output slug is valid for this factory's sub-group
   * - Factory is IDLE (no active production job)
   * - The 72-hour cooldown has expired (or no switch has been made yet)
   *
   * On success:
   * - Sets exclusive_output_slug to the new recipe slug
   * - Sets output_switch_cooldown_until to NOW + 72 hours
   *
   * Validates: Requirements 27.1, 27.2, 27.3, 27.4, 27.5, 27.6, 27.7
   */
  async switchOutput(
    playerId: string,
    factoryId: string,
    newOutputSlug: string,
  ): Promise<{ factoryId: string; oldOutput: string | null; newOutput: string; cooldownUntil: Date }> {
    // Find factory and validate ownership
    const factory = await this.factoryRepository.findOne({
      where: { id: factoryId, playerId },
    });

    if (!factory) {
      throw new NotFoundException(`Factory ${factoryId} not found`);
    }

    // Validate factory category supports exclusive output
    const category = factory.category as CommodityCategory;
    const validSlugs = EXCLUSIVE_OUTPUT_GROUPS[category];
    if (!validSlugs) {
      throw new BadRequestException(
        `Factory category ${category} does not support exclusive output switching. Only LIVESTOCK and FISHERY factories support this feature.`,
      );
    }

    // Validate the output slug is valid for this category
    if (!validSlugs.includes(newOutputSlug)) {
      throw new BadRequestException(
        `Invalid output slug "${newOutputSlug}" for category ${category}. Valid options: ${validSlugs.join(', ')}`,
      );
    }

    // Validate the output slug belongs to the correct sub-group
    // (e.g., a Poultry factory can't switch to beef)
    const subGroups = EXCLUSIVE_OUTPUT_SUBGROUPS[category];
    if (subGroups && factory.exclusiveOutputSlug) {
      const currentSubGroup = subGroups.find((group) =>
        group.includes(factory.exclusiveOutputSlug!),
      );
      const targetSubGroup = subGroups.find((group) => group.includes(newOutputSlug));

      if (currentSubGroup && targetSubGroup && currentSubGroup !== targetSubGroup) {
        throw new BadRequestException(
          `Cannot switch from "${factory.exclusiveOutputSlug}" to "${newOutputSlug}". These belong to different production groups.`,
        );
      }
    }

    // Validate factory is IDLE — check for active production jobs
    const activeJob = await this.productionJobRepository.findOne({
      where: {
        factoryId,
        status: In([ProductionJobStatus.ACTIVE, ProductionJobStatus.PAUSED]),
      },
    });

    if (activeJob) {
      throw new ConflictException(
        `Cannot switch output while a production job is active. Current job status: ${activeJob.status}. Production must complete first.`,
      );
    }

    if (factory.status !== FactoryStatus.IDLE) {
      throw new ConflictException(
        `Factory must be IDLE to switch output. Current status: ${factory.status}`,
      );
    }

    // Validate 72-hour cooldown has expired
    if (factory.outputSwitchCooldownUntil) {
      const now = new Date();
      if (factory.outputSwitchCooldownUntil > now) {
        const remainingMs = factory.outputSwitchCooldownUntil.getTime() - now.getTime();
        const remainingHours = Math.ceil(remainingMs / (60 * 60 * 1000));
        throw new ConflictException(
          `Output switch is on cooldown. ${remainingHours} hour(s) remaining until ${factory.outputSwitchCooldownUntil.toISOString()}.`,
        );
      }
    }

    // Don't switch if already set to same output
    if (factory.exclusiveOutputSlug === newOutputSlug) {
      throw new BadRequestException(
        `Factory is already producing "${newOutputSlug}". No switch needed.`,
      );
    }

    // Perform the switch
    const oldOutput = factory.exclusiveOutputSlug;
    const cooldownUntil = new Date(Date.now() + OUTPUT_SWITCH_COOLDOWN_MS);

    factory.exclusiveOutputSlug = newOutputSlug;
    factory.outputSwitchCooldownUntil = cooldownUntil;
    await this.factoryRepository.save(factory);

    this.logger.log(
      `Factory output switched: id=${factoryId}, from="${oldOutput}" to="${newOutputSlug}", cooldownUntil=${cooldownUntil.toISOString()}, player=${playerId}`,
    );

    return {
      factoryId,
      oldOutput,
      newOutput: newOutputSlug,
      cooldownUntil,
    };
  }

  /**
   * Apply fertilizer boost to a factory.
   *
   * Validates:
   * - Factory exists and belongs to the player
   * - Factory category is AGRICULTURE or FORESTRY
   * - Factory does not already have an active fertilizer boost
   * - Player has sufficient fertilizer in inventory
   *
   * On success:
   * - Consumes configured fertilizer quantity from player's inventory
   * - Sets fertilizerBoostActive = true, fertilizerBoostExpiresAt = NOW + 5 days
   * - Schedules a BullMQ 'fertilizer.expire' job with delay = 5 days
   *
   * Validates: Requirements 6.6, 6.7, 6.8, 6.9, 6.10
   */
  async applyFertilizer(
    playerId: string,
    factoryId: string,
  ): Promise<{ factoryId: string; expiresAt: Date; quantityConsumed: number; bonus: number }> {
    // Find factory and validate ownership
    const factory = await this.factoryRepository.findOne({
      where: { id: factoryId, playerId },
    });

    if (!factory) {
      throw new NotFoundException(`Factory ${factoryId} not found`);
    }

    // Validate category supports fertilizer
    const category = factory.category as CommodityCategory;
    const config = FERTILIZER_CONFIG[category];
    if (!config) {
      throw new BadRequestException(
        `Factory category ${category} does not support fertilizer. Only AGRICULTURE and FORESTRY factories can use fertilizer.`,
      );
    }

    // Validate no active fertilizer boost
    if (factory.fertilizerBoostActive && factory.fertilizerBoostExpiresAt) {
      const now = new Date();
      if (factory.fertilizerBoostExpiresAt > now) {
        throw new BadRequestException(
          `Factory already has an active fertilizer boost until ${factory.fertilizerBoostExpiresAt.toISOString()}`,
        );
      }
    }

    // Look up the fertilizer commodity by slug
    const fertilizerCommodity = await this.commodityRepository.findOne({
      where: { slug: FERTILIZER_COMMODITY_SLUG },
    });

    if (!fertilizerCommodity) {
      throw new NotFoundException('Fertilizer commodity not found in the database');
    }

    // Consume fertilizer from player's inventory
    await this.inventoryService.removeFromInventory(
      playerId,
      factory.seasonId,
      fertilizerCommodity.id,
      config.quantity,
    );

    // Set boost active with expiry
    const expiresAt = new Date(Date.now() + FERTILIZER_BOOST_DURATION_MS);
    factory.fertilizerBoostActive = true;
    factory.fertilizerBoostExpiresAt = expiresAt;
    await this.factoryRepository.save(factory);

    // Schedule expiry job
    await this.fertilizerQueue.add(
      'fertilizer.expire',
      {
        factoryId,
        playerId,
        seasonId: factory.seasonId,
        fertilizerCommodityId: fertilizerCommodity.id,
        requiredQuantity: config.quantity,
      },
      {
        delay: FERTILIZER_BOOST_DURATION_MS,
        jobId: `fertilizer-expire-${factoryId}`,
        removeOnComplete: true,
      },
    );

    this.logger.log(
      `Fertilizer applied: factoryId=${factoryId}, category=${category}, quantity=${config.quantity}, expiresAt=${expiresAt.toISOString()}, player=${playerId}`,
    );

    return {
      factoryId,
      expiresAt,
      quantityConsumed: config.quantity,
      bonus: config.bonus,
    };
  }

  /**
   * Get the default level for a category:
   * - Electronics/Automotive default to 2
   * - All others default to 0
   */
  private getDefaultLevel(category: CommodityCategory): number {
    if (
      category === CommodityCategory.ELECTRONICS ||
      category === CommodityCategory.AUTOMOTIVE
    ) {
      return 2;
    }
    return 0;
  }
}
