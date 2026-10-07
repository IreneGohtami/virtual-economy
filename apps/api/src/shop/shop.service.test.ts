import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ShopService, SHOP_CONFIGS } from './shop.service';
import { ShopType, SeasonStatus, TransactionType } from '@sea-commodity-tycoon/shared-types';
import { DataSource, Repository, EntityManager } from 'typeorm';
import { Shop } from '../entities/shop.entity';
import { ShopInventory } from '../entities/shop-inventory.entity';
import { ShopAcceptedCommodity } from '../entities/shop-accepted-commodity.entity';
import { MapTile } from '../entities/map-tile.entity';
import { CurrentPrice } from '../entities/current-price.entity';
import { Season } from '../entities/season.entity';
import { Commodity } from '../entities/commodity.entity';
import { WalletService } from '../wallet/wallet.service';
import { InventoryService } from '../inventory/inventory.service';

describe('ShopService', () => {
  let shopService: ShopService;
  let mockShopRepository: Partial<Repository<Shop>>;
  let mockShopInventoryRepository: Partial<Repository<ShopInventory>>;
  let mockShopAcceptedCommodityRepository: Partial<Repository<ShopAcceptedCommodity>>;
  let mockMapTileRepository: Partial<Repository<MapTile>>;
  let mockCurrentPriceRepository: Partial<Repository<CurrentPrice>>;
  let mockSeasonRepository: Partial<Repository<Season>>;
  let mockCommodityRepository: Partial<Repository<Commodity>>;
  let mockWalletService: Partial<WalletService>;
  let mockInventoryService: Partial<InventoryService>;
  let mockDataSource: Partial<DataSource>;
  let mockManager: Partial<EntityManager>;

  const playerId = '11111111-1111-1111-1111-111111111111';
  const seasonId = '22222222-2222-2222-2222-222222222222';
  const shopId = '33333333-3333-3333-3333-333333333333';
  const tileId = '44444444-4444-4444-4444-444444444444';
  const commodityId = '55555555-5555-5555-5555-555555555555';

  const activeSeason = {
    id: seasonId,
    status: SeasonStatus.ACTIVE,
    startsAt: new Date('2024-01-01'),
    endsAt: new Date('2024-01-31'),
  } as Season;

  beforeEach(() => {
    mockManager = {
      findOne: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockImplementation((_entity, data) => ({
        ...data,
        id: shopId,
        constructedAt: new Date(),
      })),
      save: vi.fn().mockImplementation((_entity, data) => Promise.resolve({
        ...data,
        id: data?.id ?? shopId,
        constructedAt: data?.constructedAt ?? new Date(),
      })),
      delete: vi.fn().mockResolvedValue({ affected: 1 }),
      remove: vi.fn().mockResolvedValue(undefined),
    };

    mockDataSource = {
      transaction: vi.fn().mockImplementation(async (fn) => fn(mockManager)),
    };

    mockShopRepository = {
      find: vi.fn().mockResolvedValue([]),
      findOne: vi.fn().mockResolvedValue(null),
      save: vi.fn().mockImplementation((data) => Promise.resolve(data)),
    };

    const mockShopInventoryQB = {
      select: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      getRawOne: vi.fn().mockResolvedValue({ total: '0' }),
    };

    mockShopInventoryRepository = {
      find: vi.fn().mockResolvedValue([]),
      findOne: vi.fn().mockResolvedValue(null),
      save: vi.fn().mockImplementation((data) => Promise.resolve(data)),
      createQueryBuilder: vi.fn().mockReturnValue(mockShopInventoryQB),
    };

    mockShopAcceptedCommodityRepository = {
      findOne: vi.fn().mockResolvedValue(null),
    };

    mockMapTileRepository = {
      findOne: vi.fn().mockResolvedValue(null),
    };

    mockCurrentPriceRepository = {
      findOne: vi.fn().mockResolvedValue(null),
    };

    mockSeasonRepository = {
      findOne: vi.fn().mockResolvedValue(activeSeason),
    };

    mockCommodityRepository = {
      findOne: vi.fn().mockResolvedValue(null),
    };

    mockWalletService = {
      executeTransaction: vi.fn().mockResolvedValue({
        transactionId: 'tx-1',
        balanceAfter: 500,
        amount: -500,
      }),
      executeTransactionWithManager: vi.fn().mockResolvedValue({
        transactionId: 'tx-1',
        balanceAfter: 500,
        amount: -500,
      }),
    };

    mockInventoryService = {
      removeFromInventoryWithManager: vi.fn().mockResolvedValue({ id: 'inv-1', quantity: 0 }),
    };

    shopService = new ShopService(
      mockShopRepository as Repository<Shop>,
      mockShopInventoryRepository as Repository<ShopInventory>,
      mockShopAcceptedCommodityRepository as Repository<ShopAcceptedCommodity>,
      mockMapTileRepository as Repository<MapTile>,
      mockCurrentPriceRepository as Repository<CurrentPrice>,
      mockSeasonRepository as Repository<Season>,
      mockCommodityRepository as Repository<Commodity>,
      mockWalletService as WalletService,
      mockInventoryService as InventoryService,
      mockDataSource as DataSource,
    );
  });

  describe('construct', () => {
    it('should construct a shop on a valid CITY tile', async () => {
      const cityTile = {
        id: tileId,
        seasonId,
        terrainType: 'CITY',
        ownerPlayerId: playerId,
        factoryId: null,
      } as MapTile;

      (mockManager.findOne as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(cityTile)   // MapTile lookup
        .mockResolvedValueOnce(null);       // no existing shop

      const result = await shopService.construct(playerId, {
        tileId,
        shopType: ShopType.SUPERMARKET,
      });

      expect(result.shopType).toBe(ShopType.SUPERMARKET);
      expect(result.playerId).toBe(playerId);
      expect(result.tileId).toBe(tileId);
      expect(mockWalletService.executeTransactionWithManager).toHaveBeenCalledWith(
        mockManager,
        playerId,
        seasonId,
        TransactionType.FACTORY_PURCHASE,
        -500,
        expect.objectContaining({ referenceType: 'shop_construction' }),
      );
    });

    it('should reject construction on non-CITY terrain', async () => {
      const farmlandTile = {
        id: tileId,
        seasonId,
        terrainType: 'FARMLAND',
        ownerPlayerId: playerId,
        factoryId: null,
      } as MapTile;

      (mockManager.findOne as ReturnType<typeof vi.fn>).mockResolvedValueOnce(farmlandTile);

      await expect(
        shopService.construct(playerId, { tileId, shopType: ShopType.BUTCHER }),
      ).rejects.toThrow('Shops can only be constructed on CITY terrain tiles');
    });

    it('should reject construction on tile not owned by player', async () => {
      const otherPlayerTile = {
        id: tileId,
        seasonId,
        terrainType: 'CITY',
        ownerPlayerId: 'other-player-id',
        factoryId: null,
      } as MapTile;

      (mockManager.findOne as ReturnType<typeof vi.fn>).mockResolvedValueOnce(otherPlayerTile);

      await expect(
        shopService.construct(playerId, { tileId, shopType: ShopType.CAFE }),
      ).rejects.toThrow('You do not own this tile');
    });

    it('should reject construction on tile occupied by a factory', async () => {
      const occupiedTile = {
        id: tileId,
        seasonId,
        terrainType: 'CITY',
        ownerPlayerId: playerId,
        factoryId: 'some-factory-id',
      } as MapTile;

      (mockManager.findOne as ReturnType<typeof vi.fn>).mockResolvedValueOnce(occupiedTile);

      await expect(
        shopService.construct(playerId, { tileId, shopType: ShopType.PETROL_STATION }),
      ).rejects.toThrow('This tile is already occupied by a factory');
    });

    it('should reject construction on tile already occupied by a shop', async () => {
      const cityTile = {
        id: tileId,
        seasonId,
        terrainType: 'CITY',
        ownerPlayerId: playerId,
        factoryId: null,
      } as MapTile;

      const existingShop = { id: 'existing-shop', tileId } as Shop;

      (mockManager.findOne as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(cityTile)
        .mockResolvedValueOnce(existingShop);

      await expect(
        shopService.construct(playerId, { tileId, shopType: ShopType.FURNITURE }),
      ).rejects.toThrow('This tile is already occupied by a shop');
    });

    it('should use correct setup cost per shop type', async () => {
      const cityTile = {
        id: tileId,
        seasonId,
        terrainType: 'CITY',
        ownerPlayerId: playerId,
        factoryId: null,
      } as MapTile;

      (mockManager.findOne as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(cityTile)
        .mockResolvedValueOnce(null);

      await shopService.construct(playerId, { tileId, shopType: ShopType.CAR_STORE });

      expect(mockWalletService.executeTransactionWithManager).toHaveBeenCalledWith(
        mockManager,
        playerId,
        seasonId,
        TransactionType.FACTORY_PURCHASE,
        -1000,
        expect.anything(),
      );
    });
  });

  describe('stockShop', () => {
    it('should stock a shop with an accepted commodity', async () => {
      const shop = {
        id: shopId,
        playerId,
        seasonId,
        shopType: ShopType.SUPERMARKET,
        storageCapacity: 200,
      } as Shop;

      (mockShopRepository.findOne as ReturnType<typeof vi.fn>).mockResolvedValue(shop);
      (mockShopAcceptedCommodityRepository.findOne as ReturnType<typeof vi.fn>).mockResolvedValue({
        shopType: ShopType.SUPERMARKET,
        commodityId,
        minTypesRequired: 2,
      });
      (mockManager.findOne as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null); // no existing shop inventory

      const result = await shopService.stockShop(playerId, shopId, commodityId, 10);

      expect(mockInventoryService.removeFromInventoryWithManager).toHaveBeenCalledWith(
        mockManager,
        playerId,
        seasonId,
        commodityId,
        10,
      );
      expect(result.quantity).toBe(10);
    });

    it('should reject stocking with a non-accepted commodity', async () => {
      const shop = {
        id: shopId,
        playerId,
        seasonId,
        shopType: ShopType.BUTCHER,
        storageCapacity: 100,
      } as Shop;

      (mockShopRepository.findOne as ReturnType<typeof vi.fn>).mockResolvedValue(shop);
      (mockShopAcceptedCommodityRepository.findOne as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      await expect(
        shopService.stockShop(playerId, shopId, commodityId, 5),
      ).rejects.toThrow('does not accept commodity');
    });

    it('should reject stocking if shop storage capacity exceeded', async () => {
      const shop = {
        id: shopId,
        playerId,
        seasonId,
        shopType: ShopType.CAR_STORE,
        storageCapacity: 30,
      } as Shop;

      (mockShopRepository.findOne as ReturnType<typeof vi.fn>).mockResolvedValue(shop);
      (mockShopAcceptedCommodityRepository.findOne as ReturnType<typeof vi.fn>).mockResolvedValue({
        shopType: ShopType.CAR_STORE,
        commodityId,
        minTypesRequired: 1,
      });

      // Return current stock of 28 items
      const mockQB = {
        select: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        getRawOne: vi.fn().mockResolvedValue({ total: '28' }),
      };
      (mockShopInventoryRepository.createQueryBuilder as ReturnType<typeof vi.fn>).mockReturnValue(mockQB);

      await expect(
        shopService.stockShop(playerId, shopId, commodityId, 5),
      ).rejects.toThrow('Insufficient shop storage');
    });

    it('should increment existing shop inventory on repeated stocking', async () => {
      const shop = {
        id: shopId,
        playerId,
        seasonId,
        shopType: ShopType.SUPERMARKET,
        storageCapacity: 200,
      } as Shop;

      const existingInventory = { shopId, commodityId, quantity: 5 } as ShopInventory;

      (mockShopRepository.findOne as ReturnType<typeof vi.fn>).mockResolvedValue(shop);
      (mockShopAcceptedCommodityRepository.findOne as ReturnType<typeof vi.fn>).mockResolvedValue({
        shopType: ShopType.SUPERMARKET,
        commodityId,
        minTypesRequired: 2,
      });
      (mockManager.findOne as ReturnType<typeof vi.fn>).mockResolvedValueOnce(existingInventory);

      const result = await shopService.stockShop(playerId, shopId, commodityId, 3);

      expect(result.quantity).toBe(8);
    });
  });

  describe('processConsumption', () => {
    it('should consume inventory and generate revenue', async () => {
      const shop = {
        id: shopId,
        playerId,
        seasonId,
        shopType: ShopType.BUTCHER,
        demandRate: '2.00',
        shopInventories: [
          { commodityId, quantity: 10, shopId } as ShopInventory,
        ],
      } as Shop;

      (mockShopRepository.findOne as ReturnType<typeof vi.fn>).mockResolvedValue(shop);
      (mockCurrentPriceRepository.findOne as ReturnType<typeof vi.fn>).mockResolvedValue({
        seasonId,
        commodityId,
        price: '50.00',
      } as CurrentPrice);

      const result = await shopService.processConsumption(shopId);

      // Revenue = 2 consumed × (50 × 1.20) × 1.3 = 2 × 60 × 1.3 = 156
      expect(result.totalRevenue).toBeCloseTo(156);
      expect(result.commoditiesConsumed).toHaveLength(1);
      expect(result.commoditiesConsumed[0].quantity).toBe(2);
      expect(mockWalletService.executeTransaction).toHaveBeenCalledWith(
        playerId,
        seasonId,
        TransactionType.SHOP_REVENUE,
        expect.closeTo(156),
        expect.objectContaining({ referenceType: 'shop', referenceId: shopId }),
      );
    });

    it('should pause revenue when below minimum stocking types', async () => {
      const shop = {
        id: shopId,
        playerId,
        seasonId,
        shopType: ShopType.SUPERMARKET, // requires 2 types
        demandRate: '3.00',
        shopInventories: [
          { commodityId, quantity: 10, shopId } as ShopInventory,
          // Only 1 type stocked, but Supermarket requires 2
        ],
      } as Shop;

      (mockShopRepository.findOne as ReturnType<typeof vi.fn>).mockResolvedValue(shop);

      const result = await shopService.processConsumption(shopId);

      expect(result.totalRevenue).toBe(0);
      expect(result.commoditiesConsumed).toHaveLength(0);
      expect(mockWalletService.executeTransaction).not.toHaveBeenCalled();
    });

    it('should not consume more than available inventory', async () => {
      const shop = {
        id: shopId,
        playerId,
        seasonId,
        shopType: ShopType.PETROL_STATION, // demand_rate = 4
        demandRate: '4.00',
        shopInventories: [
          { commodityId, quantity: 2, shopId } as ShopInventory, // only 2 available
        ],
      } as Shop;

      (mockShopRepository.findOne as ReturnType<typeof vi.fn>).mockResolvedValue(shop);
      (mockCurrentPriceRepository.findOne as ReturnType<typeof vi.fn>).mockResolvedValue({
        seasonId,
        commodityId,
        price: '30.00',
      } as CurrentPrice);

      const result = await shopService.processConsumption(shopId);

      // Should consume only 2 (min of quantity=2, floor(demand_rate)=4)
      expect(result.commoditiesConsumed[0].quantity).toBe(2);
      // Revenue = 2 × (30 × 1.20) × 1.1 = 2 × 36 × 1.1 = 79.2
      expect(result.totalRevenue).toBeCloseTo(79.2);
    });
  });

  describe('deconstruct', () => {
    it('should deconstruct a shop with 25% fee', async () => {
      const shop = {
        id: shopId,
        playerId,
        seasonId,
        shopType: ShopType.SUPERMARKET,
        tileId,
      } as Shop;

      (mockShopRepository.findOne as ReturnType<typeof vi.fn>).mockResolvedValue(shop);

      const result = await shopService.deconstruct(playerId, shopId);

      // Supermarket setup cost = 500, 25% fee = 125
      expect(result.fee).toBe(125);
      expect(mockWalletService.executeTransactionWithManager).toHaveBeenCalledWith(
        mockManager,
        playerId,
        seasonId,
        TransactionType.SHOP_DECONSTRUCTION,
        -125,
        expect.objectContaining({ referenceType: 'shop', referenceId: shopId }),
      );
      expect(mockManager.delete).toHaveBeenCalledWith(ShopInventory, { shopId });
      expect(mockManager.remove).toHaveBeenCalledWith(Shop, shop);
    });

    it('should throw if shop not found', async () => {
      (mockShopRepository.findOne as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      await expect(
        shopService.deconstruct(playerId, shopId),
      ).rejects.toThrow('not found');
    });
  });

  describe('getShops', () => {
    it('should return all shops for a player', async () => {
      const shops = [
        { id: shopId, playerId, seasonId, shopType: ShopType.CAFE } as Shop,
      ];
      (mockShopRepository.find as ReturnType<typeof vi.fn>).mockResolvedValue(shops);

      const result = await shopService.getShops(playerId);

      expect(result).toHaveLength(1);
      expect(result[0].shopType).toBe(ShopType.CAFE);
      expect(mockShopRepository.find).toHaveBeenCalledWith({
        where: { playerId, seasonId },
        relations: ['shopInventories', 'tile'],
      });
    });
  });

  describe('getRevenue', () => {
    it('should return revenue info for a shop', async () => {
      const shop = {
        id: shopId,
        playerId,
        seasonId,
        shopType: ShopType.BUTCHER,
        demandRate: '2.00',
        shopInventories: [
          { commodityId, quantity: 10, shopId } as ShopInventory,
        ],
      } as Shop;

      (mockShopRepository.findOne as ReturnType<typeof vi.fn>).mockResolvedValue(shop);
      (mockCurrentPriceRepository.findOne as ReturnType<typeof vi.fn>).mockResolvedValue({
        seasonId,
        commodityId,
        price: '50.00',
      } as CurrentPrice);

      const result = await shopService.getRevenue(playerId, shopId);

      expect(result.shopId).toBe(shopId);
      expect(result.shopType).toBe(ShopType.BUTCHER);
      expect(result.isPaused).toBe(false);
      // Revenue = 2 × (50 × 1.20) × 1.3 = 156
      expect(result.revenuePerHour).toBeCloseTo(156);
      expect(result.commodities).toHaveLength(1);
    });

    it('should show paused status when below min types', async () => {
      const shop = {
        id: shopId,
        playerId,
        seasonId,
        shopType: ShopType.SUPERMARKET, // requires 2 types
        demandRate: '3.00',
        shopInventories: [
          { commodityId, quantity: 5, shopId } as ShopInventory,
        ],
      } as Shop;

      (mockShopRepository.findOne as ReturnType<typeof vi.fn>).mockResolvedValue(shop);

      const result = await shopService.getRevenue(playerId, shopId);

      expect(result.isPaused).toBe(true);
      expect(result.revenuePerHour).toBe(0);
      expect(result.stockedTypes).toBe(1);
      expect(result.minTypesRequired).toBe(2);
    });
  });

  describe('SHOP_CONFIGS', () => {
    it('should define all 7 shop types', () => {
      const shopTypes = Object.keys(SHOP_CONFIGS);
      expect(shopTypes).toHaveLength(7);
      expect(shopTypes).toContain(ShopType.SUPERMARKET);
      expect(shopTypes).toContain(ShopType.BUTCHER);
      expect(shopTypes).toContain(ShopType.CAFE);
      expect(shopTypes).toContain(ShopType.PETROL_STATION);
      expect(shopTypes).toContain(ShopType.FURNITURE);
      expect(shopTypes).toContain(ShopType.ELECTRONICS);
      expect(shopTypes).toContain(ShopType.CAR_STORE);
    });

    it('should have correct setup costs from config', () => {
      expect(SHOP_CONFIGS[ShopType.SUPERMARKET].setupCost).toBe(500);
      expect(SHOP_CONFIGS[ShopType.BUTCHER].setupCost).toBe(350);
      expect(SHOP_CONFIGS[ShopType.CAFE].setupCost).toBe(400);
      expect(SHOP_CONFIGS[ShopType.PETROL_STATION].setupCost).toBe(600);
      expect(SHOP_CONFIGS[ShopType.FURNITURE].setupCost).toBe(450);
      expect(SHOP_CONFIGS[ShopType.ELECTRONICS].setupCost).toBe(800);
      expect(SHOP_CONFIGS[ShopType.CAR_STORE].setupCost).toBe(1000);
    });

    it('should have Supermarket with minTypesRequired=2 and all others=1', () => {
      expect(SHOP_CONFIGS[ShopType.SUPERMARKET].minTypesRequired).toBe(2);
      expect(SHOP_CONFIGS[ShopType.BUTCHER].minTypesRequired).toBe(1);
      expect(SHOP_CONFIGS[ShopType.CAFE].minTypesRequired).toBe(1);
      expect(SHOP_CONFIGS[ShopType.PETROL_STATION].minTypesRequired).toBe(1);
      expect(SHOP_CONFIGS[ShopType.FURNITURE].minTypesRequired).toBe(1);
      expect(SHOP_CONFIGS[ShopType.ELECTRONICS].minTypesRequired).toBe(1);
      expect(SHOP_CONFIGS[ShopType.CAR_STORE].minTypesRequired).toBe(1);
    });
  });
});
