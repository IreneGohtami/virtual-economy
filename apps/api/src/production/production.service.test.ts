import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProductionService } from './production.service';
import {
  CommodityCategory,
  FactoryStatus,
  ProductionJobStatus,
  SeasonStatus,
} from '@sea-commodity-tycoon/shared-types';
import { DataSource, Repository } from 'typeorm';
import { Queue } from 'bullmq';
import { ProductionJob } from '../entities/production-job.entity';
import { Factory } from '../entities/factory.entity';
import { Commodity } from '../entities/commodity.entity';
import { Recipe } from '../entities/recipe.entity';
import { RecipeInput } from '../entities/recipe-input.entity';
import { Inventory } from '../entities/inventory.entity';
import { WorkerAssignment } from '../entities/worker-assignment.entity';
import { PlayerSeason } from '../entities/player-season.entity';
import { Season } from '../entities/season.entity';
import { InventoryService } from '../inventory/inventory.service';

describe('ProductionService - L1/L2 Production Paths', () => {
  let service: ProductionService;
  let mockProductionJobRepo: Partial<Repository<ProductionJob>>;
  let mockFactoryRepo: Partial<Repository<Factory>>;
  let mockCommodityRepo: Partial<Repository<Commodity>>;
  let mockRecipeRepo: Partial<Repository<Recipe>>;
  let mockRecipeInputRepo: Partial<Repository<RecipeInput>>;
  let mockInventoryRepo: Partial<Repository<Inventory>>;
  let mockWorkerAssignmentRepo: Partial<Repository<WorkerAssignment>>;
  let mockPlayerSeasonRepo: Partial<Repository<PlayerSeason>>;
  let mockSeasonRepo: Partial<Repository<Season>>;
  let mockProductionQueue: Partial<Queue>;
  let mockDataSource: Partial<DataSource>;
  let mockInventoryService: Partial<InventoryService>;

  const playerId = '11111111-1111-1111-1111-111111111111';
  const seasonId = '22222222-2222-2222-2222-222222222222';
  const factoryId = '33333333-3333-3333-3333-333333333333';
  const commodityId = '44444444-4444-4444-4444-444444444444';
  const recipeId = '66666666-6666-6666-6666-666666666666';
  const inputCommodityId1 = '77777777-7777-7777-7777-777777777771';
  const inputCommodityId2 = '77777777-7777-7777-7777-777777777772';

  const mockSeason: Partial<Season> = {
    id: seasonId,
    status: SeasonStatus.ACTIVE,
    startsAt: new Date('2024-01-01'),
    endsAt: new Date('2024-01-31'),
  };

  const createMockCommodity = (overrides: Partial<Commodity> = {}): Commodity => ({
    id: commodityId,
    name: 'Flour',
    slug: 'flour',
    category: CommodityCategory.AGRICULTURE,
    level: 1,
    basePrice: '50.00',
    baseProductionTimeMinutes: 120,
    baseYield: 5,
    storageSize: 1,
    maxWorkers: 2,
    terrainRequirement: null,
    landLayout: null,
    setupCost: '350.00',
    metadata: {},
    active: true,
    ...overrides,
  } as Commodity);

  const createMockRecipe = (overrides: Partial<Recipe> = {}): Recipe => ({
    id: recipeId,
    name: 'Rice to Flour',
    slug: 'rice-to-flour',
    processingTimeMinutes: 120,
    workerRequirement: 1,
    outputCommodityId: commodityId,
    outputQuantity: 5,
    factoryCategory: CommodityCategory.AGRICULTURE,
    metadata: {},
    active: true,
    outputCommodity: createMockCommodity(),
    inputs: [],
    ...overrides,
  } as Recipe);

  const createMockFactory = (overrides: Partial<Factory> = {}): Factory => ({
    id: factoryId,
    playerId,
    seasonId,
    commodityId: null,
    recipeId,
    category: CommodityCategory.AGRICULTURE,
    factoryLevel: 1,
    status: FactoryStatus.IDLE,
    efficiency: '100.00',
    maintenanceCount: 0,
    setupCost: '350.00',
    lastDepreciationAt: null,
    fertilizerBoostActive: false,
    fertilizerBoostExpiresAt: null,
    exclusiveOutputSlug: null,
    outputSwitchCooldownUntil: null,
    constructedAt: new Date('2024-01-01'),
    commodity: null,
    ...overrides,
  } as Factory);

  const createMockWorkerAssignment = (overrides: Partial<WorkerAssignment> = {}): WorkerAssignment => ({
    id: 'wa-1',
    workerId: 'worker-1',
    playerId,
    factoryId,
    seasonId,
    status: 'WORKING',
    hiredAt: new Date(),
    statusChangedAt: null,
    disruptionEndsAt: null,
    workerProfile: {
      id: 'worker-1',
      name: 'Worker 1',
      specialty: CommodityCategory.AGRICULTURE,
      experienceLevel: 3,
    },
    ...overrides,
  } as unknown as WorkerAssignment);

  const createMockPlayerSeason = (overrides: Partial<PlayerSeason> = {}): PlayerSeason => ({
    id: 'ps-1',
    playerId,
    seasonId,
    specialty: CommodityCategory.AGRICULTURE,
    coins: '5000.00',
    storageCapacity: 500,
    workforceHappiness: '80.00',
    lastHappinessDecayAt: null,
    inactivityReminderSent: false,
    createdAt: new Date(),
    ...overrides,
  } as PlayerSeason);

  beforeEach(() => {
    mockProductionJobRepo = {
      findOne: vi.fn(),
      find: vi.fn(),
      save: vi.fn().mockImplementation((entity) => Promise.resolve(entity)),
    };

    mockFactoryRepo = {
      findOne: vi.fn(),
      findOneBy: vi.fn(),
      save: vi.fn().mockImplementation((entity) => Promise.resolve(entity)),
    };

    mockCommodityRepo = {
      findOne: vi.fn(),
      findOneBy: vi.fn(),
    };

    mockRecipeRepo = { findOne: vi.fn() };
    mockRecipeInputRepo = { find: vi.fn() };
    mockInventoryRepo = {
      findOne: vi.fn(),
      createQueryBuilder: vi.fn().mockReturnValue({
        update: vi.fn().mockReturnThis(),
        set: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        execute: vi.fn().mockResolvedValue(undefined),
      }),
    };
    mockWorkerAssignmentRepo = { find: vi.fn() };
    mockPlayerSeasonRepo = { findOne: vi.fn() };
    mockSeasonRepo = { findOne: vi.fn() };

    mockProductionQueue = {
      add: vi.fn().mockResolvedValue({ id: 'bull-job-1' }),
    };

    mockDataSource = {
      transaction: vi.fn().mockImplementation(async (cb) => {
        const mockManager = {
          create: vi.fn().mockImplementation((_entity, data) => ({
            id: 'new-job-id',
            ...data,
          })),
          save: vi.fn().mockImplementation((_entity, data) => Promise.resolve({
            id: data.id ?? 'new-job-id',
            ...data,
          })),
        };
        return cb(mockManager);
      }),
    };

    mockInventoryService = {
      hasCapacityFor: vi.fn().mockResolvedValue(true),
      addToInventory: vi.fn().mockResolvedValue({ id: 'inv-1', quantity: 1 }),
    };

    service = new ProductionService(
      mockProductionJobRepo as Repository<ProductionJob>,
      mockFactoryRepo as Repository<Factory>,
      mockCommodityRepo as Repository<Commodity>,
      mockRecipeRepo as Repository<Recipe>,
      mockRecipeInputRepo as Repository<RecipeInput>,
      mockInventoryRepo as Repository<Inventory>,
      mockWorkerAssignmentRepo as Repository<WorkerAssignment>,
      mockPlayerSeasonRepo as Repository<PlayerSeason>,
      mockSeasonRepo as Repository<Season>,
      mockProductionQueue as Queue,
      mockDataSource as DataSource,
      mockInventoryService as InventoryService,
    );
  });

  describe('L1 recipe with single input succeeds', () => {
    it('should start production for L1 processing factory with a recipe', async () => {
      const factory = createMockFactory({ factoryLevel: 1 });
      const recipe = createMockRecipe({ workerRequirement: 1 });
      const worker = createMockWorkerAssignment();
      const playerSeason = createMockPlayerSeason();
      const inputCommodity = createMockCommodity({
        id: inputCommodityId1,
        slug: 'rice',
        name: 'Rice',
      });

      mockSeasonRepo.findOne = vi.fn().mockResolvedValue(mockSeason);
      mockFactoryRepo.findOne = vi.fn().mockResolvedValue(factory);
      mockWorkerAssignmentRepo.find = vi.fn().mockResolvedValue([worker]);
      mockRecipeRepo.findOne = vi.fn().mockResolvedValue(recipe);
      mockPlayerSeasonRepo.findOne = vi.fn().mockResolvedValue(playerSeason);
      mockRecipeInputRepo.find = vi.fn().mockResolvedValue([
        { id: 'ri-1', recipeId, commodityId: inputCommodityId1, quantity: 3, commodity: inputCommodity },
      ]);
      // Inventory has sufficient stock
      mockInventoryRepo.findOne = vi.fn().mockResolvedValue({
        id: 'inv-1',
        playerId,
        seasonId,
        commodityId: inputCommodityId1,
        quantity: 10,
      });

      const result = await service.startProduction(playerId, { factoryId, recipeId });

      expect(result).toBeDefined();
      expect(result.id).toBe('new-job-id');
      // Recipe was resolved
      expect(mockRecipeRepo.findOne).toHaveBeenCalledWith({
        where: { id: recipeId },
        relations: ['outputCommodity'],
      });
      // Input commodities were consumed
      expect(mockInventoryRepo.createQueryBuilder).toHaveBeenCalled();
      // BullMQ job was scheduled
      expect(mockProductionQueue.add).toHaveBeenCalledWith(
        'production.increment',
        expect.objectContaining({ commodityId }),
        expect.any(Object),
      );
    });
  });

  describe('L2 recipe with multiple inputs succeeds when 2 workers assigned', () => {
    it('should start production for L2 assembly factory with 2 workers and multiple inputs', async () => {
      const outputCommodity = createMockCommodity({
        id: 'output-mobile-phone',
        slug: 'mobile-phone',
        name: 'Mobile Phone',
        category: CommodityCategory.ELECTRONICS,
        level: 2,
      });
      const recipe = createMockRecipe({
        name: 'Mobile Phone Assembly',
        slug: 'mobile-phone-assembly',
        factoryCategory: CommodityCategory.ELECTRONICS,
        workerRequirement: 2,
        outputCommodityId: outputCommodity.id,
        outputCommodity,
        outputQuantity: 2,
        processingTimeMinutes: 240,
      });
      const factory = createMockFactory({
        factoryLevel: 2,
        category: CommodityCategory.ELECTRONICS,
        recipeId: recipe.id,
      });
      const worker1 = createMockWorkerAssignment({ id: 'wa-1', workerId: 'worker-1' });
      const worker2 = createMockWorkerAssignment({
        id: 'wa-2',
        workerId: 'worker-2',
        workerProfile: {
          id: 'worker-2',
          name: 'Worker 2',
          specialty: CommodityCategory.ELECTRONICS,
          experienceLevel: 4,
        } as any,
      });
      const playerSeason = createMockPlayerSeason({
        specialty: CommodityCategory.ELECTRONICS,
      });

      const plasticCommodity = createMockCommodity({ id: inputCommodityId1, slug: 'plastic', name: 'Plastic' });
      const batteryCommodity = createMockCommodity({ id: inputCommodityId2, slug: 'battery', name: 'Battery' });

      mockSeasonRepo.findOne = vi.fn().mockResolvedValue(mockSeason);
      mockFactoryRepo.findOne = vi.fn().mockResolvedValue(factory);
      mockWorkerAssignmentRepo.find = vi.fn().mockResolvedValue([worker1, worker2]);
      mockRecipeRepo.findOne = vi.fn().mockResolvedValue(recipe);
      mockPlayerSeasonRepo.findOne = vi.fn().mockResolvedValue(playerSeason);
      mockRecipeInputRepo.find = vi.fn().mockResolvedValue([
        { id: 'ri-1', recipeId: recipe.id, commodityId: inputCommodityId1, quantity: 2, commodity: plasticCommodity },
        { id: 'ri-2', recipeId: recipe.id, commodityId: inputCommodityId2, quantity: 1, commodity: batteryCommodity },
      ]);
      // Both inputs have sufficient stock
      mockInventoryRepo.findOne = vi.fn()
        .mockResolvedValueOnce({ id: 'inv-1', playerId, seasonId, commodityId: inputCommodityId1, quantity: 5 })
        .mockResolvedValueOnce({ id: 'inv-2', playerId, seasonId, commodityId: inputCommodityId2, quantity: 3 });

      const result = await service.startProduction(playerId, { factoryId, recipeId: recipe.id });

      expect(result).toBeDefined();
      expect(result.id).toBe('new-job-id');
      // Verify inputs were consumed (2 inputs = 2 query builder calls)
      expect(mockInventoryRepo.createQueryBuilder).toHaveBeenCalledTimes(2);
      expect(mockProductionQueue.add).toHaveBeenCalled();
    });
  });

  describe('L2 recipe rejected when only 1 worker', () => {
    it('should reject L2 production when factory has only 1 worker but recipe requires 2', async () => {
      const outputCommodity = createMockCommodity({
        id: 'output-mobile-phone',
        slug: 'mobile-phone',
        name: 'Mobile Phone',
        category: CommodityCategory.ELECTRONICS,
        level: 2,
      });
      const recipe = createMockRecipe({
        name: 'Mobile Phone Assembly',
        slug: 'mobile-phone-assembly',
        factoryCategory: CommodityCategory.ELECTRONICS,
        workerRequirement: 2,
        outputCommodityId: outputCommodity.id,
        outputCommodity,
      });
      const factory = createMockFactory({
        factoryLevel: 2,
        category: CommodityCategory.ELECTRONICS,
        recipeId: recipe.id,
      });
      const singleWorker = createMockWorkerAssignment();
      const playerSeason = createMockPlayerSeason();

      mockSeasonRepo.findOne = vi.fn().mockResolvedValue(mockSeason);
      mockFactoryRepo.findOne = vi.fn().mockResolvedValue(factory);
      mockWorkerAssignmentRepo.find = vi.fn().mockResolvedValue([singleWorker]);
      mockRecipeRepo.findOne = vi.fn().mockResolvedValue(recipe);
      mockPlayerSeasonRepo.findOne = vi.fn().mockResolvedValue(playerSeason);

      await expect(
        service.startProduction(playerId, { factoryId, recipeId: recipe.id }),
      ).rejects.toThrow(/requires at least 2 worker/);
    });

    it('should reject L2 factory even without explicit recipe workerRequirement (defaults to 2)', async () => {
      const outputCommodity = createMockCommodity({
        id: 'output-automobile',
        slug: 'automobile',
        name: 'Automobile',
        category: CommodityCategory.AUTOMOTIVE,
        level: 2,
      });
      // Recipe with workerRequirement not explicitly set (but factory is L2)
      const recipe = createMockRecipe({
        name: 'Automobile Assembly',
        slug: 'automobile-assembly',
        factoryCategory: CommodityCategory.AUTOMOTIVE,
        workerRequirement: undefined as unknown as number,
        outputCommodityId: outputCommodity.id,
        outputCommodity,
      });
      const factory = createMockFactory({
        factoryLevel: 2,
        category: CommodityCategory.AUTOMOTIVE,
        recipeId: recipe.id,
      });
      const singleWorker = createMockWorkerAssignment();

      mockSeasonRepo.findOne = vi.fn().mockResolvedValue(mockSeason);
      mockFactoryRepo.findOne = vi.fn().mockResolvedValue(factory);
      mockWorkerAssignmentRepo.find = vi.fn().mockResolvedValue([singleWorker]);
      mockRecipeRepo.findOne = vi.fn().mockResolvedValue(recipe);
      mockPlayerSeasonRepo.findOne = vi.fn().mockResolvedValue(createMockPlayerSeason());

      // factoryLevel === 2 should default required workers to 2
      await expect(
        service.startProduction(playerId, { factoryId, recipeId: recipe.id }),
      ).rejects.toThrow(/requires at least 2 worker/);
    });
  });

  describe('Recipe rejected if factory category does not match', () => {
    it('should reject when recipe factoryCategory differs from factory category', async () => {
      const recipe = createMockRecipe({
        factoryCategory: CommodityCategory.METAL, // Recipe is for METAL
      });
      const factory = createMockFactory({
        category: CommodityCategory.AGRICULTURE, // Factory is AGRICULTURE
        factoryLevel: 1,
      });
      const worker = createMockWorkerAssignment();

      mockSeasonRepo.findOne = vi.fn().mockResolvedValue(mockSeason);
      mockFactoryRepo.findOne = vi.fn().mockResolvedValue(factory);
      mockWorkerAssignmentRepo.find = vi.fn().mockResolvedValue([worker]);
      mockRecipeRepo.findOne = vi.fn().mockResolvedValue(recipe);

      await expect(
        service.startProduction(playerId, { factoryId, recipeId }),
      ).rejects.toThrow(/Recipe .* is for category METAL, but factory is category AGRICULTURE/);
    });
  });

  describe('Insufficient input commodities rejected', () => {
    it('should reject when player does not have enough input commodities', async () => {
      const recipe = createMockRecipe({ workerRequirement: 1 });
      const factory = createMockFactory({ factoryLevel: 1 });
      const worker = createMockWorkerAssignment();
      const playerSeason = createMockPlayerSeason();
      const inputCommodity = createMockCommodity({
        id: inputCommodityId1,
        slug: 'rice',
        name: 'Rice',
      });

      mockSeasonRepo.findOne = vi.fn().mockResolvedValue(mockSeason);
      mockFactoryRepo.findOne = vi.fn().mockResolvedValue(factory);
      mockWorkerAssignmentRepo.find = vi.fn().mockResolvedValue([worker]);
      mockRecipeRepo.findOne = vi.fn().mockResolvedValue(recipe);
      mockPlayerSeasonRepo.findOne = vi.fn().mockResolvedValue(playerSeason);
      mockRecipeInputRepo.find = vi.fn().mockResolvedValue([
        { id: 'ri-1', recipeId, commodityId: inputCommodityId1, quantity: 5, commodity: inputCommodity },
      ]);
      // Only 2 units available, need 5
      mockInventoryRepo.findOne = vi.fn().mockResolvedValue({
        id: 'inv-1',
        playerId,
        seasonId,
        commodityId: inputCommodityId1,
        quantity: 2,
      });

      await expect(
        service.startProduction(playerId, { factoryId, recipeId }),
      ).rejects.toThrow(/Insufficient inventory for "Rice": need 5, have 2/);
    });

    it('should reject when player has no inventory of required input', async () => {
      const recipe = createMockRecipe({ workerRequirement: 1 });
      const factory = createMockFactory({ factoryLevel: 1 });
      const worker = createMockWorkerAssignment();
      const playerSeason = createMockPlayerSeason();
      const inputCommodity = createMockCommodity({
        id: inputCommodityId1,
        slug: 'rice',
        name: 'Rice',
      });

      mockSeasonRepo.findOne = vi.fn().mockResolvedValue(mockSeason);
      mockFactoryRepo.findOne = vi.fn().mockResolvedValue(factory);
      mockWorkerAssignmentRepo.find = vi.fn().mockResolvedValue([worker]);
      mockRecipeRepo.findOne = vi.fn().mockResolvedValue(recipe);
      mockPlayerSeasonRepo.findOne = vi.fn().mockResolvedValue(playerSeason);
      mockRecipeInputRepo.find = vi.fn().mockResolvedValue([
        { id: 'ri-1', recipeId, commodityId: inputCommodityId1, quantity: 3, commodity: inputCommodity },
      ]);
      // No inventory record at all
      mockInventoryRepo.findOne = vi.fn().mockResolvedValue(null);

      await expect(
        service.startProduction(playerId, { factoryId, recipeId }),
      ).rejects.toThrow(/Insufficient inventory for "Rice": need 3, have 0/);
    });
  });

  describe('Fish dual-route via exclusive output slug', () => {
    it('should allow production using exclusive_output_slug for fishery factory (direct fish route)', async () => {
      const fishCommodity = createMockCommodity({
        id: 'fish-commodity-id',
        slug: 'fish',
        name: 'Fish',
        category: CommodityCategory.FISHERY,
        baseYield: 8,
        baseProductionTimeMinutes: 90,
      });
      const factory = createMockFactory({
        factoryLevel: 0,
        category: CommodityCategory.FISHERY,
        commodityId: null,
        recipeId: null,
        exclusiveOutputSlug: 'fish', // Fish direct route
      });
      const worker = createMockWorkerAssignment();
      const playerSeason = createMockPlayerSeason({
        specialty: CommodityCategory.FISHERY,
      });

      mockSeasonRepo.findOne = vi.fn().mockResolvedValue(mockSeason);
      mockFactoryRepo.findOne = vi.fn().mockResolvedValue(factory);
      mockWorkerAssignmentRepo.find = vi.fn().mockResolvedValue([worker]);
      mockCommodityRepo.findOne = vi.fn().mockResolvedValue(fishCommodity);
      mockPlayerSeasonRepo.findOne = vi.fn().mockResolvedValue(playerSeason);
      mockRecipeInputRepo.find = vi.fn().mockResolvedValue([]);

      const result = await service.startProduction(playerId, { factoryId });

      expect(result).toBeDefined();
      // Should have resolved fish commodity via exclusive_output_slug
      expect(mockCommodityRepo.findOne).toHaveBeenCalledWith({
        where: { slug: 'fish' },
      });
      expect(mockProductionQueue.add).toHaveBeenCalledWith(
        'production.increment',
        expect.objectContaining({ commodityId: 'fish-commodity-id' }),
        expect.any(Object),
      );
    });

    it('should allow L1 frozen-fish processing for fishery factory (processed route)', async () => {
      const frozenFishCommodity = createMockCommodity({
        id: 'frozen-fish-id',
        slug: 'frozen-fish',
        name: 'Frozen Fish',
        category: CommodityCategory.FISHERY,
        level: 1,
      });
      const fishInputCommodity = createMockCommodity({
        id: 'fish-commodity-id',
        slug: 'fish',
        name: 'Fish',
        category: CommodityCategory.FISHERY,
      });
      const recipe = createMockRecipe({
        id: 'frozen-fish-recipe-id',
        name: 'Fish to Frozen Fish',
        slug: 'fish-to-frozen-fish',
        factoryCategory: CommodityCategory.FISHERY,
        workerRequirement: 1,
        outputCommodityId: frozenFishCommodity.id,
        outputCommodity: frozenFishCommodity,
        outputQuantity: 4,
        processingTimeMinutes: 60,
      });
      const factory = createMockFactory({
        factoryLevel: 1,
        category: CommodityCategory.FISHERY,
        recipeId: recipe.id,
        exclusiveOutputSlug: 'frozen-fish', // Frozen fish processing route
      });
      const worker = createMockWorkerAssignment();
      const playerSeason = createMockPlayerSeason({
        specialty: CommodityCategory.FISHERY,
      });

      mockSeasonRepo.findOne = vi.fn().mockResolvedValue(mockSeason);
      mockFactoryRepo.findOne = vi.fn().mockResolvedValue(factory);
      mockWorkerAssignmentRepo.find = vi.fn().mockResolvedValue([worker]);
      mockRecipeRepo.findOne = vi.fn().mockResolvedValue(recipe);
      mockPlayerSeasonRepo.findOne = vi.fn().mockResolvedValue(playerSeason);
      mockRecipeInputRepo.find = vi.fn().mockResolvedValue([
        { id: 'ri-1', recipeId: recipe.id, commodityId: 'fish-commodity-id', quantity: 3, commodity: fishInputCommodity },
      ]);
      mockInventoryRepo.findOne = vi.fn().mockResolvedValue({
        id: 'inv-1',
        playerId,
        seasonId,
        commodityId: 'fish-commodity-id',
        quantity: 10,
      });

      const result = await service.startProduction(playerId, {
        factoryId,
        recipeId: recipe.id,
      });

      expect(result).toBeDefined();
      // Recipe was used for L1 processing
      expect(mockRecipeRepo.findOne).toHaveBeenCalledWith({
        where: { id: recipe.id },
        relations: ['outputCommodity'],
      });
      // Fish input was consumed
      expect(mockInventoryRepo.createQueryBuilder).toHaveBeenCalled();
    });

    it('should reject fishery factory production when exclusive_output_slug is not set', async () => {
      const factory = createMockFactory({
        factoryLevel: 0,
        category: CommodityCategory.FISHERY,
        commodityId: null,
        recipeId: null,
        exclusiveOutputSlug: null, // NOT SET
      });
      const worker = createMockWorkerAssignment();

      mockSeasonRepo.findOne = vi.fn().mockResolvedValue(mockSeason);
      mockFactoryRepo.findOne = vi.fn().mockResolvedValue(factory);
      mockWorkerAssignmentRepo.find = vi.fn().mockResolvedValue([worker]);

      await expect(
        service.startProduction(playerId, { factoryId }),
      ).rejects.toThrow(/requires an exclusive output to be selected/);
    });
  });
});

describe('ProductionService - Pause/Resume', () => {
  let service: ProductionService;
  let mockProductionJobRepo: Partial<Repository<ProductionJob>>;
  let mockFactoryRepo: Partial<Repository<Factory>>;
  let mockCommodityRepo: Partial<Repository<Commodity>>;
  let mockRecipeRepo: Partial<Repository<Recipe>>;
  let mockRecipeInputRepo: Partial<Repository<RecipeInput>>;
  let mockInventoryRepo: Partial<Repository<Inventory>>;
  let mockWorkerAssignmentRepo: Partial<Repository<WorkerAssignment>>;
  let mockPlayerSeasonRepo: Partial<Repository<PlayerSeason>>;
  let mockSeasonRepo: Partial<Repository<Season>>;
  let mockProductionQueue: Partial<Queue>;
  let mockDataSource: Partial<DataSource>;
  let mockInventoryService: Partial<InventoryService>;

  const playerId = '11111111-1111-1111-1111-111111111111';
  const seasonId = '22222222-2222-2222-2222-222222222222';
  const factoryId = '33333333-3333-3333-3333-333333333333';
  const commodityId = '44444444-4444-4444-4444-444444444444';
  const jobId = '55555555-5555-5555-5555-555555555555';

  const createMockJob = (overrides: Partial<ProductionJob> = {}): ProductionJob => ({
    id: jobId,
    playerId,
    factoryId,
    commodityId,
    seasonId,
    recipeId: null,
    status: ProductionJobStatus.ACTIVE,
    baseYield: 10,
    finalYield: 10,
    unitsProduced: 3,
    incrementIntervalMinutes: 5,
    effectiveProductionTimeMinutes: 50,
    startedAt: new Date('2024-01-01T00:00:00Z'),
    completesAt: new Date('2024-01-01T01:00:00Z'),
    pausedAt: null,
    completedAt: null,
    pauseReason: null,
    inputSnapshot: null,
    yieldModifiers: {},
    factory: {
      id: factoryId,
      status: FactoryStatus.PRODUCING,
    } as Factory,
    ...overrides,
  } as ProductionJob);

  const createMockFactory = (overrides: Partial<Factory> = {}): Factory => ({
    id: factoryId,
    playerId,
    seasonId,
    status: FactoryStatus.PRODUCING,
    category: 'AGRICULTURE',
    factoryLevel: 0,
    efficiency: '100.00',
    maintenanceCount: 0,
    setupCost: '300.00',
    ...overrides,
  } as Factory);

  beforeEach(() => {
    mockProductionJobRepo = {
      findOne: vi.fn(),
      find: vi.fn(),
      save: vi.fn().mockImplementation((entity) => Promise.resolve(entity)),
    };

    mockFactoryRepo = {
      findOne: vi.fn(),
      findOneBy: vi.fn(),
      save: vi.fn().mockImplementation((entity) => Promise.resolve(entity)),
    };

    mockCommodityRepo = {
      findOne: vi.fn(),
      findOneBy: vi.fn(),
    };

    mockRecipeRepo = { findOne: vi.fn() };
    mockRecipeInputRepo = { find: vi.fn() };
    mockInventoryRepo = {
      findOne: vi.fn(),
      createQueryBuilder: vi.fn().mockReturnValue({
        update: vi.fn().mockReturnThis(),
        set: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        execute: vi.fn().mockResolvedValue(undefined),
      }),
    };
    mockWorkerAssignmentRepo = { find: vi.fn() };
    mockPlayerSeasonRepo = { findOne: vi.fn() };
    mockSeasonRepo = { findOne: vi.fn() };

    mockProductionQueue = {
      add: vi.fn().mockResolvedValue({ id: 'bull-job-1' }),
    };

    mockDataSource = {
      transaction: vi.fn().mockImplementation(async (cb) => cb({})),
    };

    mockInventoryService = {
      hasCapacityFor: vi.fn().mockResolvedValue(true),
      addToInventory: vi.fn().mockResolvedValue({ id: 'inv-1', quantity: 1 }),
    };

    service = new ProductionService(
      mockProductionJobRepo as Repository<ProductionJob>,
      mockFactoryRepo as Repository<Factory>,
      mockCommodityRepo as Repository<Commodity>,
      mockRecipeRepo as Repository<Recipe>,
      mockRecipeInputRepo as Repository<RecipeInput>,
      mockInventoryRepo as Repository<Inventory>,
      mockWorkerAssignmentRepo as Repository<WorkerAssignment>,
      mockPlayerSeasonRepo as Repository<PlayerSeason>,
      mockSeasonRepo as Repository<Season>,
      mockProductionQueue as Queue,
      mockDataSource as DataSource,
      mockInventoryService as InventoryService,
    );
  });

  describe('processIncrement', () => {
    it('should produce 1 unit when capacity is available', async () => {
      const job = createMockJob({ unitsProduced: 3, finalYield: 10 });
      mockProductionJobRepo.findOne = vi.fn().mockResolvedValue(job);
      mockInventoryService.hasCapacityFor = vi.fn().mockResolvedValue(true);

      const result = await service.processIncrement(jobId);

      expect(result.status).toBe('produced');
      expect(mockInventoryService.addToInventory).toHaveBeenCalledWith(
        playerId,
        seasonId,
        commodityId,
        1,
      );
      expect(job.unitsProduced).toBe(4);
      expect(mockProductionJobRepo.save).toHaveBeenCalledWith(job);
      expect(mockProductionQueue.add).toHaveBeenCalledWith(
        'production.increment',
        expect.objectContaining({
          jobId,
          unitsProduced: 4,
        }),
        expect.objectContaining({
          delay: 5 * 60 * 1000,
          jobId: `increment-${jobId}-5`,
        }),
      );
    });

    it('should pause production when storage is full', async () => {
      const job = createMockJob({ unitsProduced: 5, finalYield: 10 });
      mockProductionJobRepo.findOne = vi.fn().mockResolvedValue(job);
      mockInventoryService.hasCapacityFor = vi.fn().mockResolvedValue(false);
      mockFactoryRepo.findOneBy = vi.fn().mockResolvedValue(createMockFactory());

      const result = await service.processIncrement(jobId);

      expect(result.status).toBe('paused');
      expect(mockInventoryService.addToInventory).not.toHaveBeenCalled();
      expect(job.status).toBe(ProductionJobStatus.PAUSED);
      expect(job.pauseReason).toBe('STORAGE_FULL');
      expect(job.pausedAt).toBeInstanceOf(Date);
    });

    it('should complete production when all units are produced', async () => {
      const factory = createMockFactory();
      const job = createMockJob({ unitsProduced: 9, finalYield: 10, factory });
      mockProductionJobRepo.findOne = vi.fn().mockResolvedValue(job);
      mockInventoryService.hasCapacityFor = vi.fn().mockResolvedValue(true);

      const result = await service.processIncrement(jobId);

      expect(result.status).toBe('completed');
      expect(job.unitsProduced).toBe(10);
      expect(job.status).toBe(ProductionJobStatus.COMPLETED);
      expect(job.completedAt).toBeInstanceOf(Date);
      // Factory should be set to IDLE (uses relation from the loaded job)
      expect(factory.status).toBe(FactoryStatus.IDLE);
      expect(mockFactoryRepo.save).toHaveBeenCalledWith(factory);
      // Should NOT schedule next increment
      expect(mockProductionQueue.add).not.toHaveBeenCalled();
    });

    it('should skip if job is not ACTIVE', async () => {
      const job = createMockJob({ status: ProductionJobStatus.PAUSED });
      mockProductionJobRepo.findOne = vi.fn().mockResolvedValue(job);

      const result = await service.processIncrement(jobId);

      expect(result.status).toBe('paused');
      expect(mockInventoryService.hasCapacityFor).not.toHaveBeenCalled();
      expect(mockInventoryService.addToInventory).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException when job does not exist', async () => {
      mockProductionJobRepo.findOne = vi.fn().mockResolvedValue(null);

      await expect(service.processIncrement(jobId)).rejects.toThrow(
        `Production job ${jobId} not found`,
      );
    });

    it('should use factory from relation if available on completion', async () => {
      const factory = createMockFactory();
      const job = createMockJob({
        unitsProduced: 9,
        finalYield: 10,
        factory,
      });
      mockProductionJobRepo.findOne = vi.fn().mockResolvedValue(job);
      mockInventoryService.hasCapacityFor = vi.fn().mockResolvedValue(true);

      await service.processIncrement(jobId);

      // Should use the factory from the relation, not call findOneBy
      expect(mockFactoryRepo.findOneBy).not.toHaveBeenCalled();
      expect(factory.status).toBe(FactoryStatus.IDLE);
      expect(mockFactoryRepo.save).toHaveBeenCalledWith(factory);
    });
  });

  describe('pauseProduction', () => {
    it('should pause an active production job', async () => {
      const job = createMockJob({ status: ProductionJobStatus.ACTIVE });
      mockProductionJobRepo.findOne = vi.fn().mockResolvedValue(job);
      mockFactoryRepo.findOneBy = vi.fn().mockResolvedValue(createMockFactory());

      const result = await service.pauseProduction(jobId, 'STORAGE_FULL');

      expect(result.status).toBe(ProductionJobStatus.PAUSED);
      expect(result.pauseReason).toBe('STORAGE_FULL');
      expect(result.pausedAt).toBeInstanceOf(Date);
      expect(mockProductionJobRepo.save).toHaveBeenCalledWith(job);
      expect(mockFactoryRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: FactoryStatus.PAUSED }),
      );
    });

    it('should throw BadRequestException if job is not ACTIVE', async () => {
      const job = createMockJob({ status: ProductionJobStatus.PAUSED });
      mockProductionJobRepo.findOne = vi.fn().mockResolvedValue(job);

      await expect(
        service.pauseProduction(jobId, 'STORAGE_FULL'),
      ).rejects.toThrow('Cannot pause job: current status is PAUSED, expected ACTIVE');
    });

    it('should throw NotFoundException if job does not exist', async () => {
      mockProductionJobRepo.findOne = vi.fn().mockResolvedValue(null);

      await expect(
        service.pauseProduction(jobId, 'STORAGE_FULL'),
      ).rejects.toThrow(`Production job ${jobId} not found`);
    });
  });

  describe('resumeProduction', () => {
    it('should resume a paused production job', async () => {
      const job = createMockJob({
        status: ProductionJobStatus.PAUSED,
        pausedAt: new Date('2024-01-01T00:30:00Z'),
        pauseReason: 'STORAGE_FULL',
        unitsProduced: 5,
        finalYield: 10,
        incrementIntervalMinutes: 5,
      });
      mockProductionJobRepo.findOne = vi.fn().mockResolvedValue(job);
      mockFactoryRepo.findOneBy = vi.fn().mockResolvedValue(createMockFactory());

      const result = await service.resumeProduction(jobId);

      expect(result.status).toBe(ProductionJobStatus.ACTIVE);
      expect(result.pausedAt).toBeNull();
      expect(result.pauseReason).toBeNull();
      expect(result.completesAt).toBeInstanceOf(Date);
      // Remaining: 5 units × 5 min = 25 min from now
      const expectedCompletesAt = Date.now() + 5 * 5 * 60 * 1000;
      expect(result.completesAt.getTime()).toBeCloseTo(expectedCompletesAt, -3);
      // Factory should be PRODUCING
      expect(mockFactoryRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: FactoryStatus.PRODUCING }),
      );
      // Should schedule next increment
      expect(mockProductionQueue.add).toHaveBeenCalledWith(
        'production.increment',
        expect.objectContaining({ jobId }),
        expect.objectContaining({
          delay: 5 * 60 * 1000,
          jobId: `increment-${jobId}-6`,
        }),
      );
    });

    it('should throw BadRequestException if job is not PAUSED', async () => {
      const job = createMockJob({ status: ProductionJobStatus.ACTIVE });
      mockProductionJobRepo.findOne = vi.fn().mockResolvedValue(job);

      await expect(service.resumeProduction(jobId)).rejects.toThrow(
        'Cannot resume job: current status is ACTIVE, expected PAUSED',
      );
    });

    it('should throw NotFoundException if job does not exist', async () => {
      mockProductionJobRepo.findOne = vi.fn().mockResolvedValue(null);

      await expect(service.resumeProduction(jobId)).rejects.toThrow(
        `Production job ${jobId} not found`,
      );
    });
  });

  describe('checkAndResumeForPlayer', () => {
    it('should resume paused jobs that now have capacity', async () => {
      const job1 = createMockJob({
        id: 'job-1',
        status: ProductionJobStatus.PAUSED,
        pauseReason: 'STORAGE_FULL',
        pausedAt: new Date(),
        unitsProduced: 5,
        finalYield: 10,
      });
      const job2 = createMockJob({
        id: 'job-2',
        status: ProductionJobStatus.PAUSED,
        pauseReason: 'STORAGE_FULL',
        pausedAt: new Date(),
        unitsProduced: 3,
        finalYield: 8,
        commodityId: '66666666-6666-6666-6666-666666666666',
      });

      mockProductionJobRepo.find = vi.fn().mockResolvedValue([job1, job2]);
      mockInventoryService.hasCapacityFor = vi.fn().mockResolvedValue(true);
      // resumeProduction will call findOne for each job
      mockProductionJobRepo.findOne = vi.fn()
        .mockResolvedValueOnce(job1)
        .mockResolvedValueOnce(job2);
      mockFactoryRepo.findOneBy = vi.fn().mockResolvedValue(createMockFactory());

      const count = await service.checkAndResumeForPlayer(playerId, seasonId);

      expect(count).toBe(2);
      expect(mockInventoryService.hasCapacityFor).toHaveBeenCalledTimes(2);
    });

    it('should not resume jobs when capacity is still insufficient', async () => {
      const job1 = createMockJob({
        id: 'job-1',
        status: ProductionJobStatus.PAUSED,
        pauseReason: 'STORAGE_FULL',
        pausedAt: new Date(),
      });

      mockProductionJobRepo.find = vi.fn().mockResolvedValue([job1]);
      mockInventoryService.hasCapacityFor = vi.fn().mockResolvedValue(false);

      const count = await service.checkAndResumeForPlayer(playerId, seasonId);

      expect(count).toBe(0);
      // resumeProduction should not have been called
      expect(mockProductionQueue.add).not.toHaveBeenCalled();
    });

    it('should return 0 when no paused jobs exist', async () => {
      mockProductionJobRepo.find = vi.fn().mockResolvedValue([]);

      const count = await service.checkAndResumeForPlayer(playerId, seasonId);

      expect(count).toBe(0);
      expect(mockInventoryService.hasCapacityFor).not.toHaveBeenCalled();
    });

    it('should only resume jobs with sufficient capacity (partial resume)', async () => {
      const job1 = createMockJob({
        id: 'job-1',
        status: ProductionJobStatus.PAUSED,
        pauseReason: 'STORAGE_FULL',
        pausedAt: new Date(),
        unitsProduced: 5,
        finalYield: 10,
      });
      const job2 = createMockJob({
        id: 'job-2',
        status: ProductionJobStatus.PAUSED,
        pauseReason: 'STORAGE_FULL',
        pausedAt: new Date(),
        unitsProduced: 3,
        finalYield: 8,
        commodityId: '66666666-6666-6666-6666-666666666666',
      });

      mockProductionJobRepo.find = vi.fn().mockResolvedValue([job1, job2]);
      // First job has capacity, second doesn't
      mockInventoryService.hasCapacityFor = vi.fn()
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false);
      mockProductionJobRepo.findOne = vi.fn().mockResolvedValue(job1);
      mockFactoryRepo.findOneBy = vi.fn().mockResolvedValue(createMockFactory());

      const count = await service.checkAndResumeForPlayer(playerId, seasonId);

      expect(count).toBe(1);
    });

    it('should query for paused jobs with STORAGE_FULL reason', async () => {
      mockProductionJobRepo.find = vi.fn().mockResolvedValue([]);

      await service.checkAndResumeForPlayer(playerId, seasonId);

      expect(mockProductionJobRepo.find).toHaveBeenCalledWith({
        where: {
          playerId,
          seasonId,
          status: ProductionJobStatus.PAUSED,
          pauseReason: 'STORAGE_FULL',
        },
      });
    });
  });

  describe('handleIncrementJob', () => {
    it('should delegate to processIncrement', async () => {
      const job = createMockJob({ unitsProduced: 3, finalYield: 10 });
      mockProductionJobRepo.findOne = vi.fn().mockResolvedValue(job);
      mockInventoryService.hasCapacityFor = vi.fn().mockResolvedValue(true);

      const result = await service.handleIncrementJob({
        jobId,
        playerId,
        factoryId,
        commodityId,
        seasonId,
        finalYield: 10,
        unitsProduced: 3,
        incrementIntervalMinutes: 5,
      });

      expect(result.status).toBe('produced');
      expect(mockInventoryService.addToInventory).toHaveBeenCalled();
    });
  });
});
