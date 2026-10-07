import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SeasonService } from './season.service';
import { SeasonStatus } from '@sea-commodity-tycoon/shared-types';
import { Repository } from 'typeorm';
import { Season } from '../entities/season.entity';
import { Player } from '../entities/player.entity';
import { PlayerSeason } from '../entities/player-season.entity';
import { Factory } from '../entities/factory.entity';
import { MarketListing } from '../entities/market-listing.entity';
import { MapService } from '../map/map.service';
import { EconomyService } from '../economy/economy.service';
import { WorkerService } from '../worker/worker.service';
import { ConflictException, NotFoundException, BadRequestException } from '@nestjs/common';

describe('SeasonService', () => {
  let service: SeasonService;
  let mockSeasonRepository: Partial<Repository<Season>>;
  let mockPlayerRepository: Partial<Repository<Player>>;
  let mockPlayerSeasonRepository: Partial<Repository<PlayerSeason>>;
  let mockFactoryRepository: Partial<Repository<Factory>>;
  let mockMarketListingRepository: Partial<Repository<MarketListing>>;
  let mockMapService: Partial<MapService>;
  let mockEconomyService: Partial<EconomyService>;
  let mockWorkerService: Partial<WorkerService>;

  const seasonId = '11111111-1111-1111-1111-111111111111';
  const playerId = '22222222-2222-2222-2222-222222222222';

  const mockSeason: Partial<Season> = {
    id: seasonId,
    startsAt: new Date('2024-01-01T00:00:00Z'),
    endsAt: new Date('2024-01-31T00:00:00Z'),
    status: SeasonStatus.ACTIVE,
    configuration: {},
    mapSeed: '12345',
    summary: null,
    createdAt: new Date('2024-01-01T00:00:00Z'),
  };

  const mockPlayer: Partial<Player> = {
    id: playerId,
    email: 'test@example.com',
    displayName: 'TestPlayer',
    authProvider: 'email',
  };

  beforeEach(() => {
    mockSeasonRepository = {
      findOne: vi.fn().mockResolvedValue(null),
      find: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockImplementation((data) => ({ id: seasonId, ...data })),
      save: vi.fn().mockImplementation((data) => Promise.resolve({ id: seasonId, ...data })),
    };

    mockPlayerRepository = {
      find: vi.fn().mockResolvedValue([mockPlayer]),
    };

    mockPlayerSeasonRepository = {
      create: vi.fn().mockImplementation((data) => data),
      save: vi.fn().mockImplementation((data) => Promise.resolve(data)),
    };

    mockFactoryRepository = {
      update: vi.fn().mockResolvedValue({ affected: 0 }),
    };

    mockMarketListingRepository = {
      update: vi.fn().mockResolvedValue({ affected: 0 }),
    };

    mockMapService = {
      generateMap: vi.fn().mockResolvedValue([]),
    };

    mockEconomyService = {
      initializePrices: vi.fn().mockResolvedValue(undefined),
      getLeaderboard: vi.fn().mockResolvedValue([
        { playerId, displayName: 'TestPlayer', netWorth: 1500, rank: 1 },
      ]),
    };

    mockWorkerService = {
      generateWorkerPool: vi.fn().mockResolvedValue(2000),
    };

    service = new SeasonService(
      mockSeasonRepository as Repository<Season>,
      mockPlayerRepository as Repository<Player>,
      mockPlayerSeasonRepository as Repository<PlayerSeason>,
      mockFactoryRepository as Repository<Factory>,
      mockMarketListingRepository as Repository<MarketListing>,
      mockMapService as MapService,
      mockEconomyService as EconomyService,
      mockWorkerService as WorkerService,
    );
  });

  describe('startSeason', () => {
    it('should create a new season with default 30-day duration', async () => {
      const result = await service.startSeason();

      expect(mockSeasonRepository.findOne).toHaveBeenCalledWith({
        where: { status: SeasonStatus.ACTIVE },
      });
      expect(mockSeasonRepository.create).toHaveBeenCalled();
      expect(mockSeasonRepository.save).toHaveBeenCalled();

      const createCall = (mockSeasonRepository.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(createCall.status).toBe(SeasonStatus.ACTIVE);
      expect(createCall.summary).toBeNull();

      // Verify duration is ~30 days
      const startTime = createCall.startsAt.getTime();
      const endTime = createCall.endsAt.getTime();
      const daysDiff = (endTime - startTime) / (1000 * 60 * 60 * 24);
      expect(daysDiff).toBe(30);
    });

    it('should create a season with custom duration', async () => {
      await service.startSeason({ durationDays: 14 });

      const createCall = (mockSeasonRepository.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
      const startTime = createCall.startsAt.getTime();
      const endTime = createCall.endsAt.getTime();
      const daysDiff = (endTime - startTime) / (1000 * 60 * 60 * 24);
      expect(daysDiff).toBe(14);
    });

    it('should throw ConflictException if a season is already active', async () => {
      (mockSeasonRepository.findOne as ReturnType<typeof vi.fn>).mockResolvedValue(mockSeason);

      await expect(service.startSeason()).rejects.toThrow(ConflictException);
    });

    it('should generate map for the new season', async () => {
      await service.startSeason();

      expect(mockMapService.generateMap).toHaveBeenCalledWith(
        seasonId,
        { width: undefined, height: undefined },
      );
    });

    it('should initialize prices for the new season', async () => {
      await service.startSeason();

      expect(mockEconomyService.initializePrices).toHaveBeenCalledWith(seasonId);
    });

    it('should generate worker pool for the new season', async () => {
      await service.startSeason();

      expect(mockWorkerService.generateWorkerPool).toHaveBeenCalledWith(seasonId);
    });

    it('should create PlayerSeason records for all existing players', async () => {
      await service.startSeason();

      expect(mockPlayerRepository.find).toHaveBeenCalled();
      expect(mockPlayerSeasonRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          playerId,
          seasonId,
          specialty: null,
          coins: '1000.00',
          storageCapacity: 500,
          workforceHappiness: '80.00',
        }),
      );
      expect(mockPlayerSeasonRepository.save).toHaveBeenCalled();
    });

    it('should set specialty to null requiring re-selection', async () => {
      await service.startSeason();

      const createCall = (mockPlayerSeasonRepository.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(createCall.specialty).toBeNull();
    });

    it('should pass custom map config if provided', async () => {
      await service.startSeason({ mapWidth: 200, mapHeight: 150 });

      expect(mockMapService.generateMap).toHaveBeenCalledWith(
        seasonId,
        { width: 200, height: 150 },
      );
    });
  });

  describe('endSeason', () => {
    it('should end an active season and record leaderboard summary', async () => {
      (mockSeasonRepository.findOne as ReturnType<typeof vi.fn>).mockResolvedValue({
        ...mockSeason,
        status: SeasonStatus.ACTIVE,
      });

      const result = await service.endSeason(seasonId);

      expect(mockEconomyService.getLeaderboard).toHaveBeenCalledWith(seasonId);
      expect(mockSeasonRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          status: SeasonStatus.ENDED,
          summary: expect.objectContaining({
            finalStandings: expect.any(Array),
            totalPlayers: 1,
            topPlayer: expect.objectContaining({
              playerId,
              displayName: 'TestPlayer',
              netWorth: 1500,
            }),
          }),
        }),
      );
    });

    it('should throw NotFoundException if season does not exist', async () => {
      (mockSeasonRepository.findOne as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      await expect(service.endSeason(seasonId)).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException if season is not ACTIVE', async () => {
      (mockSeasonRepository.findOne as ReturnType<typeof vi.fn>).mockResolvedValue({
        ...mockSeason,
        status: SeasonStatus.ENDED,
      });

      await expect(service.endSeason(seasonId)).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if season is PENDING', async () => {
      (mockSeasonRepository.findOne as ReturnType<typeof vi.fn>).mockResolvedValue({
        ...mockSeason,
        status: SeasonStatus.PENDING,
      });

      await expect(service.endSeason(seasonId)).rejects.toThrow(BadRequestException);
    });

    it('should handle season end with no players gracefully', async () => {
      (mockSeasonRepository.findOne as ReturnType<typeof vi.fn>).mockResolvedValue({
        ...mockSeason,
        status: SeasonStatus.ACTIVE,
      });
      (mockEconomyService.getLeaderboard as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const result = await service.endSeason(seasonId);

      expect(mockSeasonRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          summary: expect.objectContaining({
            totalPlayers: 0,
            topPlayer: null,
          }),
        }),
      );
    });
  });

  describe('getCurrentSeason', () => {
    it('should return the active season', async () => {
      (mockSeasonRepository.findOne as ReturnType<typeof vi.fn>).mockResolvedValue(mockSeason);

      const result = await service.getCurrentSeason();

      expect(result).toEqual(mockSeason);
      expect(mockSeasonRepository.findOne).toHaveBeenCalledWith({
        where: { status: SeasonStatus.ACTIVE },
        order: { startsAt: 'DESC' },
      });
    });

    it('should throw NotFoundException if no active season', async () => {
      (mockSeasonRepository.findOne as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      await expect(service.getCurrentSeason()).rejects.toThrow(NotFoundException);
    });
  });

  describe('getSeasonHistory', () => {
    it('should return all seasons ordered by start date descending', async () => {
      const seasons = [
        { ...mockSeason, id: 'season-2', startsAt: new Date('2024-02-01') },
        { ...mockSeason, id: 'season-1', startsAt: new Date('2024-01-01') },
      ];
      (mockSeasonRepository.find as ReturnType<typeof vi.fn>).mockResolvedValue(seasons);

      const result = await service.getSeasonHistory();

      expect(mockSeasonRepository.find).toHaveBeenCalledWith({
        order: { startsAt: 'DESC' },
      });
      expect(result).toHaveLength(2);
      expect(result[0]).toHaveProperty('id');
      expect(result[0]).toHaveProperty('startsAt');
      expect(result[0]).toHaveProperty('endsAt');
      expect(result[0]).toHaveProperty('status');
      expect(result[0]).toHaveProperty('createdAt');
    });

    it('should return empty array when no seasons exist', async () => {
      (mockSeasonRepository.find as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const result = await service.getSeasonHistory();

      expect(result).toEqual([]);
    });
  });

  describe('getSeasonSummary', () => {
    it('should return season summary for an existing season', async () => {
      const seasonWithSummary = {
        ...mockSeason,
        summary: {
          finalStandings: [{ playerId, displayName: 'TestPlayer', netWorth: 1500, rank: 1 }],
          totalPlayers: 1,
        },
      };
      (mockSeasonRepository.findOne as ReturnType<typeof vi.fn>).mockResolvedValue(seasonWithSummary);

      const result = await service.getSeasonSummary(seasonId);

      expect(result.id).toBe(seasonId);
      expect(result.summary).toBeDefined();
      expect(result.summary!.totalPlayers).toBe(1);
    });

    it('should throw NotFoundException for non-existent season', async () => {
      (mockSeasonRepository.findOne as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      await expect(service.getSeasonSummary('non-existent-id')).rejects.toThrow(NotFoundException);
    });

    it('should return null summary for a season that has not ended', async () => {
      (mockSeasonRepository.findOne as ReturnType<typeof vi.fn>).mockResolvedValue(mockSeason);

      const result = await service.getSeasonSummary(seasonId);

      expect(result.summary).toBeNull();
    });
  });
});
