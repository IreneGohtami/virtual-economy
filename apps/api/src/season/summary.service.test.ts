import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SummaryService, generateTagline } from './summary.service';
import { SeasonStatus } from '@sea-commodity-tycoon/shared-types';
import { Repository } from 'typeorm';
import { Season } from '../entities/season.entity';
import { ProductionJob } from '../entities/production-job.entity';
import { Inventory } from '../entities/inventory.entity';
import { MarketTrade } from '../entities/market-trade.entity';
import { GameEvent } from '../entities/game-event.entity';
import { Commodity } from '../entities/commodity.entity';
import { PlayerSeason } from '../entities/player-season.entity';
import { CurrentPrice } from '../entities/current-price.entity';
import { NotFoundException } from '@nestjs/common';

describe('generateTagline', () => {
  it('should produce disaster-themed tagline for 3+ disasters', () => {
    const tagline = generateTagline({
      mostTradedCategory: 'AGRICULTURE',
      disasterCount: 3,
      positiveEventCount: 0,
      topCommodityName: 'Rice',
      monopolyPercent: null,
      totalPlayers: 5,
    });

    expect(tagline).toContain('storms and resilience');
    expect(tagline).toContain('agriculture');
  });

  it('should produce adversity tagline for 1-2 disasters', () => {
    const tagline = generateTagline({
      mostTradedCategory: 'ENERGY',
      disasterCount: 1,
      positiveEventCount: 0,
      topCommodityName: 'Crude Oil',
      monopolyPercent: null,
      totalPlayers: 3,
    });

    expect(tagline).toContain('Adversity');
    expect(tagline).toContain('energy');
  });

  it('should produce prosperity tagline for 3+ positive events', () => {
    const tagline = generateTagline({
      mostTradedCategory: 'METAL',
      disasterCount: 0,
      positiveEventCount: 3,
      topCommodityName: 'Steel',
      monopolyPercent: null,
      totalPlayers: 4,
    });

    expect(tagline.toLowerCase()).toContain('prosperity');
    expect(tagline).toContain('metals');
  });

  it('should produce favorable winds for 1-2 positive events with no disasters', () => {
    const tagline = generateTagline({
      mostTradedCategory: 'LIVESTOCK',
      disasterCount: 0,
      positiveEventCount: 1,
      topCommodityName: 'Poultry',
      monopolyPercent: null,
      totalPlayers: 2,
    });

    expect(tagline).toContain('Favorable winds');
    expect(tagline).toContain('livestock');
  });

  it('should mention monopoly for supply percent >= 60%', () => {
    const tagline = generateTagline({
      mostTradedCategory: 'AGRICULTURE',
      disasterCount: 0,
      positiveEventCount: 0,
      topCommodityName: 'Rice',
      monopolyPercent: 75,
      totalPlayers: 5,
    });

    expect(tagline).toContain('titan');
  });

  it('should not mention monopoly for supply percent < 60%', () => {
    const tagline = generateTagline({
      mostTradedCategory: 'AGRICULTURE',
      disasterCount: 0,
      positiveEventCount: 0,
      topCommodityName: 'Rice',
      monopolyPercent: 40,
      totalPlayers: 5,
    });

    expect(tagline).not.toContain('titan');
  });

  it('should produce category-dominant tagline when no events', () => {
    const tagline = generateTagline({
      mostTradedCategory: 'FORESTRY',
      disasterCount: 0,
      positiveEventCount: 0,
      topCommodityName: null,
      monopolyPercent: null,
      totalPlayers: 5,
    });

    expect(tagline).toContain('forestry');
    expect(tagline.charAt(0)).toBe(tagline.charAt(0).toUpperCase());
  });

  it('should produce fallback tagline when no data available', () => {
    const tagline = generateTagline({
      mostTradedCategory: null,
      disasterCount: 0,
      positiveEventCount: 0,
      topCommodityName: null,
      monopolyPercent: null,
      totalPlayers: 3,
    });

    expect(tagline).toBe('Trade flourished across the Southeast Asian seas');
  });

  it('should produce quiet season tagline when no players', () => {
    const tagline = generateTagline({
      mostTradedCategory: null,
      disasterCount: 0,
      positiveEventCount: 0,
      topCommodityName: null,
      monopolyPercent: null,
      totalPlayers: 0,
    });

    expect(tagline).toBe('A quiet season in the archipelago');
  });

  it('should always capitalize first letter', () => {
    const tagline = generateTagline({
      mostTradedCategory: 'ENERGY',
      disasterCount: 2,
      positiveEventCount: 0,
      topCommodityName: 'Oil',
      monopolyPercent: null,
      totalPlayers: 4,
    });

    expect(tagline.charAt(0)).toBe(tagline.charAt(0).toUpperCase());
  });
});

describe('SummaryService', () => {
  let service: SummaryService;
  let mockSeasonRepository: Partial<Repository<Season>>;
  let mockProductionJobRepository: Partial<Repository<ProductionJob>>;
  let mockInventoryRepository: Partial<Repository<Inventory>>;
  let mockMarketTradeRepository: Partial<Repository<MarketTrade>>;
  let mockGameEventRepository: Partial<Repository<GameEvent>>;
  let mockCommodityRepository: Partial<Repository<Commodity>>;
  let mockPlayerSeasonRepository: Partial<Repository<PlayerSeason>>;
  let mockCurrentPriceRepository: Partial<Repository<CurrentPrice>>;

  const seasonId = 'season-1111-1111-1111-111111111111';
  const playerId = 'player-2222-2222-2222-222222222222';
  const commodityId = 'commodity-3333-3333-3333-333333333333';

  const mockSeason: Partial<Season> = {
    id: seasonId,
    startsAt: new Date('2024-01-01T00:00:00Z'),
    endsAt: new Date('2024-01-31T00:00:00Z'),
    status: SeasonStatus.ENDED,
    configuration: {},
    summary: null,
  };

  // Helper to make query builder chain mocks
  function mockQueryBuilder(result: unknown) {
    return {
      select: vi.fn().mockReturnThis(),
      addSelect: vi.fn().mockReturnThis(),
      innerJoin: vi.fn().mockReturnThis(),
      innerJoinAndSelect: vi.fn().mockReturnThis(),
      leftJoin: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      groupBy: vi.fn().mockReturnThis(),
      addGroupBy: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      getRawOne: vi.fn().mockResolvedValue(result),
      getRawMany: vi.fn().mockResolvedValue(Array.isArray(result) ? result : [result]),
      getMany: vi.fn().mockResolvedValue(Array.isArray(result) ? result : [result]),
    };
  }

  beforeEach(() => {
    mockSeasonRepository = {
      findOne: vi.fn().mockResolvedValue(mockSeason),
      save: vi.fn().mockImplementation((data) => Promise.resolve(data)),
    };

    mockProductionJobRepository = {
      createQueryBuilder: vi.fn().mockReturnValue(
        mockQueryBuilder({
          commodityId,
          slug: 'rice',
          name: 'Rice',
          category: 'AGRICULTURE',
          totalVolume: '500',
        }),
      ),
    };

    mockInventoryRepository = {
      createQueryBuilder: vi.fn().mockReturnValue(
        mockQueryBuilder({
          playerId,
          displayName: 'TopTrader',
          commoditySlug: 'rice',
          commodityName: 'Rice',
          quantity: '200',
          supplyPercent: '45.5',
        }),
      ),
      find: vi.fn().mockResolvedValue([
        { playerId, commodityId, quantity: 200, seasonId },
      ]),
    };

    mockMarketTradeRepository = {
      createQueryBuilder: vi.fn().mockReturnValue(
        mockQueryBuilder({ category: 'AGRICULTURE', totalVolume: '1000' }),
      ),
    };

    mockGameEventRepository = {
      find: vi.fn().mockResolvedValue([
        {
          eventType: 'FLOOD',
          name: 'Monsoon Flood',
          affectedCategories: ['AGRICULTURE'],
          startsAt: new Date('2024-01-10'),
          endsAt: new Date('2024-01-13'),
        },
        {
          eventType: 'EXCELLENT_HARVEST',
          name: 'Excellent Harvest',
          affectedCategories: ['AGRICULTURE'],
          startsAt: new Date('2024-01-20'),
          endsAt: new Date('2024-01-22'),
        },
      ]),
    };

    mockCommodityRepository = {
      find: vi.fn().mockResolvedValue([]),
    };

    mockPlayerSeasonRepository = {
      createQueryBuilder: vi.fn().mockReturnValue(
        mockQueryBuilder([
          {
            playerId,
            coins: '2500.00',
            player: { displayName: 'TopTrader' },
          },
        ]),
      ),
      find: vi.fn().mockResolvedValue([]),
    };

    mockCurrentPriceRepository = {
      find: vi.fn().mockResolvedValue([
        { commodityId, price: '25.00', seasonId },
      ]),
    };

    service = new SummaryService(
      mockSeasonRepository as Repository<Season>,
      mockProductionJobRepository as Repository<ProductionJob>,
      mockInventoryRepository as Repository<Inventory>,
      mockMarketTradeRepository as Repository<MarketTrade>,
      mockGameEventRepository as Repository<GameEvent>,
      mockCommodityRepository as Repository<Commodity>,
      mockPlayerSeasonRepository as Repository<PlayerSeason>,
      mockCurrentPriceRepository as Repository<CurrentPrice>,
    );
  });

  describe('generateFullSummary', () => {
    it('should throw NotFoundException when season does not exist', async () => {
      (mockSeasonRepository.findOne as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      await expect(service.generateFullSummary('non-existent')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should generate a summary and persist it to the season record', async () => {
      const result = await service.generateFullSummary(seasonId);

      expect(result).toBeDefined();
      expect(result.seasonId).toBe(seasonId);
      expect(result.generatedAt).toBeDefined();
      expect(result.tagline).toBeDefined();
      expect(typeof result.tagline).toBe('string');
      expect(result.tagline.length).toBeGreaterThan(0);

      // Verify save was called with the summary
      expect(mockSeasonRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          summary: expect.objectContaining({
            seasonId,
            tagline: expect.any(String),
          }),
        }),
      );
    });

    it('should include key events from the season', async () => {
      const result = await service.generateFullSummary(seasonId);

      expect(result.keyEvents).toHaveLength(2);
      expect(result.keyEvents[0].eventType).toBe('FLOOD');
      expect(result.keyEvents[1].eventType).toBe('EXCELLENT_HARVEST');
    });

    it('should use taglineOverride from season configuration if present', async () => {
      const seasonWithOverride = {
        ...mockSeason,
        configuration: { taglineOverride: 'Custom tagline from operator' },
      };
      (mockSeasonRepository.findOne as ReturnType<typeof vi.fn>).mockResolvedValue(
        seasonWithOverride,
      );

      const result = await service.generateFullSummary(seasonId);

      expect(result.tagline).toBe('Custom tagline from operator');
      expect(result.taglineOverride).toBe('Custom tagline from operator');
    });

    it('should handle season with no production, no trades, and no events', async () => {
      (mockProductionJobRepository.createQueryBuilder as ReturnType<typeof vi.fn>).mockReturnValue(
        mockQueryBuilder(null),
      );
      (mockInventoryRepository.createQueryBuilder as ReturnType<typeof vi.fn>).mockReturnValue(
        mockQueryBuilder(null),
      );
      (mockMarketTradeRepository.createQueryBuilder as ReturnType<typeof vi.fn>).mockReturnValue(
        mockQueryBuilder(null),
      );
      (mockGameEventRepository.find as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      (mockPlayerSeasonRepository.createQueryBuilder as ReturnType<typeof vi.fn>).mockReturnValue(
        mockQueryBuilder([]),
      );
      (mockInventoryRepository.find as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const result = await service.generateFullSummary(seasonId);

      expect(result.highestProducedCommodity).toBeNull();
      expect(result.marketMonopoly).toBeNull();
      expect(result.keyEvents).toEqual([]);
      expect(result.tagline).toBeDefined();
    });

    it('should include startsAt and endsAt from the season', async () => {
      const result = await service.generateFullSummary(seasonId);

      expect(result.startsAt).toEqual(mockSeason.startsAt);
      expect(result.endsAt).toEqual(mockSeason.endsAt);
    });
  });
});
