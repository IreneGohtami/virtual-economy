import { describe, it, expect, vi, beforeEach } from 'vitest';
import { InventoryService, STORAGE_TIERS } from './inventory.service';
import { TransactionType, SeasonStatus } from '@sea-commodity-tycoon/shared-types';
import { DataSource, Repository, EntityManager } from 'typeorm';
import { Queue } from 'bullmq';
import { Inventory } from '../entities/inventory.entity';
import { Commodity } from '../entities/commodity.entity';
import { PlayerSeason } from '../entities/player-season.entity';
import { Season } from '../entities/season.entity';
import { WalletService } from '../wallet/wallet.service';

describe('InventoryService', () => {
  let inventoryService: InventoryService;
  let mockInventoryRepository: Partial<Repository<Inventory>>;
  let mockCommodityRepository: Partial<Repository<Commodity>>;
  let mockPlayerSeasonRepository: Partial<Repository<PlayerSeason>>;
  let mockSeasonRepository: Partial<Repository<Season>>;
  let mockWalletService: Partial<WalletService>;
  let mockDataSource: Partial<DataSource>;
  let mockManager: Partial<EntityManager>;
  let mockProductionQueue: Partial<Queue>;

  const playerId = '11111111-1111-1111-1111-111111111111';
  const seasonId = '22222222-2222-2222-2222-222222222222';
  const commodityId = '33333333-3333-3333-3333-333333333333';

  const mockCommodity = {
    id: commodityId,
    name: 'Rice',
    slug: 'rice',
    category: 'AGRICULTURE',
    storageSize: 2,
  } as Commodity;

  const mockPlayerSeason = {
    id: 'ps-1',
    playerId,
    seasonId,
    storageCapacity: 500,
    coins: '1000.00',
  } as PlayerSeason;

  const activeSeason = {
    id: seasonId,
    status: SeasonStatus.ACTIVE,
  } as Season;

  beforeEach(() => {
    mockInventoryRepository = {
      find: vi.fn().mockResolvedValue([]),
      createQueryBuilder: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        getRawOne: vi.fn().mockResolvedValue({ total: '0' }),
      }),
    };

    mockCommodityRepository = {
      findOne: vi.fn().mockResolvedValue(mockCommodity),
    };

    mockPlayerSeasonRepository = {
      findOne: vi.fn().mockResolvedValue(mockPlayerSeason),
      save: vi.fn().mockImplementation((ps) => Promise.resolve(ps)),
    };

    mockSeasonRepository = {
      findOne: vi.fn().mockResolvedValue(activeSeason),
    };

    mockWalletService = {
      executeTransaction: vi.fn().mockResolvedValue({
        transactionId: 'tx-1',
        balanceAfter: 900,
        amount: -100,
      }),
    };

    mockManager = {
      findOne: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockImplementation((_entity, data) => ({
        id: 'inv-1',
        ...data,
      })),
      save: vi.fn().mockImplementation((_entity, data) => Promise.resolve(data)),
      remove: vi.fn().mockResolvedValue(undefined),
      createQueryBuilder: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        getRawOne: vi.fn().mockResolvedValue({ total: '0' }),
      }),
    };

    mockDataSource = {
      transaction: vi.fn().mockImplementation(async (cb) => cb(mockManager)),
    };

    mockProductionQueue = {
      add: vi.fn().mockResolvedValue(undefined),
      getJobs: vi.fn().mockResolvedValue([]),
    };

    inventoryService = new InventoryService(
      mockInventoryRepository as Repository<Inventory>,
      mockCommodityRepository as Repository<Commodity>,
      mockPlayerSeasonRepository as Repository<PlayerSeason>,
      mockSeasonRepository as Repository<Season>,
      mockWalletService as WalletService,
      mockDataSource as DataSource,
      mockProductionQueue as Queue,
    );
  });

  describe('getInventory', () => {
    it('should return empty array when no inventory items exist', async () => {
      const result = await inventoryService.getInventory(playerId, seasonId);
      expect(result).toEqual([]);
    });

    it('should return inventory items with commodity details', async () => {
      const mockItems = [
        {
          id: 'inv-1',
          playerId,
          seasonId,
          commodityId,
          quantity: 10,
          commodity: mockCommodity,
        },
      ];
      mockInventoryRepository.find = vi.fn().mockResolvedValue(mockItems);

      const result = await inventoryService.getInventory(playerId, seasonId);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        id: 'inv-1',
        commodityId,
        commodityName: 'Rice',
        commoditySlug: 'rice',
        category: 'AGRICULTURE',
        quantity: 10,
        storageSize: 2,
        totalStorageUsed: 20,
      });
    });

    it('should filter out items with zero quantity', async () => {
      const mockItems = [
        {
          id: 'inv-1',
          playerId,
          seasonId,
          commodityId,
          quantity: 0,
          commodity: mockCommodity,
        },
      ];
      mockInventoryRepository.find = vi.fn().mockResolvedValue(mockItems);

      const result = await inventoryService.getInventory(playerId, seasonId);
      expect(result).toHaveLength(0);
    });
  });

  describe('addToInventory', () => {
    it('should create a new inventory record when none exists', async () => {
      // Manager.findOne returns null (no existing inventory) for inventory,
      // but returns commodity and playerSeason for those lookups
      mockManager.findOne = vi.fn()
        .mockImplementation(async (entity, options) => {
          if (entity === Commodity) return mockCommodity;
          if (entity === PlayerSeason) return mockPlayerSeason;
          if (entity === Inventory) return null;
          return null;
        });

      const result = await inventoryService.addToInventory(playerId, seasonId, commodityId, 5);

      expect(mockDataSource.transaction).toHaveBeenCalled();
      expect(mockManager.create).toHaveBeenCalled();
      expect(mockManager.save).toHaveBeenCalled();
    });

    it('should increment existing inventory record', async () => {
      const existingInventory = {
        id: 'inv-1',
        playerId,
        seasonId,
        commodityId,
        quantity: 10,
      } as Inventory;

      mockManager.findOne = vi.fn()
        .mockImplementation(async (entity, _options) => {
          if (entity === Commodity) return mockCommodity;
          if (entity === PlayerSeason) return mockPlayerSeason;
          if (entity === Inventory) return existingInventory;
          return null;
        });

      await inventoryService.addToInventory(playerId, seasonId, commodityId, 5);

      expect(existingInventory.quantity).toBe(15);
      expect(mockManager.save).toHaveBeenCalledWith(Inventory, existingInventory);
    });

    it('should reject if quantity is not positive', async () => {
      await expect(
        inventoryService.addToInventory(playerId, seasonId, commodityId, 0),
      ).rejects.toThrow('Quantity must be positive');

      await expect(
        inventoryService.addToInventory(playerId, seasonId, commodityId, -1),
      ).rejects.toThrow('Quantity must be positive');
    });

    it('should reject if addition would exceed storage capacity', async () => {
      // Storage capacity is 500, storageSize is 2, quantity 300 → 600 > 500
      mockManager.findOne = vi.fn()
        .mockImplementation(async (entity, _options) => {
          if (entity === Commodity) return mockCommodity;
          if (entity === PlayerSeason) return mockPlayerSeason;
          if (entity === Inventory) return null;
          return null;
        });

      // Current usage is 0, trying to add 300 items × 2 storageSize = 600 > 500
      await expect(
        inventoryService.addToInventory(playerId, seasonId, commodityId, 300),
      ).rejects.toThrow('Insufficient storage capacity');
    });

    it('should allow addition when it fits within capacity', async () => {
      // Storage capacity is 500, storageSize is 2, quantity 100 → 200 <= 500
      mockManager.findOne = vi.fn()
        .mockImplementation(async (entity, _options) => {
          if (entity === Commodity) return mockCommodity;
          if (entity === PlayerSeason) return mockPlayerSeason;
          if (entity === Inventory) return null;
          return null;
        });

      await expect(
        inventoryService.addToInventory(playerId, seasonId, commodityId, 100),
      ).resolves.not.toThrow();
    });
  });

  describe('removeFromInventory', () => {
    it('should decrease quantity in existing inventory record', async () => {
      const existingInventory = {
        id: 'inv-1',
        playerId,
        seasonId,
        commodityId,
        quantity: 10,
      } as Inventory;

      mockManager.findOne = vi.fn().mockResolvedValue(existingInventory);

      await inventoryService.removeFromInventory(playerId, seasonId, commodityId, 5);

      expect(existingInventory.quantity).toBe(5);
      expect(mockManager.save).toHaveBeenCalledWith(Inventory, existingInventory);
    });

    it('should remove the record when quantity reaches zero', async () => {
      const existingInventory = {
        id: 'inv-1',
        playerId,
        seasonId,
        commodityId,
        quantity: 5,
      } as Inventory;

      mockManager.findOne = vi.fn().mockResolvedValue(existingInventory);

      await inventoryService.removeFromInventory(playerId, seasonId, commodityId, 5);

      expect(mockManager.remove).toHaveBeenCalledWith(Inventory, existingInventory);
    });

    it('should reject if quantity is not positive', async () => {
      await expect(
        inventoryService.removeFromInventory(playerId, seasonId, commodityId, 0),
      ).rejects.toThrow('Quantity must be positive');
    });

    it('should reject if insufficient inventory', async () => {
      const existingInventory = {
        id: 'inv-1',
        playerId,
        seasonId,
        commodityId,
        quantity: 3,
      } as Inventory;

      mockManager.findOne = vi.fn().mockResolvedValue(existingInventory);

      await expect(
        inventoryService.removeFromInventory(playerId, seasonId, commodityId, 5),
      ).rejects.toThrow('Insufficient inventory');
    });

    it('should reject when no inventory record exists', async () => {
      mockManager.findOne = vi.fn().mockResolvedValue(null);

      await expect(
        inventoryService.removeFromInventory(playerId, seasonId, commodityId, 1),
      ).rejects.toThrow('Insufficient inventory');
    });
  });

  describe('upgradeStorage', () => {
    it('should upgrade from 500 to 750 and deduct 100 coins', async () => {
      const ps = { ...mockPlayerSeason, storageCapacity: 500 } as PlayerSeason;
      mockPlayerSeasonRepository.findOne = vi.fn().mockResolvedValue(ps);

      const result = await inventoryService.upgradeStorage(playerId, seasonId);

      expect(result.previousCapacity).toBe(500);
      expect(result.newCapacity).toBe(750);
      expect(result.cost).toBe(100);
      expect(mockWalletService.executeTransaction).toHaveBeenCalledWith(
        playerId,
        seasonId,
        TransactionType.STORAGE_UPGRADE,
        -100,
        expect.objectContaining({
          referenceType: 'storage_upgrade',
        }),
      );
      expect(ps.storageCapacity).toBe(750);
    });

    it('should upgrade from 750 to 1000 and deduct 175 coins', async () => {
      const ps = { ...mockPlayerSeason, storageCapacity: 750 } as PlayerSeason;
      mockPlayerSeasonRepository.findOne = vi.fn().mockResolvedValue(ps);

      const result = await inventoryService.upgradeStorage(playerId, seasonId);

      expect(result.previousCapacity).toBe(750);
      expect(result.newCapacity).toBe(1000);
      expect(result.cost).toBe(175);
    });

    it('should reject when already at max capacity (5000)', async () => {
      const ps = { ...mockPlayerSeason, storageCapacity: 5000 } as PlayerSeason;
      mockPlayerSeasonRepository.findOne = vi.fn().mockResolvedValue(ps);

      await expect(
        inventoryService.upgradeStorage(playerId, seasonId),
      ).rejects.toThrow('Storage is already at maximum capacity (5000)');
    });

    it('should find next tier even if current capacity is non-standard', async () => {
      const ps = { ...mockPlayerSeason, storageCapacity: 600 } as PlayerSeason;
      mockPlayerSeasonRepository.findOne = vi.fn().mockResolvedValue(ps);

      const result = await inventoryService.upgradeStorage(playerId, seasonId);

      expect(result.previousCapacity).toBe(600);
      expect(result.newCapacity).toBe(750);
      expect(result.cost).toBe(100);
    });
  });

  describe('getStorageUsage', () => {
    it('should return usage, capacity, and available space', async () => {
      const result = await inventoryService.getStorageUsage(playerId, seasonId);

      expect(result).toEqual({
        used: 0,
        capacity: 500,
        available: 500,
      });
    });

    it('should throw when player season not found', async () => {
      mockPlayerSeasonRepository.findOne = vi.fn().mockResolvedValue(null);

      await expect(
        inventoryService.getStorageUsage(playerId, seasonId),
      ).rejects.toThrow('PlayerSeason not found');
    });
  });

  describe('getStorageTiers', () => {
    it('should return all tiers with correct current/available flags', async () => {
      const result = await inventoryService.getStorageTiers(playerId, seasonId);

      expect(result).toHaveLength(7);
      expect(result[0]).toEqual({ capacity: 500, cost: 0, current: true, available: false });
      expect(result[1]).toEqual({ capacity: 750, cost: 100, current: false, available: true });
      expect(result[6]).toEqual({ capacity: 5000, cost: 1500, current: false, available: true });
    });
  });

  describe('hasCapacityFor', () => {
    it('should return true when capacity is sufficient', async () => {
      const result = await inventoryService.hasCapacityFor(playerId, seasonId, commodityId, 100);
      // 100 items × 2 storageSize = 200 <= 500 capacity (with 0 used)
      expect(result).toBe(true);
    });

    it('should return false when capacity would be exceeded', async () => {
      // Mock current usage = 400
      (mockInventoryRepository.createQueryBuilder as ReturnType<typeof vi.fn>).mockReturnValue({
        innerJoin: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        getRawOne: vi.fn().mockResolvedValue({ total: '400' }),
      });

      // 100 items × 2 storageSize = 200, total would be 600 > 500
      const result = await inventoryService.hasCapacityFor(playerId, seasonId, commodityId, 100);
      expect(result).toBe(false);
    });

    it('should return true for zero or negative quantity', async () => {
      const result = await inventoryService.hasCapacityFor(playerId, seasonId, commodityId, 0);
      expect(result).toBe(true);
    });

    it('should return false when commodity is not found', async () => {
      mockCommodityRepository.findOne = vi.fn().mockResolvedValue(null);

      const result = await inventoryService.hasCapacityFor(playerId, seasonId, commodityId, 10);
      expect(result).toBe(false);
    });
  });

  describe('getActiveSeasonId', () => {
    it('should return the active season ID', async () => {
      const result = await inventoryService.getActiveSeasonId();
      expect(result).toBe(seasonId);
    });

    it('should throw when no active season exists', async () => {
      mockSeasonRepository.findOne = vi.fn().mockResolvedValue(null);

      await expect(inventoryService.getActiveSeasonId()).rejects.toThrow(
        'No active season found',
      );
    });
  });

  describe('STORAGE_TIERS', () => {
    it('should define all required tiers with correct costs', () => {
      expect(STORAGE_TIERS).toEqual([
        { capacity: 500, cost: 0 },
        { capacity: 750, cost: 100 },
        { capacity: 1000, cost: 175 },
        { capacity: 1500, cost: 300 },
        { capacity: 2000, cost: 500 },
        { capacity: 3000, cost: 800 },
        { capacity: 5000, cost: 1500 },
      ]);
    });

    it('should have strictly increasing capacities', () => {
      for (let i = 1; i < STORAGE_TIERS.length; i++) {
        expect(STORAGE_TIERS[i].capacity).toBeGreaterThan(STORAGE_TIERS[i - 1].capacity);
      }
    });

    it('should have non-decreasing costs', () => {
      for (let i = 1; i < STORAGE_TIERS.length; i++) {
        expect(STORAGE_TIERS[i].cost).toBeGreaterThanOrEqual(STORAGE_TIERS[i - 1].cost);
      }
    });
  });
});
