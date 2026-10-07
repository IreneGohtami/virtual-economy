import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EconomyService } from './economy.service';
import { SeasonStatus, ListingStatus, ProductionJobStatus } from '@sea-commodity-tycoon/shared-types';
import { Repository } from 'typeorm';
import { Commodity } from '../entities/commodity.entity';
import { CommodityPrice } from '../entities/commodity-price.entity';
import { CurrentPrice } from '../entities/current-price.entity';
import { Season } from '../entities/season.entity';
import { MarketTrade } from '../entities/market-trade.entity';
import { ProductionJob } from '../entities/production-job.entity';
import { Inventory } from '../entities/inventory.entity';
import { MarketListing } from '../entities/market-listing.entity';
import { PlayerSeason } from '../entities/player-season.entity';

describe('EconomyService', () => {
  let service: EconomyService;
  let mockCommodityRepository: Partial<Repository<Commodity>>;
  let mockCommodityPriceRepository: Partial<Repository<CommodityPrice>>;
  let mockCurrentPriceRepository: Partial<Repository<CurrentPrice>>;
  let mockSeasonRepository: Partial<Repository<Season>>;
  let mockMarketTradeRepository: Partial<Repository<MarketTrade>>;
  let mockProductionJobRepository: Partial<Repository<ProductionJob>>;
  let mockInventoryRepository: Partial<Repository<Inventory>>;
  let mockMarketListingRepository: Partial<Repository<MarketListing>>;
  let mockPlayerSeasonRepository: Partial<Repository<PlayerSeason>>;

  const seasonId = '44444444-4444-4444-4444-444444444444';
  const commodityId = '55555555-5555-5555-5555-555555555555';
  const playerId = '11111111-1111-1111-1111-111111111111';

  const mockCommodity: Partial<Commodity> = {
    id: commodityId,
    name: 'Rice',
    slug: 'rice',
    category: 'AGRICULTURE',
    level: 0,
    basePrice: '50.00',
    baseYield: 10,
    active: true,
  };

  beforeEach(() => {
    mockCommodityRepository = {
      find: vi.fn().mockResolvedValue([mockCommodity]),
    };

    mockCommodityPriceRepository = {
      find: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockImplementation((data) => ({ id: 'price-history-1', ...data })),
      save: vi.fn().mockImplementation((data) => Promise.resolve(data)),
    };

    mockCurrentPriceRepository = {
      find: vi.fn().mockResolvedValue([]),
      findOne: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockImplementation((data) => data),
      save: vi.fn().mockImplementation((data) => Promise.resolve(data)),
    };

    mockSeasonRepository = {
      findOne: vi.fn().mockResolvedValue({
        id: seasonId,
        status: SeasonStatus.ACTIVE,
        startsAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000), // 3 days ago (within stabilization)
        endsAt: new Date(Date.now() + 27 * 24 * 60 * 60 * 1000),
      }),
    };

    mockMarketTradeRepository = {
      createQueryBuilder: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        andWhere: vi.fn().mockReturnThis(),
        getRawOne: vi.fn().mockResolvedValue({ total: '0' }),
      }),
    };

    mockProductionJobRepository = {
      createQueryBuilder: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        andWhere: vi.fn().mockReturnThis(),
        getRawOne: vi.fn().mockResolvedValue({ total: '0' }),
      }),
    };

    mockInventoryRepository = {
      find: vi.fn().mockResolvedValue([]),
      createQueryBuilder: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        andWhere: vi.fn().mockReturnThis(),
        getRawOne: vi.fn().mockResolvedValue({ total: '0' }),
      }),
    };

    mockMarketListingRepository = {
      createQueryBuilder: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        andWhere: vi.fn().mockReturnThis(),
        getRawOne: vi.fn().mockResolvedValue({ total: '0' }),
      }),
    };

    mockPlayerSeasonRepository = {
      createQueryBuilder: vi.fn().mockReturnValue({
        innerJoinAndSelect: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        getMany: vi.fn().mockResolvedValue([]),
      }),
    };

    service = new EconomyService(
      mockCommodityRepository as Repository<Commodity>,
      mockCommodityPriceRepository as Repository<CommodityPrice>,
      mockCurrentPriceRepository as Repository<CurrentPrice>,
      mockSeasonRepository as Repository<Season>,
      mockMarketTradeRepository as Repository<MarketTrade>,
      mockProductionJobRepository as Repository<ProductionJob>,
      mockInventoryRepository as Repository<Inventory>,
      mockMarketListingRepository as Repository<MarketListing>,
      mockPlayerSeasonRepository as Repository<PlayerSeason>,
    );
  });

  describe('initializePrices', () => {
    it('should create current price records for all active commodities', async () => {
      await service.initializePrices(seasonId);

      expect(mockCurrentPriceRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          seasonId,
          commodityId,
          price: '50.00',
          supplyMultiplier: '1.0000',
          demandMultiplier: '1.0000',
        }),
      );
      expect(mockCurrentPriceRepository.save).toHaveBeenCalled();
      expect(mockCommodityPriceRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          seasonId,
          commodityId,
          price: '50.00',
          supplyMultiplier: '1.0000',
          demandMultiplier: '1.0000',
          tradeVolume: 0,
        }),
      );
      expect(mockCommodityPriceRepository.save).toHaveBeenCalled();
    });

    it('should update existing current price records if they already exist', async () => {
      const existingPrice = {
        seasonId,
        commodityId,
        price: '75.00',
        supplyMultiplier: '1.5000',
        demandMultiplier: '1.2000',
        lastUpdatedAt: new Date(),
      };
      mockCurrentPriceRepository.findOne = vi.fn().mockResolvedValue(existingPrice);

      await service.initializePrices(seasonId);

      // Should update existing record back to base price
      expect(existingPrice.price).toBe('50.00');
      expect(existingPrice.supplyMultiplier).toBe('1.0000');
      expect(existingPrice.demandMultiplier).toBe('1.0000');
      expect(mockCurrentPriceRepository.save).toHaveBeenCalledWith(existingPrice);
    });
  });

  describe('recalibratePrices', () => {
    it('should keep prices at base values during stabilization period (day <= 7)', async () => {
      // Season started 3 days ago → day 3, within stabilization
      const results = await service.recalibratePrices(seasonId);

      expect(results).toHaveLength(1);
      expect(results[0].newPrice).toBe(50); // base_price × 1.0 × 1.0
      expect(results[0].supplyMultiplier).toBe(1.0);
      expect(results[0].demandMultiplier).toBe(1.0);
    });

    it('should keep multipliers at 1.0 on day 7 (boundary)', async () => {
      // Season started exactly 7 days ago → day 7, still in stabilization
      mockSeasonRepository.findOne = vi.fn().mockResolvedValue({
        id: seasonId,
        status: SeasonStatus.ACTIVE,
        startsAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
        endsAt: new Date(Date.now() + 23 * 24 * 60 * 60 * 1000),
      });

      const results = await service.recalibratePrices(seasonId);

      expect(results[0].supplyMultiplier).toBe(1.0);
      expect(results[0].demandMultiplier).toBe(1.0);
      expect(results[0].newPrice).toBe(50);
    });

    it('should calculate dynamic multipliers after day 7', async () => {
      // Season started 10 days ago → day 10, past stabilization
      mockSeasonRepository.findOne = vi.fn().mockResolvedValue({
        id: seasonId,
        status: SeasonStatus.ACTIVE,
        startsAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
        endsAt: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000),
      });

      // Simulate supply: 150 total (production 50 + inventory 80 + listings 20)
      mockProductionJobRepository.createQueryBuilder = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        andWhere: vi.fn().mockReturnThis(),
        getRawOne: vi.fn().mockResolvedValue({ total: '50' }),
      });
      mockInventoryRepository.createQueryBuilder = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        andWhere: vi.fn().mockReturnThis(),
        getRawOne: vi.fn().mockResolvedValue({ total: '80' }),
      });
      mockMarketListingRepository.createQueryBuilder = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        andWhere: vi.fn().mockReturnThis(),
        getRawOne: vi.fn().mockResolvedValue({ total: '20' }),
      });

      // Simulate demand: 75 trades in last 24h
      mockMarketTradeRepository.createQueryBuilder = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        andWhere: vi.fn().mockReturnThis(),
        getRawOne: vi.fn().mockResolvedValue({ total: '75' }),
      });

      const results = await service.recalibratePrices(seasonId);

      expect(results).toHaveLength(1);
      // supply = 150, baseline = 100 → supply_score = 1.5 → supply_multiplier = 2.0 - 1.5 = 0.5
      expect(results[0].supplyMultiplier).toBe(0.5);
      // demand = 75, baseline = 50 → demand_score = 1.5 → demand_multiplier = 1.5
      expect(results[0].demandMultiplier).toBe(1.5);
      // price = 50 × 0.5 × 1.5 = 37.5
      expect(results[0].newPrice).toBe(37.5);
    });

    it('should clamp supply multiplier to [0.5, 2.0]', async () => {
      // Day 8, past stabilization
      mockSeasonRepository.findOne = vi.fn().mockResolvedValue({
        id: seasonId,
        status: SeasonStatus.ACTIVE,
        startsAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
        endsAt: new Date(Date.now() + 22 * 24 * 60 * 60 * 1000),
      });

      // Very high supply: 500 units → supply_score = 5 → 2.0 - 5 = -3 → clamped to 0.5
      mockProductionJobRepository.createQueryBuilder = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        andWhere: vi.fn().mockReturnThis(),
        getRawOne: vi.fn().mockResolvedValue({ total: '300' }),
      });
      mockInventoryRepository.createQueryBuilder = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        andWhere: vi.fn().mockReturnThis(),
        getRawOne: vi.fn().mockResolvedValue({ total: '150' }),
      });
      mockMarketListingRepository.createQueryBuilder = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        andWhere: vi.fn().mockReturnThis(),
        getRawOne: vi.fn().mockResolvedValue({ total: '50' }),
      });

      // Zero demand
      mockMarketTradeRepository.createQueryBuilder = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        andWhere: vi.fn().mockReturnThis(),
        getRawOne: vi.fn().mockResolvedValue({ total: '0' }),
      });

      const results = await service.recalibratePrices(seasonId);

      // supply_score = 500/100 = 5 → multiplier = max(0.5, 2.0 - 5) = 0.5
      expect(results[0].supplyMultiplier).toBe(0.5);
      // demand_score = 0/50 = 0 → multiplier = max(0.5, 0) = 0.5
      expect(results[0].demandMultiplier).toBe(0.5);
      // price = 50 × 0.5 × 0.5 = 12.5
      expect(results[0].newPrice).toBe(12.5);
    });

    it('should clamp demand multiplier upper bound to 2.0', async () => {
      // Day 8, past stabilization
      mockSeasonRepository.findOne = vi.fn().mockResolvedValue({
        id: seasonId,
        status: SeasonStatus.ACTIVE,
        startsAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
        endsAt: new Date(Date.now() + 22 * 24 * 60 * 60 * 1000),
      });

      // Zero supply → supply_score = 0 → 2.0 - 0 = 2.0
      mockProductionJobRepository.createQueryBuilder = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        andWhere: vi.fn().mockReturnThis(),
        getRawOne: vi.fn().mockResolvedValue({ total: '0' }),
      });
      mockInventoryRepository.createQueryBuilder = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        andWhere: vi.fn().mockReturnThis(),
        getRawOne: vi.fn().mockResolvedValue({ total: '0' }),
      });
      mockMarketListingRepository.createQueryBuilder = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        andWhere: vi.fn().mockReturnThis(),
        getRawOne: vi.fn().mockResolvedValue({ total: '0' }),
      });

      // Very high demand: 200 → demand_score = 200/50 = 4 → clamped to 2.0
      mockMarketTradeRepository.createQueryBuilder = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        andWhere: vi.fn().mockReturnThis(),
        getRawOne: vi.fn().mockResolvedValue({ total: '200' }),
      });

      const results = await service.recalibratePrices(seasonId);

      // supply_score = 0/100 = 0 → multiplier = min(2.0, 2.0 - 0) = 2.0
      expect(results[0].supplyMultiplier).toBe(2.0);
      // demand_score = 200/50 = 4 → multiplier = min(2.0, 4) = 2.0
      expect(results[0].demandMultiplier).toBe(2.0);
      // price = 50 × 2.0 × 2.0 = 200
      expect(results[0].newPrice).toBe(200);
    });

    it('should throw NotFoundException when season does not exist', async () => {
      mockSeasonRepository.findOne = vi.fn().mockResolvedValue(null);

      await expect(service.recalibratePrices(seasonId)).rejects.toThrow('Season not found');
    });

    it('should record history entries on each recalibration', async () => {
      await service.recalibratePrices(seasonId);

      expect(mockCommodityPriceRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          seasonId,
          commodityId,
          price: '50.00',
          supplyMultiplier: '1.0000',
          demandMultiplier: '1.0000',
        }),
      );
      expect(mockCommodityPriceRepository.save).toHaveBeenCalled();
    });

    it('should report the previous price in results', async () => {
      const existingPrice = {
        seasonId,
        commodityId,
        price: '75.00',
        supplyMultiplier: '1.5000',
        demandMultiplier: '1.0000',
        lastUpdatedAt: new Date(),
      };
      mockCurrentPriceRepository.findOne = vi.fn().mockResolvedValue(existingPrice);

      const results = await service.recalibratePrices(seasonId);

      expect(results[0].previousPrice).toBe(75);
      expect(results[0].newPrice).toBe(50); // stabilization → base price
    });
  });

  describe('getPriceHistory', () => {
    it('should return parsed price history records', async () => {
      const records = [
        {
          id: 'hist-1',
          seasonId,
          commodityId,
          price: '50.00',
          supplyMultiplier: '1.0000',
          demandMultiplier: '1.0000',
          supplyMetric: null,
          demandMetric: null,
          tradeVolume: 0,
          recordedAt: new Date('2024-01-01'),
        },
        {
          id: 'hist-2',
          seasonId,
          commodityId,
          price: '55.00',
          supplyMultiplier: '0.9000',
          demandMultiplier: '1.2222',
          supplyMetric: '120.50',
          demandMetric: '80.00',
          tradeVolume: 42,
          recordedAt: new Date('2024-01-02'),
        },
      ];
      mockCommodityPriceRepository.find = vi.fn().mockResolvedValue(records);

      const history = await service.getPriceHistory(commodityId, seasonId);

      expect(history).toHaveLength(2);
      expect(history[0]).toEqual({
        id: 'hist-1',
        price: 50,
        supplyMultiplier: 1,
        demandMultiplier: 1,
        supplyMetric: null,
        demandMetric: null,
        tradeVolume: 0,
        recordedAt: new Date('2024-01-01'),
      });
      expect(history[1]).toEqual({
        id: 'hist-2',
        price: 55,
        supplyMultiplier: 0.9,
        demandMultiplier: 1.2222,
        supplyMetric: 120.5,
        demandMetric: 80,
        tradeVolume: 42,
        recordedAt: new Date('2024-01-02'),
      });
    });

    it('should return empty array when no history exists', async () => {
      mockCommodityPriceRepository.find = vi.fn().mockResolvedValue([]);

      const history = await service.getPriceHistory(commodityId, seasonId);

      expect(history).toEqual([]);
    });
  });

  describe('getLeaderboard', () => {
    it('should return players ranked by net worth (cash + inventory value)', async () => {
      const playerSeasons = [
        {
          playerId: 'player-1',
          seasonId,
          coins: '500.00',
          player: { displayName: 'Alice' },
        },
        {
          playerId: 'player-2',
          seasonId,
          coins: '1200.00',
          player: { displayName: 'Bob' },
        },
        {
          playerId: 'player-3',
          seasonId,
          coins: '300.00',
          player: { displayName: 'Charlie' },
        },
      ];

      mockPlayerSeasonRepository.createQueryBuilder = vi.fn().mockReturnValue({
        innerJoinAndSelect: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        getMany: vi.fn().mockResolvedValue(playerSeasons),
      });

      // Prices for commodities
      mockCurrentPriceRepository.find = vi.fn().mockResolvedValue([
        { commodityId: 'comm-1', price: '50.00' },
        { commodityId: 'comm-2', price: '100.00' },
      ]);

      // Inventory: player-3 has 10 units of comm-2 (10 × 100 = 1000)
      mockInventoryRepository.find = vi.fn().mockResolvedValue([
        { playerId: 'player-3', commodityId: 'comm-2', quantity: 10 },
        { playerId: 'player-1', commodityId: 'comm-1', quantity: 2 },
      ]);

      const leaderboard = await service.getLeaderboard(seasonId);

      expect(leaderboard).toHaveLength(3);
      // player-3: 300 + 1000 = 1300
      // player-2: 1200 + 0 = 1200
      // player-1: 500 + 100 = 600
      expect(leaderboard[0]).toEqual({
        playerId: 'player-3',
        displayName: 'Charlie',
        netWorth: 1300,
        rank: 1,
      });
      expect(leaderboard[1]).toEqual({
        playerId: 'player-2',
        displayName: 'Bob',
        netWorth: 1200,
        rank: 2,
      });
      expect(leaderboard[2]).toEqual({
        playerId: 'player-1',
        displayName: 'Alice',
        netWorth: 600,
        rank: 3,
      });
    });

    it('should return empty leaderboard when no players in season', async () => {
      mockPlayerSeasonRepository.createQueryBuilder = vi.fn().mockReturnValue({
        innerJoinAndSelect: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        getMany: vi.fn().mockResolvedValue([]),
      });
      mockCurrentPriceRepository.find = vi.fn().mockResolvedValue([]);
      mockInventoryRepository.find = vi.fn().mockResolvedValue([]);

      const leaderboard = await service.getLeaderboard(seasonId);

      expect(leaderboard).toEqual([]);
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

  describe('getDaysSinceSeasonStart', () => {
    it('should calculate days correctly', () => {
      const now = new Date();
      const fiveDaysAgo = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000);

      const days = service.getDaysSinceSeasonStart(fiveDaysAgo);

      expect(days).toBe(5);
    });

    it('should return 0 for a season that started today', () => {
      const now = new Date();
      const halfDayAgo = new Date(now.getTime() - 12 * 60 * 60 * 1000);

      const days = service.getDaysSinceSeasonStart(halfDayAgo);

      expect(days).toBe(0);
    });

    it('should return 7 for a season that started exactly 7 days ago', () => {
      const now = new Date();
      const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

      const days = service.getDaysSinceSeasonStart(sevenDaysAgo);

      expect(days).toBe(7);
    });
  });
});
