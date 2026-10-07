import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MarketplaceService } from './marketplace.service';
import { ListingStatus, TransactionType, SeasonStatus } from '@sea-commodity-tycoon/shared-types';
import { DataSource, Repository, EntityManager } from 'typeorm';
import { MarketListing } from '../entities/market-listing.entity';
import { MarketTrade } from '../entities/market-trade.entity';
import { CurrentPrice } from '../entities/current-price.entity';
import { Season } from '../entities/season.entity';
import { InventoryService } from '../inventory/inventory.service';
import { WalletService } from '../wallet/wallet.service';
import { ProductionService } from '../production/production.service';

vi.mock('@sea-commodity-tycoon/game-rules', () => ({
  calculateInstantSellAmount: (marketPrice: number, quantity: number) => marketPrice * 0.90 * quantity,
}));

describe('MarketplaceService', () => {
  let service: MarketplaceService;
  let mockListingRepository: Partial<Repository<MarketListing>>;
  let mockTradeRepository: Partial<Repository<MarketTrade>>;
  let mockCurrentPriceRepository: Partial<Repository<CurrentPrice>>;
  let mockSeasonRepository: Partial<Repository<Season>>;
  let mockInventoryService: Partial<InventoryService>;
  let mockWalletService: Partial<WalletService>;
  let mockProductionService: Partial<ProductionService>;
  let mockDataSource: Partial<DataSource>;
  let mockManager: Partial<EntityManager>;

  const playerId = '11111111-1111-1111-1111-111111111111';
  const buyerId = '22222222-2222-2222-2222-222222222222';
  const sellerId = '33333333-3333-3333-3333-333333333333';
  const seasonId = '44444444-4444-4444-4444-444444444444';
  const commodityId = '55555555-5555-5555-5555-555555555555';
  const listingId = '66666666-6666-6666-6666-666666666666';

  const mockCurrentPrice: Partial<CurrentPrice> = {
    seasonId,
    commodityId,
    price: '50.00',
    supplyMultiplier: '1.0000',
    demandMultiplier: '1.0000',
    lastUpdatedAt: new Date(),
  };

  const activeSeason = {
    id: seasonId,
    status: SeasonStatus.ACTIVE,
  } as Season;

  beforeEach(() => {
    mockListingRepository = {
      find: vi.fn().mockResolvedValue([]),
      createQueryBuilder: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        addSelect: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        andWhere: vi.fn().mockReturnThis(),
        getRawOne: vi.fn().mockResolvedValue({ totalListings: '0', totalQuantity: '0' }),
      }),
    };

    mockTradeRepository = {};

    mockCurrentPriceRepository = {
      findOne: vi.fn().mockResolvedValue(mockCurrentPrice),
      find: vi.fn().mockResolvedValue([mockCurrentPrice]),
    };

    mockSeasonRepository = {
      findOne: vi.fn().mockResolvedValue(activeSeason),
    };

    mockInventoryService = {
      removeFromInventoryWithManager: vi.fn().mockResolvedValue({
        id: 'inv-1',
        playerId,
        seasonId,
        commodityId,
        quantity: 0,
      }),
      addToInventoryWithManager: vi.fn().mockResolvedValue({
        id: 'inv-2',
        playerId: buyerId,
        seasonId,
        commodityId,
        quantity: 10,
      }),
    };

    mockWalletService = {
      executeTransactionWithManager: vi.fn().mockResolvedValue({
        transactionId: 'tx-1',
        balanceAfter: 500,
        amount: -100,
      }),
    };

    mockProductionService = {
      checkAndResumeForPlayer: vi.fn().mockResolvedValue(0),
    };

    mockManager = {
      findOne: vi.fn().mockResolvedValue(mockCurrentPrice),
      create: vi.fn().mockImplementation((_entity, data) => ({
        id: listingId,
        ...data,
      })),
      save: vi.fn().mockImplementation((_entity, data) => Promise.resolve(data)),
      createQueryBuilder: vi.fn().mockReturnValue({
        setLock: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        andWhere: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        getMany: vi.fn().mockResolvedValue([]),
        getOne: vi.fn().mockResolvedValue(null),
      }),
    };

    mockDataSource = {
      transaction: vi.fn().mockImplementation(async (cb) => cb(mockManager)),
    };

    service = new MarketplaceService(
      mockListingRepository as Repository<MarketListing>,
      mockTradeRepository as Repository<MarketTrade>,
      mockCurrentPriceRepository as Repository<CurrentPrice>,
      mockSeasonRepository as Repository<Season>,
      mockInventoryService as InventoryService,
      mockWalletService as WalletService,
      mockProductionService as ProductionService,
      mockDataSource as DataSource,
    );
  });

  describe('listForSale', () => {
    it('should create a listing and remove from inventory', async () => {
      const result = await service.listForSale(playerId, seasonId, commodityId, 10);

      expect(mockInventoryService.removeFromInventoryWithManager).toHaveBeenCalledWith(
        mockManager,
        playerId,
        seasonId,
        commodityId,
        10,
      );
      expect(mockManager.create).toHaveBeenCalledWith(MarketListing, expect.objectContaining({
        playerId,
        seasonId,
        commodityId,
        quantity: 10,
        remainingQuantity: 10,
        status: ListingStatus.ACTIVE,
      }));
      expect(mockManager.save).toHaveBeenCalled();
      expect(result.id).toBe(listingId);
      expect(result.quantity).toBe(10);
      expect(result.remainingQuantity).toBe(10);
      expect(result.status).toBe(ListingStatus.ACTIVE);
    });

    it('should reject if quantity is not positive', async () => {
      await expect(
        service.listForSale(playerId, seasonId, commodityId, 0),
      ).rejects.toThrow('Quantity must be positive');

      await expect(
        service.listForSale(playerId, seasonId, commodityId, -1),
      ).rejects.toThrow('Quantity must be positive');
    });

    it('should propagate error when inventory is insufficient', async () => {
      mockInventoryService.removeFromInventoryWithManager = vi.fn().mockRejectedValue(
        new Error('Insufficient inventory. Requested: 100, available: 5'),
      );

      await expect(
        service.listForSale(playerId, seasonId, commodityId, 100),
      ).rejects.toThrow('Insufficient inventory');
    });
  });

  describe('purchase', () => {
    const createListing = (id: string, sellId: string, remaining: number, listedAt: Date) => ({
      id,
      playerId: sellId,
      seasonId,
      commodityId,
      quantity: remaining,
      remainingQuantity: remaining,
      status: ListingStatus.ACTIVE,
      listedAt,
      filledAt: null,
      cancelledAt: null,
    });

    it('should purchase from a single listing when quantity matches', async () => {
      const listing = createListing('list-1', sellerId, 10, new Date('2024-01-01'));

      mockManager.createQueryBuilder = vi.fn().mockReturnValue({
        setLock: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        andWhere: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        getMany: vi.fn().mockResolvedValue([listing]),
        getOne: vi.fn().mockResolvedValue(null),
      });

      const result = await service.purchase(buyerId, seasonId, commodityId, 10);

      expect(result.totalQuantityFilled).toBe(10);
      expect(result.trades).toHaveLength(1);
      expect(result.trades[0].quantity).toBe(10);
      expect(result.trades[0].pricePerUnit).toBe(50);
      expect(result.trades[0].totalPrice).toBe(500);
      expect(result.totalCost).toBe(500);

      // Verify listing was marked as FILLED
      expect(listing.remainingQuantity).toBe(0);
      expect(listing.status).toBe(ListingStatus.FILLED);

      // Verify wallet transactions
      expect(mockWalletService.executeTransactionWithManager).toHaveBeenCalledTimes(2);
      // Buyer debited
      expect(mockWalletService.executeTransactionWithManager).toHaveBeenCalledWith(
        mockManager,
        buyerId,
        seasonId,
        TransactionType.MARKETPLACE_SALE,
        -500,
        expect.objectContaining({ referenceType: 'marketplace_purchase' }),
      );
      // Seller credited
      expect(mockWalletService.executeTransactionWithManager).toHaveBeenCalledWith(
        mockManager,
        sellerId,
        seasonId,
        TransactionType.MARKETPLACE_SALE,
        500,
        expect.objectContaining({ referenceType: 'marketplace_sale' }),
      );

      // Verify inventory added to buyer
      expect(mockInventoryService.addToInventoryWithManager).toHaveBeenCalledWith(
        mockManager,
        buyerId,
        seasonId,
        commodityId,
        10,
      );
    });

    it('should purchase across multiple listings in FIFO order (partial fills)', async () => {
      const listing1 = createListing('list-1', sellerId, 3, new Date('2024-01-01'));
      const listing2 = createListing('list-2', 'seller-2', 5, new Date('2024-01-02'));
      const listing3 = createListing('list-3', 'seller-3', 10, new Date('2024-01-03'));

      mockManager.createQueryBuilder = vi.fn().mockReturnValue({
        setLock: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        andWhere: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        getMany: vi.fn().mockResolvedValue([listing1, listing2, listing3]),
        getOne: vi.fn().mockResolvedValue(null),
      });

      const result = await service.purchase(buyerId, seasonId, commodityId, 7);

      expect(result.totalQuantityFilled).toBe(7);
      expect(result.trades).toHaveLength(2);

      // First listing fully consumed
      expect(result.trades[0].quantity).toBe(3);
      expect(result.trades[0].sellerId).toBe(sellerId);
      expect(listing1.remainingQuantity).toBe(0);
      expect(listing1.status).toBe(ListingStatus.FILLED);

      // Second listing partially consumed (4 of 5)
      expect(result.trades[1].quantity).toBe(4);
      expect(result.trades[1].sellerId).toBe('seller-2');
      expect(listing2.remainingQuantity).toBe(1);
      expect(listing2.status).toBe(ListingStatus.ACTIVE);

      // Third listing not touched
      expect(listing3.remainingQuantity).toBe(10);
      expect(listing3.status).toBe(ListingStatus.ACTIVE);

      // Total cost = 7 × 50 = 350
      expect(result.totalCost).toBe(350);
    });

    it('should reject when no listings available', async () => {
      mockManager.createQueryBuilder = vi.fn().mockReturnValue({
        setLock: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        andWhere: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        getMany: vi.fn().mockResolvedValue([]),
        getOne: vi.fn().mockResolvedValue(null),
      });

      await expect(
        service.purchase(buyerId, seasonId, commodityId, 5),
      ).rejects.toThrow('No listings available');
    });

    it('should reject when insufficient marketplace supply', async () => {
      const listing = createListing('list-1', sellerId, 3, new Date('2024-01-01'));

      mockManager.createQueryBuilder = vi.fn().mockReturnValue({
        setLock: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        andWhere: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        getMany: vi.fn().mockResolvedValue([listing]),
        getOne: vi.fn().mockResolvedValue(null),
      });

      await expect(
        service.purchase(buyerId, seasonId, commodityId, 10),
      ).rejects.toThrow('Insufficient marketplace supply');
    });

    it('should reject if quantity is not positive', async () => {
      await expect(
        service.purchase(buyerId, seasonId, commodityId, 0),
      ).rejects.toThrow('Quantity must be positive');
    });

    it('should reject when no market price found', async () => {
      mockManager.findOne = vi.fn().mockResolvedValue(null);

      mockManager.createQueryBuilder = vi.fn().mockReturnValue({
        setLock: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        andWhere: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        getMany: vi.fn().mockResolvedValue([]),
        getOne: vi.fn().mockResolvedValue(null),
      });

      await expect(
        service.purchase(buyerId, seasonId, commodityId, 5),
      ).rejects.toThrow('No market price found');
    });

    it('should trigger production resume check after successful purchase', async () => {
      const listing = createListing('list-1', sellerId, 10, new Date('2024-01-01'));

      mockManager.createQueryBuilder = vi.fn().mockReturnValue({
        setLock: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        andWhere: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        getMany: vi.fn().mockResolvedValue([listing]),
        getOne: vi.fn().mockResolvedValue(null),
      });

      await service.purchase(buyerId, seasonId, commodityId, 5);

      expect(mockProductionService.checkAndResumeForPlayer).toHaveBeenCalledWith(
        buyerId,
        seasonId,
      );
    });

    it('should not fail if production resume check throws', async () => {
      const listing = createListing('list-1', sellerId, 10, new Date('2024-01-01'));

      mockManager.createQueryBuilder = vi.fn().mockReturnValue({
        setLock: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        andWhere: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        getMany: vi.fn().mockResolvedValue([listing]),
        getOne: vi.fn().mockResolvedValue(null),
      });

      mockProductionService.checkAndResumeForPlayer = vi.fn().mockRejectedValue(
        new Error('queue error'),
      );

      // Should not throw
      const result = await service.purchase(buyerId, seasonId, commodityId, 5);
      expect(result.totalQuantityFilled).toBe(5);
    });

    it('should use the current global market price for all trades', async () => {
      // Price is 50.00 (from mockCurrentPrice)
      const listing1 = createListing('list-1', sellerId, 3, new Date('2024-01-01'));
      const listing2 = createListing('list-2', 'seller-2', 5, new Date('2024-01-02'));

      mockManager.createQueryBuilder = vi.fn().mockReturnValue({
        setLock: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        andWhere: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        getMany: vi.fn().mockResolvedValue([listing1, listing2]),
        getOne: vi.fn().mockResolvedValue(null),
      });

      const result = await service.purchase(buyerId, seasonId, commodityId, 5);

      // All trades should be at 50.00 per unit
      result.trades.forEach((trade) => {
        expect(trade.pricePerUnit).toBe(50);
      });
    });
  });

  describe('cancelListing', () => {
    it('should cancel an active listing and return quantity to inventory', async () => {
      const listing = {
        id: listingId,
        playerId,
        seasonId,
        commodityId,
        quantity: 10,
        remainingQuantity: 7,
        status: ListingStatus.ACTIVE,
        listedAt: new Date(),
        filledAt: null,
        cancelledAt: null,
      };

      mockManager.createQueryBuilder = vi.fn().mockReturnValue({
        setLock: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        getOne: vi.fn().mockResolvedValue(listing),
      });

      const result = await service.cancelListing(playerId, seasonId, listingId);

      expect(result.returnedQuantity).toBe(7);
      expect(listing.status).toBe(ListingStatus.CANCELLED);
      expect(listing.cancelledAt).toBeInstanceOf(Date);
      expect(mockManager.save).toHaveBeenCalledWith(MarketListing, listing);
      expect(mockInventoryService.addToInventoryWithManager).toHaveBeenCalledWith(
        mockManager,
        playerId,
        seasonId,
        commodityId,
        7,
      );
    });

    it('should reject when listing not found', async () => {
      mockManager.createQueryBuilder = vi.fn().mockReturnValue({
        setLock: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        getOne: vi.fn().mockResolvedValue(null),
      });

      await expect(
        service.cancelListing(playerId, seasonId, listingId),
      ).rejects.toThrow('not found');
    });

    it('should reject when player is not the listing owner', async () => {
      const listing = {
        id: listingId,
        playerId: 'someone-else',
        status: ListingStatus.ACTIVE,
        remainingQuantity: 5,
      };

      mockManager.createQueryBuilder = vi.fn().mockReturnValue({
        setLock: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        getOne: vi.fn().mockResolvedValue(listing),
      });

      await expect(
        service.cancelListing(playerId, seasonId, listingId),
      ).rejects.toThrow('only cancel your own');
    });

    it('should reject when listing is not active', async () => {
      const listing = {
        id: listingId,
        playerId,
        status: ListingStatus.FILLED,
        remainingQuantity: 0,
      };

      mockManager.createQueryBuilder = vi.fn().mockReturnValue({
        setLock: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        getOne: vi.fn().mockResolvedValue(listing),
      });

      await expect(
        service.cancelListing(playerId, seasonId, listingId),
      ).rejects.toThrow('not active');
    });

    it('should trigger production resume check after cancellation', async () => {
      const listing = {
        id: listingId,
        playerId,
        seasonId,
        commodityId,
        quantity: 10,
        remainingQuantity: 5,
        status: ListingStatus.ACTIVE,
        filledAt: null,
        cancelledAt: null,
      };

      mockManager.createQueryBuilder = vi.fn().mockReturnValue({
        setLock: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        getOne: vi.fn().mockResolvedValue(listing),
      });

      await service.cancelListing(playerId, seasonId, listingId);

      expect(mockProductionService.checkAndResumeForPlayer).toHaveBeenCalledWith(
        playerId,
        seasonId,
      );
    });
  });

  describe('getQueueInfo', () => {
    it('should return queue info with listings count and total quantity', async () => {
      (mockListingRepository.createQueryBuilder as ReturnType<typeof vi.fn>).mockReturnValue({
        select: vi.fn().mockReturnThis(),
        addSelect: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        andWhere: vi.fn().mockReturnThis(),
        getRawOne: vi.fn().mockResolvedValue({ totalListings: '5', totalQuantity: '42' }),
      });

      const result = await service.getQueueInfo(commodityId, seasonId);

      expect(result).toEqual({
        commodityId,
        seasonId,
        totalListings: 5,
        totalQuantity: 42,
        currentPrice: 50,
      });
    });

    it('should return zero price when no current price exists', async () => {
      mockCurrentPriceRepository.findOne = vi.fn().mockResolvedValue(null);

      (mockListingRepository.createQueryBuilder as ReturnType<typeof vi.fn>).mockReturnValue({
        select: vi.fn().mockReturnThis(),
        addSelect: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        andWhere: vi.fn().mockReturnThis(),
        getRawOne: vi.fn().mockResolvedValue({ totalListings: '0', totalQuantity: '0' }),
      });

      const result = await service.getQueueInfo(commodityId, seasonId);

      expect(result.currentPrice).toBe(0);
      expect(result.totalListings).toBe(0);
      expect(result.totalQuantity).toBe(0);
    });
  });

  describe('getAllPrices', () => {
    it('should return all current prices for the season', async () => {
      const result = await service.getAllPrices(seasonId);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        commodityId,
        price: 50,
        supplyMultiplier: 1,
        demandMultiplier: 1,
        lastUpdatedAt: expect.any(Date),
      });
    });

    it('should return empty array when no prices exist', async () => {
      mockCurrentPriceRepository.find = vi.fn().mockResolvedValue([]);

      const result = await service.getAllPrices(seasonId);

      expect(result).toEqual([]);
    });
  });

  describe('getPlayerListings', () => {
    it('should return active listings for a player', async () => {
      const listings = [
        {
          id: 'list-1',
          commodityId,
          quantity: 10,
          remainingQuantity: 7,
          listedAt: new Date('2024-01-01'),
          status: ListingStatus.ACTIVE,
        },
      ];
      mockListingRepository.find = vi.fn().mockResolvedValue(listings);

      const result = await service.getPlayerListings(playerId, seasonId);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        id: 'list-1',
        commodityId,
        quantity: 10,
        remainingQuantity: 7,
        listedAt: expect.any(Date),
        status: ListingStatus.ACTIVE,
      });
    });

    it('should return empty array when player has no active listings', async () => {
      mockListingRepository.find = vi.fn().mockResolvedValue([]);

      const result = await service.getPlayerListings(playerId, seasonId);

      expect(result).toEqual([]);
    });
  });

  describe('getActiveSeasonId', () => {
    it('should return the active season ID', async () => {
      const result = await service.getActiveSeasonId();
      expect(result).toBe(seasonId);
    });

    it('should throw when no active season exists', async () => {
      mockSeasonRepository.findOne = vi.fn().mockResolvedValue(null);

      await expect(service.getActiveSeasonId()).rejects.toThrow('No active season found');
    });
  });

  describe('instantSell', () => {
    it('should instantly sell at 90% of market price', async () => {
      // Market price is 50.00 from mockCurrentPrice
      const result = await service.instantSell(playerId, seasonId, commodityId, 10);

      // Expected amount: 50 * 0.90 * 10 = 450
      expect(result.amount).toBe(450);
      expect(result.pricePerUnit).toBe(45);
      expect(result.quantity).toBe(10);

      // Should remove from inventory
      expect(mockInventoryService.removeFromInventoryWithManager).toHaveBeenCalledWith(
        mockManager,
        playerId,
        seasonId,
        commodityId,
        10,
      );

      // Should credit wallet with INSTANT_SELL type
      expect(mockWalletService.executeTransactionWithManager).toHaveBeenCalledWith(
        mockManager,
        playerId,
        seasonId,
        TransactionType.INSTANT_SELL,
        450,
        expect.objectContaining({
          referenceType: 'instant_sell',
          referenceId: commodityId,
        }),
      );
    });

    it('should reject if quantity is not positive', async () => {
      await expect(
        service.instantSell(playerId, seasonId, commodityId, 0),
      ).rejects.toThrow('Quantity must be positive');

      await expect(
        service.instantSell(playerId, seasonId, commodityId, -5),
      ).rejects.toThrow('Quantity must be positive');
    });

    it('should reject if no market price exists', async () => {
      mockCurrentPriceRepository.findOne = vi.fn().mockResolvedValue(null);

      await expect(
        service.instantSell(playerId, seasonId, commodityId, 5),
      ).rejects.toThrow('No market price found');
    });

    it('should propagate error when inventory is insufficient', async () => {
      mockInventoryService.removeFromInventoryWithManager = vi.fn().mockRejectedValue(
        new Error('Insufficient inventory. Requested: 100, available: 5'),
      );

      await expect(
        service.instantSell(playerId, seasonId, commodityId, 100),
      ).rejects.toThrow('Insufficient inventory');
    });

    it('should calculate correct amount for different quantities', async () => {
      // Market price: 50.00, sell 1 unit → 50 * 0.90 * 1 = 45
      const result = await service.instantSell(playerId, seasonId, commodityId, 1);
      expect(result.amount).toBe(45);
      expect(result.pricePerUnit).toBe(45);
      expect(result.quantity).toBe(1);
    });

    it('should use the correct transaction type (INSTANT_SELL)', async () => {
      await service.instantSell(playerId, seasonId, commodityId, 5);

      expect(mockWalletService.executeTransactionWithManager).toHaveBeenCalledWith(
        mockManager,
        playerId,
        seasonId,
        TransactionType.INSTANT_SELL,
        225, // 50 * 0.90 * 5
        expect.any(Object),
      );
    });

    it('should not affect marketplace listings (independent from FIFO queue)', async () => {
      await service.instantSell(playerId, seasonId, commodityId, 5);

      // Should not create any listing
      expect(mockManager.create).not.toHaveBeenCalledWith(
        MarketListing,
        expect.anything(),
      );
    });
  });
});
