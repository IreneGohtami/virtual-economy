import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FactoryService } from './factory.service';
import { CommodityCategory, FactoryStatus, ProductionJobStatus, SeasonStatus, TransactionType } from '@sea-commodity-tycoon/shared-types';
import { DataSource, Repository, EntityManager } from 'typeorm';
import { Queue } from 'bullmq';
import { Factory } from '../entities/factory.entity';
import { ProductionJob } from '../entities/production-job.entity';
import { MapTile } from '../entities/map-tile.entity';
import { Season } from '../entities/season.entity';
import { Commodity } from '../entities/commodity.entity';
import { MapService } from '../map/map.service';
import { WalletService } from '../wallet/wallet.service';
import { InventoryService } from '../inventory/inventory.service';

describe('FactoryService', () => {
  let factoryService: FactoryService;
  let mockFactoryRepository: Partial<Repository<Factory>>;
  let mockProductionJobRepository: Partial<Repository<ProductionJob>>;
  let mockMapTileRepository: Partial<Repository<MapTile>>;
  let mockSeasonRepository: Partial<Repository<Season>>;
  let mockCommodityRepository: Partial<Repository<Commodity>>;
  let mockFertilizerQueue: Partial<Queue>;
  let mockMapService: Partial<MapService>;
  let mockWalletService: Partial<WalletService>;
  let mockInventoryService: Partial<InventoryService>;
  let mockDataSource: Partial<DataSource>;
  let mockManager: Partial<EntityManager>;

  const playerId = '11111111-1111-1111-1111-111111111111';
  const seasonId = '22222222-2222-2222-2222-222222222222';
  const factoryId = '33333333-3333-3333-3333-333333333333';

  const activeSeason = {
    id: seasonId,
    status: SeasonStatus.ACTIVE,
    startsAt: new Date('2024-01-01'),
    endsAt: new Date('2024-01-31'),
  } as Season;

  beforeEach(() => {
    mockFactoryRepository = {
      find: vi.fn().mockResolvedValue([]),
      findOne: vi.fn().mockResolvedValue(null),
      save: vi.fn().mockImplementation((factory) => Promise.resolve(factory)),
    };

    mockProductionJobRepository = {
      findOne: vi.fn().mockResolvedValue(null),
    };

    mockMapTileRepository = {
      findBy: vi.fn().mockResolvedValue([]),
    };

    mockSeasonRepository = {
      findOne: vi.fn().mockResolvedValue(activeSeason),
    };

    mockMapService = {
      validateTerrain: vi.fn().mockResolvedValue({ valid: true, errors: [] }),
    };

    mockWalletService = {
      executeTransactionWithManager: vi.fn().mockResolvedValue({
        transactionId: 'tx-1',
        balanceAfter: 700,
        amount: -300,
      }),
    };

    mockCommodityRepository = {
      findOne: vi.fn().mockResolvedValue(null),
    };

    mockFertilizerQueue = {
      add: vi.fn().mockResolvedValue({ id: 'job-1' }),
    };

    mockInventoryService = {
      removeFromInventory: vi.fn().mockResolvedValue({ id: 'inv-1', quantity: 0 }),
    };

    const mockUpdateQB = {
      update: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      execute: vi.fn().mockResolvedValue({ affected: 9 }),
    };

    mockManager = {
      create: vi.fn().mockImplementation((_entity, data) => ({
        ...data,
        id: factoryId,
        constructedAt: new Date(),
      })),
      save: vi.fn().mockImplementation((_entity, data) => ({
        ...data,
        id: factoryId,
        constructedAt: new Date(),
      })),
      find: vi.fn().mockResolvedValue([]),
      findOne: vi.fn().mockResolvedValue(null),
      createQueryBuilder: vi.fn().mockReturnValue(mockUpdateQB),
    };

    mockDataSource = {
      transaction: vi.fn().mockImplementation(async (cb: (manager: EntityManager) => Promise<unknown>) => {
        return cb(mockManager as EntityManager);
      }),
    };

    factoryService = new FactoryService(
      mockFactoryRepository as Repository<Factory>,
      mockProductionJobRepository as Repository<ProductionJob>,
      mockMapTileRepository as Repository<MapTile>,
      mockSeasonRepository as Repository<Season>,
      mockCommodityRepository as Repository<Commodity>,
      mockFertilizerQueue as Queue,
      mockMapService as MapService,
      mockWalletService as WalletService,
      mockInventoryService as InventoryService,
      mockDataSource as DataSource,
    );
  });

  describe('construct', () => {
    const makeTiles = (count: number, ownerPlayerId: string) =>
      Array.from({ length: count }, (_, i) => ({
        id: `tile-${i}`,
        seasonId,
        x: i % 3,
        y: Math.floor(i / 3),
        terrainType: 'FERTILE_SOIL',
        ownerPlayerId,
        factoryId: null,
        purchasedAt: new Date(),
        purchasePrice: '25.00',
      })) as unknown as MapTile[];

    it('should construct an L0 Agriculture factory with 300 coin cost', async () => {
      const tiles = makeTiles(9, playerId);
      (mockMapTileRepository.findBy as ReturnType<typeof vi.fn>).mockResolvedValue(tiles);

      const result = await factoryService.construct(playerId, {
        tileIds: tiles.map((t) => t.id),
        category: CommodityCategory.AGRICULTURE,
      });

      expect(result.id).toBe(factoryId);
      expect(result.category).toBe(CommodityCategory.AGRICULTURE);
      expect(result.factoryLevel).toBe(0);
      expect(result.status).toBe(FactoryStatus.IDLE);
      expect(result.efficiency).toBe('100.00');
      expect(result.maintenanceCount).toBe(0);
      expect(result.setupCost).toBe('300.00');

      expect(mockWalletService.executeTransactionWithManager).toHaveBeenCalledWith(
        mockManager,
        playerId,
        seasonId,
        TransactionType.FACTORY_PURCHASE,
        -300,
        expect.objectContaining({
          referenceType: 'factory',
          description: 'Factory construction: AGRICULTURE L0',
        }),
      );
    });

    it('should construct an L1 Energy factory with 600 coin cost', async () => {
      const tiles = makeTiles(6, playerId);
      (mockMapTileRepository.findBy as ReturnType<typeof vi.fn>).mockResolvedValue(tiles);

      const result = await factoryService.construct(playerId, {
        tileIds: tiles.map((t) => t.id),
        category: CommodityCategory.ENERGY,
        level: 1,
      });

      expect(result.factoryLevel).toBe(1);
      expect(result.setupCost).toBe('600.00');

      expect(mockWalletService.executeTransactionWithManager).toHaveBeenCalledWith(
        mockManager,
        playerId,
        seasonId,
        TransactionType.FACTORY_PURCHASE,
        -600,
        expect.anything(),
      );
    });

    it('should construct an L2 Electronics factory with 800 coin cost', async () => {
      const tiles = makeTiles(4, playerId);
      (mockMapTileRepository.findBy as ReturnType<typeof vi.fn>).mockResolvedValue(tiles);

      const result = await factoryService.construct(playerId, {
        tileIds: tiles.map((t) => t.id),
        category: CommodityCategory.ELECTRONICS,
      });

      expect(result.factoryLevel).toBe(2);
      expect(result.setupCost).toBe('800.00');
    });

    it('should construct an L2 Automotive factory with 1000 coin cost', async () => {
      const tiles = makeTiles(4, playerId);
      (mockMapTileRepository.findBy as ReturnType<typeof vi.fn>).mockResolvedValue(tiles);

      const result = await factoryService.construct(playerId, {
        tileIds: tiles.map((t) => t.id),
        category: CommodityCategory.AUTOMOTIVE,
      });

      expect(result.factoryLevel).toBe(2);
      expect(result.setupCost).toBe('1000.00');
    });

    it('should reject invalid level for category', async () => {
      await expect(
        factoryService.construct(playerId, {
          tileIds: ['tile-1'],
          category: CommodityCategory.AGRICULTURE,
          level: 2,
        }),
      ).rejects.toThrow('Level 2 is not valid for category AGRICULTURE');
    });

    it('should reject when no active season', async () => {
      (mockSeasonRepository.findOne as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      await expect(
        factoryService.construct(playerId, {
          tileIds: ['tile-1'],
          category: CommodityCategory.AGRICULTURE,
        }),
      ).rejects.toThrow('No active season');
    });

    it('should reject when terrain validation fails', async () => {
      (mockMapService.validateTerrain as ReturnType<typeof vi.fn>).mockResolvedValue({
        valid: false,
        errors: ['Factory construction is not allowed on CITY terrain'],
      });

      const tiles = makeTiles(9, playerId);
      (mockMapTileRepository.findBy as ReturnType<typeof vi.fn>).mockResolvedValue(tiles);

      await expect(
        factoryService.construct(playerId, {
          tileIds: tiles.map((t) => t.id),
          category: CommodityCategory.AGRICULTURE,
        }),
      ).rejects.toThrow('Terrain validation failed');
    });

    it('should reject when tiles are not owned by the player', async () => {
      const otherPlayerId = '44444444-4444-4444-4444-444444444444';
      const tiles = makeTiles(9, otherPlayerId);
      (mockMapTileRepository.findBy as ReturnType<typeof vi.fn>).mockResolvedValue(tiles);

      await expect(
        factoryService.construct(playerId, {
          tileIds: tiles.map((t) => t.id),
          category: CommodityCategory.AGRICULTURE,
        }),
      ).rejects.toThrow('not owned by the player');
    });

    it('should reject when a tile already has a factory', async () => {
      const tiles = makeTiles(9, playerId);
      tiles[3].factoryId = 'existing-factory-id';
      (mockMapTileRepository.findBy as ReturnType<typeof vi.fn>).mockResolvedValue(tiles);

      await expect(
        factoryService.construct(playerId, {
          tileIds: tiles.map((t) => t.id),
          category: CommodityCategory.AGRICULTURE,
        }),
      ).rejects.toThrow('already has a factory assigned');
    });

    it('should reject when some tile IDs are not found', async () => {
      const tiles = makeTiles(5, playerId); // fewer than requested
      (mockMapTileRepository.findBy as ReturnType<typeof vi.fn>).mockResolvedValue(tiles);

      await expect(
        factoryService.construct(playerId, {
          tileIds: ['tile-0', 'tile-1', 'tile-2', 'tile-3', 'tile-4', 'tile-5', 'tile-6', 'tile-7', 'tile-8'],
          category: CommodityCategory.AGRICULTURE,
        }),
      ).rejects.toThrow('Some tile IDs were not found');
    });

    it('should assign factory ID to all tiles', async () => {
      const tiles = makeTiles(9, playerId);
      (mockMapTileRepository.findBy as ReturnType<typeof vi.fn>).mockResolvedValue(tiles);

      await factoryService.construct(playerId, {
        tileIds: tiles.map((t) => t.id),
        category: CommodityCategory.AGRICULTURE,
      });

      const updateQB = (mockManager.createQueryBuilder as ReturnType<typeof vi.fn>).mock.results[0].value;
      expect(updateQB.set).toHaveBeenCalledWith({ factoryId });
      expect(updateQB.where).toHaveBeenCalledWith(
        'id IN (:...tileIds)',
        { tileIds: tiles.map((t) => t.id) },
      );
    });

    it('should set all L0 setup costs correctly', async () => {
      const expectedCosts: [CommodityCategory, number][] = [
        [CommodityCategory.AGRICULTURE, 300],
        [CommodityCategory.ENERGY, 500],
        [CommodityCategory.METAL, 500],
        [CommodityCategory.LIVESTOCK, 400],
        [CommodityCategory.FISHERY, 400],
        [CommodityCategory.FORESTRY, 300],
      ];

      for (const [category, expectedCost] of expectedCosts) {
        const tiles = makeTiles(9, playerId);
        (mockMapTileRepository.findBy as ReturnType<typeof vi.fn>).mockResolvedValue(tiles);

        const result = await factoryService.construct(playerId, {
          tileIds: tiles.map((t) => t.id),
          category,
          level: 0,
        });

        expect(result.setupCost).toBe(expectedCost.toFixed(2));
      }
    });
  });

  describe('findAllByPlayer', () => {
    it('should return factories for the player in active season', async () => {
      const factories = [
        { id: 'f1', category: CommodityCategory.AGRICULTURE, factoryLevel: 0 },
        { id: 'f2', category: CommodityCategory.ENERGY, factoryLevel: 1 },
      ] as Factory[];

      (mockFactoryRepository.find as ReturnType<typeof vi.fn>).mockResolvedValue(factories);

      const result = await factoryService.findAllByPlayer(playerId);
      expect(result).toHaveLength(2);
      expect(mockFactoryRepository.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { playerId, seasonId },
          relations: ['workerAssignments'],
        }),
      );
    });

    it('should return empty array if no active season', async () => {
      (mockSeasonRepository.findOne as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const result = await factoryService.findAllByPlayer(playerId);
      expect(result).toEqual([]);
    });
  });

  describe('findOneByPlayer', () => {
    it('should return factory details for the player', async () => {
      const factory = {
        id: factoryId,
        playerId,
        category: CommodityCategory.AGRICULTURE,
        workerAssignments: [],
      } as unknown as Factory;

      (mockFactoryRepository.findOne as ReturnType<typeof vi.fn>).mockResolvedValue(factory);

      const result = await factoryService.findOneByPlayer(playerId, factoryId);
      expect(result.id).toBe(factoryId);
    });

    it('should throw NotFoundException if factory not found', async () => {
      (mockFactoryRepository.findOne as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      await expect(
        factoryService.findOneByPlayer(playerId, 'non-existent'),
      ).rejects.toThrow('Factory non-existent not found');
    });
  });

  describe('deconstruct', () => {
    const makeFactory = (overrides: Partial<Factory> = {}) =>
      ({
        id: factoryId,
        playerId,
        seasonId,
        category: CommodityCategory.AGRICULTURE,
        factoryLevel: 0,
        status: FactoryStatus.IDLE,
        efficiency: '80.00',
        maintenanceCount: 0,
        setupCost: '300.00',
        ...overrides,
      }) as unknown as Factory;

    it('should deconstruct an IDLE factory and charge 25% fee', async () => {
      const factory = makeFactory();
      (mockFactoryRepository.findOne as ReturnType<typeof vi.fn>).mockResolvedValue(factory);
      (mockManager.remove as unknown as ReturnType<typeof vi.fn>) = vi.fn().mockResolvedValue(factory);

      const result = await factoryService.deconstruct(playerId, factoryId);

      // 25% of 300 = 75
      expect(result.fee).toBe(75);
      expect(mockWalletService.executeTransactionWithManager).toHaveBeenCalledWith(
        mockManager,
        playerId,
        seasonId,
        TransactionType.FACTORY_DECONSTRUCTION,
        -75,
        expect.objectContaining({
          referenceType: 'factory',
          referenceId: factoryId,
          description: 'Factory deconstruction fee: AGRICULTURE L0',
        }),
      );
    });

    it('should release tiles by setting factoryId to null', async () => {
      const factory = makeFactory();
      (mockFactoryRepository.findOne as ReturnType<typeof vi.fn>).mockResolvedValue(factory);
      (mockManager.remove as unknown as ReturnType<typeof vi.fn>) = vi.fn().mockResolvedValue(factory);

      await factoryService.deconstruct(playerId, factoryId);

      const updateQB = (mockManager.createQueryBuilder as ReturnType<typeof vi.fn>).mock.results[0].value;
      expect(updateQB.set).toHaveBeenCalledWith({ factoryId: null });
      expect(updateQB.where).toHaveBeenCalledWith('factory_id = :factoryId', { factoryId });
    });

    it('should remove the factory record', async () => {
      const factory = makeFactory();
      (mockFactoryRepository.findOne as ReturnType<typeof vi.fn>).mockResolvedValue(factory);
      (mockManager.remove as unknown as ReturnType<typeof vi.fn>) = vi.fn().mockResolvedValue(factory);

      await factoryService.deconstruct(playerId, factoryId);

      expect(mockManager.remove).toHaveBeenCalledWith(Factory, factory);
    });

    it('should throw NotFoundException when factory not found', async () => {
      (mockFactoryRepository.findOne as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      await expect(
        factoryService.deconstruct(playerId, 'non-existent'),
      ).rejects.toThrow('Factory non-existent not found');
    });

    it('should reject deconstruction if factory is PRODUCING', async () => {
      const factory = makeFactory({ status: FactoryStatus.PRODUCING });
      (mockFactoryRepository.findOne as ReturnType<typeof vi.fn>).mockResolvedValue(factory);

      await expect(
        factoryService.deconstruct(playerId, factoryId),
      ).rejects.toThrow('Factory must be IDLE to deconstruct');
    });

    it('should reject deconstruction if factory is PAUSED', async () => {
      const factory = makeFactory({ status: FactoryStatus.PAUSED });
      (mockFactoryRepository.findOne as ReturnType<typeof vi.fn>).mockResolvedValue(factory);

      await expect(
        factoryService.deconstruct(playerId, factoryId),
      ).rejects.toThrow('Factory must be IDLE to deconstruct');
    });

    it('should charge correct fee for an L1 Energy factory (setup cost 600)', async () => {
      const factory = makeFactory({
        category: CommodityCategory.ENERGY,
        factoryLevel: 1,
        setupCost: '600.00',
      });
      (mockFactoryRepository.findOne as ReturnType<typeof vi.fn>).mockResolvedValue(factory);
      (mockManager.remove as unknown as ReturnType<typeof vi.fn>) = vi.fn().mockResolvedValue(factory);

      const result = await factoryService.deconstruct(playerId, factoryId);

      // 25% of 600 = 150
      expect(result.fee).toBe(150);
    });
  });

  describe('performMaintenance', () => {
    const makeFactory = (overrides: Partial<Factory> = {}) =>
      ({
        id: factoryId,
        playerId,
        seasonId,
        category: CommodityCategory.AGRICULTURE,
        factoryLevel: 0,
        status: FactoryStatus.IDLE,
        efficiency: '70.00',
        maintenanceCount: 0,
        setupCost: '300.00',
        ...overrides,
      }) as unknown as Factory;

    it('should perform maintenance, charge 15% of setupCost, and restore efficiency', async () => {
      const factory = makeFactory({ efficiency: '70.00', maintenanceCount: 0 });
      (mockFactoryRepository.findOne as ReturnType<typeof vi.fn>).mockResolvedValue(factory);

      const result = await factoryService.performMaintenance(playerId, factoryId);

      // 15% of 300 = 45
      expect(result.cost).toBe(45);
      // After first maintenance: max efficiency = 100 - (1 * 5) = 95
      expect(result.newEfficiency).toBe(95);
      expect(result.maintenanceCount).toBe(1);

      expect(mockWalletService.executeTransactionWithManager).toHaveBeenCalledWith(
        mockManager,
        playerId,
        seasonId,
        TransactionType.FACTORY_MAINTENANCE,
        -45,
        expect.objectContaining({
          referenceType: 'factory',
          referenceId: factoryId,
          description: 'Factory maintenance: AGRICULTURE L0',
        }),
      );
    });

    it('should save updated factory with new efficiency and maintenance count', async () => {
      const factory = makeFactory({ efficiency: '60.00', maintenanceCount: 1 });
      (mockFactoryRepository.findOne as ReturnType<typeof vi.fn>).mockResolvedValue(factory);

      await factoryService.performMaintenance(playerId, factoryId);

      expect(mockManager.save).toHaveBeenCalledWith(Factory, expect.objectContaining({
        maintenanceCount: 2,
        efficiency: '90.00',
      }));
    });

    it('should reduce max efficiency with each maintenance (maintenanceCount=3 → max 85%)', async () => {
      const factory = makeFactory({ efficiency: '50.00', maintenanceCount: 3 });
      (mockFactoryRepository.findOne as ReturnType<typeof vi.fn>).mockResolvedValue(factory);

      const result = await factoryService.performMaintenance(playerId, factoryId);

      // max = 100 - (4 * 5) = 80%
      expect(result.newEfficiency).toBe(80);
      expect(result.maintenanceCount).toBe(4);
    });

    it('should throw NotFoundException when factory not found', async () => {
      (mockFactoryRepository.findOne as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      await expect(
        factoryService.performMaintenance(playerId, 'non-existent'),
      ).rejects.toThrow('Factory non-existent not found');
    });

    it('should reject if efficiency is already at or above max', async () => {
      // After 0 maintenances, max is 100 - (1 * 5) = 95%. If current is 95% already...
      const factory = makeFactory({ efficiency: '95.00', maintenanceCount: 0 });
      (mockFactoryRepository.findOne as ReturnType<typeof vi.fn>).mockResolvedValue(factory);

      await expect(
        factoryService.performMaintenance(playerId, factoryId),
      ).rejects.toThrow('Maintenance would have no effect');
    });

    it('should charge correct cost for an L2 Electronics factory (setup cost 800)', async () => {
      const factory = makeFactory({
        category: CommodityCategory.ELECTRONICS,
        factoryLevel: 2,
        setupCost: '800.00',
        efficiency: '60.00',
        maintenanceCount: 0,
      });
      (mockFactoryRepository.findOne as ReturnType<typeof vi.fn>).mockResolvedValue(factory);

      const result = await factoryService.performMaintenance(playerId, factoryId);

      // 15% of 800 = 120
      expect(result.cost).toBe(120);
    });
  });

  describe('switchOutput', () => {
    const makeFactory = (overrides: Partial<Factory> = {}) =>
      ({
        id: factoryId,
        playerId,
        seasonId,
        category: CommodityCategory.LIVESTOCK,
        factoryLevel: 1,
        status: FactoryStatus.IDLE,
        efficiency: '100.00',
        maintenanceCount: 0,
        setupCost: '350.00',
        exclusiveOutputSlug: null,
        outputSwitchCooldownUntil: null,
        ...overrides,
      }) as unknown as Factory;

    it('should switch output for a LIVESTOCK factory from null to chicken-meat', async () => {
      const factory = makeFactory();
      (mockFactoryRepository.findOne as ReturnType<typeof vi.fn>).mockResolvedValue(factory);

      const result = await factoryService.switchOutput(playerId, factoryId, 'chicken-meat');

      expect(result.factoryId).toBe(factoryId);
      expect(result.oldOutput).toBeNull();
      expect(result.newOutput).toBe('chicken-meat');
      expect(result.cooldownUntil).toBeInstanceOf(Date);
      // Cooldown should be ~72 hours from now
      const expectedCooldown = Date.now() + 72 * 60 * 60 * 1000;
      expect(result.cooldownUntil.getTime()).toBeCloseTo(expectedCooldown, -3); // within 1 second
    });

    it('should switch output for a LIVESTOCK factory from chicken-meat to eggs', async () => {
      const factory = makeFactory({
        exclusiveOutputSlug: 'chicken-meat',
        outputSwitchCooldownUntil: new Date('2020-01-01'), // expired cooldown
      });
      (mockFactoryRepository.findOne as ReturnType<typeof vi.fn>).mockResolvedValue(factory);

      const result = await factoryService.switchOutput(playerId, factoryId, 'eggs');

      expect(result.oldOutput).toBe('chicken-meat');
      expect(result.newOutput).toBe('eggs');
    });

    it('should switch output for a FISHERY factory from fish to frozen-fish', async () => {
      const factory = makeFactory({
        category: CommodityCategory.FISHERY,
        exclusiveOutputSlug: 'fish',
        outputSwitchCooldownUntil: new Date('2020-01-01'), // expired cooldown
      });
      (mockFactoryRepository.findOne as ReturnType<typeof vi.fn>).mockResolvedValue(factory);

      const result = await factoryService.switchOutput(playerId, factoryId, 'frozen-fish');

      expect(result.oldOutput).toBe('fish');
      expect(result.newOutput).toBe('frozen-fish');
    });

    it('should switch output for cattle processing (beef to milk)', async () => {
      const factory = makeFactory({
        exclusiveOutputSlug: 'beef',
        outputSwitchCooldownUntil: new Date('2020-01-01'), // expired cooldown
      });
      (mockFactoryRepository.findOne as ReturnType<typeof vi.fn>).mockResolvedValue(factory);

      const result = await factoryService.switchOutput(playerId, factoryId, 'milk');

      expect(result.oldOutput).toBe('beef');
      expect(result.newOutput).toBe('milk');
    });

    it('should save factory with new exclusiveOutputSlug and cooldown', async () => {
      const factory = makeFactory();
      (mockFactoryRepository.findOne as ReturnType<typeof vi.fn>).mockResolvedValue(factory);

      await factoryService.switchOutput(playerId, factoryId, 'eggs');

      expect(mockFactoryRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          exclusiveOutputSlug: 'eggs',
          outputSwitchCooldownUntil: expect.any(Date),
        }),
      );
    });

    it('should throw NotFoundException when factory not found', async () => {
      (mockFactoryRepository.findOne as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      await expect(
        factoryService.switchOutput(playerId, 'non-existent', 'chicken-meat'),
      ).rejects.toThrow('Factory non-existent not found');
    });

    it('should reject switching for unsupported category (AGRICULTURE)', async () => {
      const factory = makeFactory({ category: CommodityCategory.AGRICULTURE });
      (mockFactoryRepository.findOne as ReturnType<typeof vi.fn>).mockResolvedValue(factory);

      await expect(
        factoryService.switchOutput(playerId, factoryId, 'rice'),
      ).rejects.toThrow('does not support exclusive output switching');
    });

    it('should reject switching for unsupported category (ENERGY)', async () => {
      const factory = makeFactory({ category: CommodityCategory.ENERGY });
      (mockFactoryRepository.findOne as ReturnType<typeof vi.fn>).mockResolvedValue(factory);

      await expect(
        factoryService.switchOutput(playerId, factoryId, 'gasoline'),
      ).rejects.toThrow('does not support exclusive output switching');
    });

    it('should reject invalid output slug for LIVESTOCK', async () => {
      const factory = makeFactory();
      (mockFactoryRepository.findOne as ReturnType<typeof vi.fn>).mockResolvedValue(factory);

      await expect(
        factoryService.switchOutput(playerId, factoryId, 'frozen-fish'),
      ).rejects.toThrow('Invalid output slug "frozen-fish" for category LIVESTOCK');
    });

    it('should reject invalid output slug for FISHERY', async () => {
      const factory = makeFactory({ category: CommodityCategory.FISHERY });
      (mockFactoryRepository.findOne as ReturnType<typeof vi.fn>).mockResolvedValue(factory);

      await expect(
        factoryService.switchOutput(playerId, factoryId, 'chicken-meat'),
      ).rejects.toThrow('Invalid output slug "chicken-meat" for category FISHERY');
    });

    it('should reject switching between different sub-groups (poultry to beef)', async () => {
      const factory = makeFactory({ exclusiveOutputSlug: 'chicken-meat' });
      (mockFactoryRepository.findOne as ReturnType<typeof vi.fn>).mockResolvedValue(factory);

      await expect(
        factoryService.switchOutput(playerId, factoryId, 'beef'),
      ).rejects.toThrow('belong to different production groups');
    });

    it('should reject switching between different sub-groups (milk to eggs)', async () => {
      const factory = makeFactory({ exclusiveOutputSlug: 'milk' });
      (mockFactoryRepository.findOne as ReturnType<typeof vi.fn>).mockResolvedValue(factory);

      await expect(
        factoryService.switchOutput(playerId, factoryId, 'eggs'),
      ).rejects.toThrow('belong to different production groups');
    });

    it('should reject when an active production job exists', async () => {
      const factory = makeFactory();
      (mockFactoryRepository.findOne as ReturnType<typeof vi.fn>).mockResolvedValue(factory);
      (mockProductionJobRepository.findOne as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 'job-1',
        factoryId,
        status: ProductionJobStatus.ACTIVE,
      });

      await expect(
        factoryService.switchOutput(playerId, factoryId, 'chicken-meat'),
      ).rejects.toThrow('Cannot switch output while a production job is active');
    });

    it('should reject when a paused production job exists', async () => {
      const factory = makeFactory();
      (mockFactoryRepository.findOne as ReturnType<typeof vi.fn>).mockResolvedValue(factory);
      (mockProductionJobRepository.findOne as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 'job-1',
        factoryId,
        status: ProductionJobStatus.PAUSED,
      });

      await expect(
        factoryService.switchOutput(playerId, factoryId, 'chicken-meat'),
      ).rejects.toThrow('Cannot switch output while a production job is active');
    });

    it('should reject when factory status is PRODUCING', async () => {
      const factory = makeFactory({ status: FactoryStatus.PRODUCING });
      (mockFactoryRepository.findOne as ReturnType<typeof vi.fn>).mockResolvedValue(factory);

      await expect(
        factoryService.switchOutput(playerId, factoryId, 'chicken-meat'),
      ).rejects.toThrow('Factory must be IDLE to switch output');
    });

    it('should reject when 72-hour cooldown is still active', async () => {
      const futureDate = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours from now
      const factory = makeFactory({
        exclusiveOutputSlug: 'chicken-meat',
        outputSwitchCooldownUntil: futureDate,
      });
      (mockFactoryRepository.findOne as ReturnType<typeof vi.fn>).mockResolvedValue(factory);

      await expect(
        factoryService.switchOutput(playerId, factoryId, 'eggs'),
      ).rejects.toThrow('Output switch is on cooldown');
    });

    it('should include remaining hours in cooldown error message', async () => {
      const futureDate = new Date(Date.now() + 48 * 60 * 60 * 1000); // 48 hours from now
      const factory = makeFactory({
        exclusiveOutputSlug: 'chicken-meat',
        outputSwitchCooldownUntil: futureDate,
      });
      (mockFactoryRepository.findOne as ReturnType<typeof vi.fn>).mockResolvedValue(factory);

      await expect(
        factoryService.switchOutput(playerId, factoryId, 'eggs'),
      ).rejects.toThrow('48 hour(s) remaining');
    });

    it('should reject switching to same output slug', async () => {
      const factory = makeFactory({
        exclusiveOutputSlug: 'chicken-meat',
        outputSwitchCooldownUntil: new Date('2020-01-01'), // expired
      });
      (mockFactoryRepository.findOne as ReturnType<typeof vi.fn>).mockResolvedValue(factory);

      await expect(
        factoryService.switchOutput(playerId, factoryId, 'chicken-meat'),
      ).rejects.toThrow('Factory is already producing "chicken-meat"');
    });

    it('should allow switching when cooldown is exactly in the past', async () => {
      const pastDate = new Date(Date.now() - 1); // 1ms ago
      const factory = makeFactory({
        exclusiveOutputSlug: 'chicken-meat',
        outputSwitchCooldownUntil: pastDate,
      });
      (mockFactoryRepository.findOne as ReturnType<typeof vi.fn>).mockResolvedValue(factory);

      const result = await factoryService.switchOutput(playerId, factoryId, 'eggs');

      expect(result.newOutput).toBe('eggs');
    });

    it('should allow first-time output selection (no cooldown check for null cooldown)', async () => {
      const factory = makeFactory({
        exclusiveOutputSlug: null,
        outputSwitchCooldownUntil: null,
      });
      (mockFactoryRepository.findOne as ReturnType<typeof vi.fn>).mockResolvedValue(factory);

      const result = await factoryService.switchOutput(playerId, factoryId, 'beef');

      expect(result.oldOutput).toBeNull();
      expect(result.newOutput).toBe('beef');
    });
  });

  describe('applyFertilizer', () => {
    const fertilizerCommodityId = '55555555-5555-5555-5555-555555555555';
    const fertilizerCommodity = {
      id: fertilizerCommodityId,
      slug: 'fertilizer',
      name: 'Fertilizer',
      category: 'ENERGY',
      storageSize: 1,
    } as unknown as Commodity;

    const makeFactory = (overrides: Partial<Factory> = {}) =>
      ({
        id: factoryId,
        playerId,
        seasonId,
        category: CommodityCategory.AGRICULTURE,
        factoryLevel: 0,
        status: FactoryStatus.IDLE,
        efficiency: '100.00',
        maintenanceCount: 0,
        setupCost: '300.00',
        fertilizerBoostActive: false,
        fertilizerBoostExpiresAt: null,
        ...overrides,
      }) as unknown as Factory;

    it('should apply fertilizer to an Agriculture factory consuming 4 units', async () => {
      const factory = makeFactory();
      (mockFactoryRepository.findOne as ReturnType<typeof vi.fn>).mockResolvedValue(factory);
      (mockCommodityRepository.findOne as ReturnType<typeof vi.fn>).mockResolvedValue(fertilizerCommodity);

      const result = await factoryService.applyFertilizer(playerId, factoryId);

      expect(result.factoryId).toBe(factoryId);
      expect(result.quantityConsumed).toBe(4);
      expect(result.bonus).toBe(0.15);
      expect(result.expiresAt).toBeInstanceOf(Date);
      // Expiry should be ~5 days from now
      const expectedExpiry = Date.now() + 5 * 24 * 60 * 60 * 1000;
      expect(result.expiresAt.getTime()).toBeCloseTo(expectedExpiry, -3);

      expect(mockInventoryService.removeFromInventory).toHaveBeenCalledWith(
        playerId,
        seasonId,
        fertilizerCommodityId,
        4,
      );
    });

    it('should apply fertilizer to a Forestry factory consuming 6 units', async () => {
      const factory = makeFactory({ category: CommodityCategory.FORESTRY });
      (mockFactoryRepository.findOne as ReturnType<typeof vi.fn>).mockResolvedValue(factory);
      (mockCommodityRepository.findOne as ReturnType<typeof vi.fn>).mockResolvedValue(fertilizerCommodity);

      const result = await factoryService.applyFertilizer(playerId, factoryId);

      expect(result.quantityConsumed).toBe(6);
      expect(result.bonus).toBe(0.12);

      expect(mockInventoryService.removeFromInventory).toHaveBeenCalledWith(
        playerId,
        seasonId,
        fertilizerCommodityId,
        6,
      );
    });

    it('should set fertilizerBoostActive to true and save expiry date', async () => {
      const factory = makeFactory();
      (mockFactoryRepository.findOne as ReturnType<typeof vi.fn>).mockResolvedValue(factory);
      (mockCommodityRepository.findOne as ReturnType<typeof vi.fn>).mockResolvedValue(fertilizerCommodity);

      await factoryService.applyFertilizer(playerId, factoryId);

      expect(mockFactoryRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          fertilizerBoostActive: true,
          fertilizerBoostExpiresAt: expect.any(Date),
        }),
      );
    });

    it('should schedule a fertilizer.expire job with 5-day delay', async () => {
      const factory = makeFactory();
      (mockFactoryRepository.findOne as ReturnType<typeof vi.fn>).mockResolvedValue(factory);
      (mockCommodityRepository.findOne as ReturnType<typeof vi.fn>).mockResolvedValue(fertilizerCommodity);

      await factoryService.applyFertilizer(playerId, factoryId);

      const fiveDaysMs = 5 * 24 * 60 * 60 * 1000;
      expect(mockFertilizerQueue.add).toHaveBeenCalledWith(
        'fertilizer.expire',
        {
          factoryId,
          playerId,
          seasonId,
          fertilizerCommodityId,
          requiredQuantity: 4,
        },
        {
          delay: fiveDaysMs,
          jobId: `fertilizer-expire-${factoryId}`,
          removeOnComplete: true,
        },
      );
    });

    it('should throw NotFoundException when factory not found', async () => {
      (mockFactoryRepository.findOne as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      await expect(
        factoryService.applyFertilizer(playerId, 'non-existent'),
      ).rejects.toThrow('Factory non-existent not found');
    });

    it('should reject fertilizer for unsupported category (ENERGY)', async () => {
      const factory = makeFactory({ category: CommodityCategory.ENERGY });
      (mockFactoryRepository.findOne as ReturnType<typeof vi.fn>).mockResolvedValue(factory);

      await expect(
        factoryService.applyFertilizer(playerId, factoryId),
      ).rejects.toThrow('does not support fertilizer');
    });

    it('should reject fertilizer for unsupported category (METAL)', async () => {
      const factory = makeFactory({ category: CommodityCategory.METAL });
      (mockFactoryRepository.findOne as ReturnType<typeof vi.fn>).mockResolvedValue(factory);

      await expect(
        factoryService.applyFertilizer(playerId, factoryId),
      ).rejects.toThrow('does not support fertilizer');
    });

    it('should reject fertilizer for unsupported category (LIVESTOCK)', async () => {
      const factory = makeFactory({ category: CommodityCategory.LIVESTOCK });
      (mockFactoryRepository.findOne as ReturnType<typeof vi.fn>).mockResolvedValue(factory);

      await expect(
        factoryService.applyFertilizer(playerId, factoryId),
      ).rejects.toThrow('does not support fertilizer');
    });

    it('should reject if factory already has an active fertilizer boost', async () => {
      const futureDate = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000); // 2 days from now
      const factory = makeFactory({
        fertilizerBoostActive: true,
        fertilizerBoostExpiresAt: futureDate,
      });
      (mockFactoryRepository.findOne as ReturnType<typeof vi.fn>).mockResolvedValue(factory);

      await expect(
        factoryService.applyFertilizer(playerId, factoryId),
      ).rejects.toThrow('already has an active fertilizer boost');
    });

    it('should allow reapplication if previous boost has expired', async () => {
      const pastDate = new Date(Date.now() - 1000); // already expired
      const factory = makeFactory({
        fertilizerBoostActive: true,
        fertilizerBoostExpiresAt: pastDate,
      });
      (mockFactoryRepository.findOne as ReturnType<typeof vi.fn>).mockResolvedValue(factory);
      (mockCommodityRepository.findOne as ReturnType<typeof vi.fn>).mockResolvedValue(fertilizerCommodity);

      const result = await factoryService.applyFertilizer(playerId, factoryId);

      expect(result.quantityConsumed).toBe(4);
      expect(result.bonus).toBe(0.15);
    });

    it('should throw when fertilizer commodity is not found in DB', async () => {
      const factory = makeFactory();
      (mockFactoryRepository.findOne as ReturnType<typeof vi.fn>).mockResolvedValue(factory);
      (mockCommodityRepository.findOne as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      await expect(
        factoryService.applyFertilizer(playerId, factoryId),
      ).rejects.toThrow('Fertilizer commodity not found');
    });

    it('should propagate insufficient inventory error from InventoryService', async () => {
      const factory = makeFactory();
      (mockFactoryRepository.findOne as ReturnType<typeof vi.fn>).mockResolvedValue(factory);
      (mockCommodityRepository.findOne as ReturnType<typeof vi.fn>).mockResolvedValue(fertilizerCommodity);
      (mockInventoryService.removeFromInventory as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Insufficient inventory. Requested: 4, available: 2'),
      );

      await expect(
        factoryService.applyFertilizer(playerId, factoryId),
      ).rejects.toThrow('Insufficient inventory');
    });
  });
});
