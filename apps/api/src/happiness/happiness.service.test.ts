import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HappinessService } from './happiness.service';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import {
  SeasonStatus,
  TransactionType,
  WorkerStatus,
  ProductionJobStatus,
  FactoryStatus,
} from '@sea-commodity-tycoon/shared-types';
import { ObjectLiteral, Repository, DataSource, EntityManager } from 'typeorm';
import { PlayerSeason } from '../entities/player-season.entity';
import { WorkerAssignment } from '../entities/worker-assignment.entity';
import { WorkerProfile } from '../entities/worker-profile.entity';
import { Season } from '../entities/season.entity';
import { Factory } from '../entities/factory.entity';
import { ProductionJob } from '../entities/production-job.entity';
import { Notification } from '../entities/notification.entity';
import { WalletService } from '../wallet/wallet.service';

type MockRepository<T extends ObjectLiteral> = Partial<
  Record<keyof Repository<T>, ReturnType<typeof vi.fn>>
>;

describe('HappinessService', () => {
  let service: HappinessService;
  let playerSeasonRepo: MockRepository<PlayerSeason>;
  let workerAssignmentRepo: MockRepository<WorkerAssignment>;
  let workerProfileRepo: MockRepository<WorkerProfile>;
  let seasonRepo: MockRepository<Season>;
  let factoryRepo: MockRepository<Factory>;
  let productionJobRepo: MockRepository<ProductionJob>;
  let notificationRepo: MockRepository<Notification>;
  let mockDataSource: Partial<DataSource>;
  let mockWalletService: Partial<WalletService>;
  let mockManager: Partial<EntityManager>;

  const playerId = '11111111-1111-1111-1111-111111111111';
  const seasonId = '22222222-2222-2222-2222-222222222222';

  const mockSeason: Partial<Season> = {
    id: seasonId,
    status: SeasonStatus.ACTIVE,
    startsAt: new Date('2024-01-01'),
    endsAt: new Date('2024-01-31'),
  };

  const mockPlayerSeason: Partial<PlayerSeason> = {
    id: 'ps-1',
    playerId,
    seasonId,
    specialty: 'AGRICULTURE',
    coins: '1000.00',
    storageCapacity: 500,
    workforceHappiness: '80.00',
    lastHappinessDecayAt: null,
  };

  beforeEach(() => {
    playerSeasonRepo = {
      findOne: vi.fn(),
      find: vi.fn(),
      save: vi.fn().mockImplementation((entity) => Promise.resolve(entity)),
    };

    workerAssignmentRepo = {
      find: vi.fn(),
      save: vi.fn().mockImplementation((entity) => Promise.resolve(entity)),
      createQueryBuilder: vi.fn(),
    };

    workerProfileRepo = {};

    seasonRepo = {
      findOne: vi.fn(),
    };

    factoryRepo = {};
    productionJobRepo = {};
    notificationRepo = {};

    mockManager = {
      createQueryBuilder: vi.fn().mockReturnValue({
        setLock: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        andWhere: vi.fn().mockReturnThis(),
        getOne: vi.fn(),
        update: vi.fn().mockReturnThis(),
        set: vi.fn().mockReturnThis(),
        execute: vi.fn().mockResolvedValue({ affected: 0 }),
      }),
      find: vi.fn(),
      save: vi.fn().mockImplementation((entity, data) => Promise.resolve(data)),
      create: vi.fn().mockImplementation((_entity, data) => data),
    };

    mockDataSource = {
      transaction: vi.fn().mockImplementation(async (cb: (manager: EntityManager) => Promise<unknown>) => {
        return cb(mockManager as unknown as EntityManager);
      }),
    };

    mockWalletService = {
      executeTransactionWithManager: vi.fn().mockResolvedValue({
        transactionId: 'txn-1',
        balanceAfter: 950,
        amount: -50,
      }),
    };

    service = new HappinessService(
      playerSeasonRepo as unknown as Repository<PlayerSeason>,
      workerAssignmentRepo as unknown as Repository<WorkerAssignment>,
      workerProfileRepo as unknown as Repository<WorkerProfile>,
      seasonRepo as unknown as Repository<Season>,
      factoryRepo as unknown as Repository<Factory>,
      productionJobRepo as unknown as Repository<ProductionJob>,
      notificationRepo as unknown as Repository<Notification>,
      { findOne: vi.fn().mockResolvedValue(null) } as any,
      mockDataSource as unknown as DataSource,
      mockWalletService as unknown as WalletService,
    );
  });

  describe('getHappiness', () => {
    it('should return current happiness state', async () => {
      seasonRepo.findOne!.mockResolvedValue(mockSeason);
      playerSeasonRepo.findOne!.mockResolvedValue({ ...mockPlayerSeason });

      const result = await service.getHappiness(playerId);

      expect(result.currentHappiness).toBe(80);
      expect(result.warningThreshold).toBe(50);
      expect(result.criticalThreshold).toBe(30);
      expect(result.isWarning).toBe(false);
      expect(result.isCritical).toBe(false);
      expect(result.lastDecayAt).toBeNull();
    });

    it('should mark isWarning when happiness is at or below 50%', async () => {
      seasonRepo.findOne!.mockResolvedValue(mockSeason);
      playerSeasonRepo.findOne!.mockResolvedValue({
        ...mockPlayerSeason,
        workforceHappiness: '45.00',
      });

      const result = await service.getHappiness(playerId);

      expect(result.currentHappiness).toBe(45);
      expect(result.isWarning).toBe(true);
      expect(result.isCritical).toBe(false);
    });

    it('should mark isCritical when happiness is at or below 30%', async () => {
      seasonRepo.findOne!.mockResolvedValue(mockSeason);
      playerSeasonRepo.findOne!.mockResolvedValue({
        ...mockPlayerSeason,
        workforceHappiness: '25.00',
      });

      const result = await service.getHappiness(playerId);

      expect(result.currentHappiness).toBe(25);
      expect(result.isWarning).toBe(true);
      expect(result.isCritical).toBe(true);
    });

    it('should throw NotFoundException when no active season', async () => {
      seasonRepo.findOne!.mockResolvedValue(null);

      await expect(service.getHappiness(playerId)).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException when player season not found', async () => {
      seasonRepo.findOne!.mockResolvedValue(mockSeason);
      playerSeasonRepo.findOne!.mockResolvedValue(null);

      await expect(service.getHappiness(playerId)).rejects.toThrow(NotFoundException);
    });
  });

  describe('getAvailableBoosts', () => {
    it('should return default boosts', () => {
      const boosts = service.getAvailableBoosts();

      expect(boosts).toHaveLength(3);
      expect(boosts[0]).toEqual({
        slug: 'bonus',
        name: 'Bonus',
        cost: 50,
        happinessIncrease: 5,
      });
      expect(boosts[1]).toEqual({
        slug: 'company-trip',
        name: 'Company Trip',
        cost: 120,
        happinessIncrease: 10,
      });
      expect(boosts[2]).toEqual({
        slug: 'salary-raise',
        name: 'Salary Raise',
        cost: 200,
        happinessIncrease: 15,
      });
    });

    it('should return custom boosts after loadBoostDefinitions', () => {
      service.loadBoostDefinitions([
        { slug: 'custom', name: 'Custom Boost', cost: 75, happinessIncrease: 8 },
      ]);

      const boosts = service.getAvailableBoosts();

      expect(boosts).toHaveLength(1);
      expect(boosts[0].slug).toBe('custom');
    });
  });

  describe('purchaseBoost', () => {
    beforeEach(() => {
      seasonRepo.findOne!.mockResolvedValue(mockSeason);

      (mockManager.createQueryBuilder as ReturnType<typeof vi.fn>).mockReturnValue({
        setLock: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        andWhere: vi.fn().mockReturnThis(),
        getOne: vi.fn().mockResolvedValue({ ...mockPlayerSeason }),
        update: vi.fn().mockReturnThis(),
        set: vi.fn().mockReturnThis(),
        execute: vi.fn().mockResolvedValue({ affected: 0 }),
      });
    });

    it('should apply bonus boost and cap at 100%', async () => {
      (mockManager.createQueryBuilder as ReturnType<typeof vi.fn>).mockReturnValue({
        setLock: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        andWhere: vi.fn().mockReturnThis(),
        getOne: vi.fn().mockResolvedValue({
          ...mockPlayerSeason,
          workforceHappiness: '80.00',
        }),
      });

      const result = await service.purchaseBoost(playerId, 'bonus');

      expect(result.previousHappiness).toBe(80);
      expect(result.newHappiness).toBe(85);
      expect(result.boostApplied).toBe('Bonus');
      expect(result.boostAmount).toBe(5);
      expect(result.coinsCost).toBe(50);
      expect(mockWalletService.executeTransactionWithManager).toHaveBeenCalledWith(
        expect.anything(),
        playerId,
        seasonId,
        TransactionType.HAPPINESS_BOOST,
        -50,
        expect.objectContaining({
          referenceType: 'happiness_boost',
          referenceId: 'bonus',
        }),
      );
    });

    it('should cap happiness at 100%', async () => {
      (mockManager.createQueryBuilder as ReturnType<typeof vi.fn>).mockReturnValue({
        setLock: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        andWhere: vi.fn().mockReturnThis(),
        getOne: vi.fn().mockResolvedValue({
          ...mockPlayerSeason,
          workforceHappiness: '97.00',
        }),
      });

      const result = await service.purchaseBoost(playerId, 'bonus');

      expect(result.newHappiness).toBe(100);
    });

    it('should apply salary-raise boost correctly', async () => {
      (mockManager.createQueryBuilder as ReturnType<typeof vi.fn>).mockReturnValue({
        setLock: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        andWhere: vi.fn().mockReturnThis(),
        getOne: vi.fn().mockResolvedValue({
          ...mockPlayerSeason,
          workforceHappiness: '60.00',
        }),
      });

      const result = await service.purchaseBoost(playerId, 'salary-raise');

      expect(result.previousHappiness).toBe(60);
      expect(result.newHappiness).toBe(75);
      expect(result.boostApplied).toBe('Salary Raise');
      expect(result.boostAmount).toBe(15);
      expect(result.coinsCost).toBe(200);
    });

    it('should throw BadRequestException for invalid boost slug', async () => {
      await expect(
        service.purchaseBoost(playerId, 'invalid-boost'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw NotFoundException when player season not found', async () => {
      (mockManager.createQueryBuilder as ReturnType<typeof vi.fn>).mockReturnValue({
        setLock: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        andWhere: vi.fn().mockReturnThis(),
        getOne: vi.fn().mockResolvedValue(null),
      });

      await expect(
        service.purchaseBoost(playerId, 'bonus'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('processDailyDecay', () => {
    it('should reduce happiness by 1%', async () => {
      (mockManager.createQueryBuilder as ReturnType<typeof vi.fn>).mockReturnValue({
        setLock: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        andWhere: vi.fn().mockReturnThis(),
        getOne: vi.fn().mockResolvedValue({
          ...mockPlayerSeason,
          workforceHappiness: '80.00',
        }),
        update: vi.fn().mockReturnThis(),
        set: vi.fn().mockReturnThis(),
        execute: vi.fn().mockResolvedValue({ affected: 0 }),
      });
      (mockManager.find as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const result = await service.processDailyDecay(playerId, seasonId);

      expect(result).toBe(79);
      expect(mockManager.save).toHaveBeenCalled();
    });

    it('should not go below 0%', async () => {
      (mockManager.createQueryBuilder as ReturnType<typeof vi.fn>).mockReturnValue({
        setLock: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        andWhere: vi.fn().mockReturnThis(),
        getOne: vi.fn().mockResolvedValue({
          ...mockPlayerSeason,
          workforceHappiness: '0.50',
        }),
        update: vi.fn().mockReturnThis(),
        set: vi.fn().mockReturnThis(),
        execute: vi.fn().mockResolvedValue({ affected: 0 }),
      });
      (mockManager.find as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const result = await service.processDailyDecay(playerId, seasonId);

      expect(result).toBe(0);
    });

    it('should send warning notification when crossing 50% threshold', async () => {
      (mockManager.createQueryBuilder as ReturnType<typeof vi.fn>).mockReturnValue({
        setLock: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        andWhere: vi.fn().mockReturnThis(),
        getOne: vi.fn().mockResolvedValue({
          ...mockPlayerSeason,
          workforceHappiness: '51.00',
        }),
        update: vi.fn().mockReturnThis(),
        set: vi.fn().mockReturnThis(),
        execute: vi.fn().mockResolvedValue({ affected: 0 }),
      });
      (mockManager.find as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const result = await service.processDailyDecay(playerId, seasonId);

      expect(result).toBe(50);
      // Notification should be created
      expect(mockManager.create).toHaveBeenCalledWith(
        Notification,
        expect.objectContaining({
          playerId,
          seasonId,
          type: 'HAPPINESS_WARNING',
          title: 'Workforce Happiness Warning',
          priority: 'HIGH',
        }),
      );
    });

    it('should trigger ON_VACATION when happiness drops to 30% or below', async () => {
      const mockWorkers = [
        {
          id: 'wa-1',
          workerId: 'w-1',
          playerId,
          factoryId: 'f-1',
          seasonId,
          status: WorkerStatus.WORKING,
        },
      ];

      const mockQb = {
        setLock: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        andWhere: vi.fn().mockReturnThis(),
        getOne: vi.fn().mockResolvedValue({
          ...mockPlayerSeason,
          workforceHappiness: '31.00',
        }),
        update: vi.fn().mockReturnThis(),
        set: vi.fn().mockReturnThis(),
        execute: vi.fn().mockResolvedValue({ affected: 1 }),
      };
      (mockManager.createQueryBuilder as ReturnType<typeof vi.fn>).mockReturnValue(mockQb);
      (mockManager.find as ReturnType<typeof vi.fn>).mockResolvedValue(mockWorkers);

      const result = await service.processDailyDecay(playerId, seasonId);

      expect(result).toBe(30);
      // Workers should be set to ON_VACATION
      expect(mockManager.save).toHaveBeenCalledWith(
        WorkerAssignment,
        expect.arrayContaining([
          expect.objectContaining({ status: WorkerStatus.ON_VACATION }),
        ]),
      );
    });

    it('should throw NotFoundException when player season not found', async () => {
      (mockManager.createQueryBuilder as ReturnType<typeof vi.fn>).mockReturnValue({
        setLock: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        andWhere: vi.fn().mockReturnThis(),
        getOne: vi.fn().mockResolvedValue(null),
      });

      await expect(
        service.processDailyDecay(playerId, seasonId),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('triggerVacation', () => {
    it('should set all working workers to ON_VACATION and pause production', async () => {
      const mockWorkers = [
        {
          id: 'wa-1',
          workerId: 'w-1',
          playerId,
          factoryId: 'f-1',
          seasonId,
          status: WorkerStatus.WORKING,
          statusChangedAt: null,
        },
        {
          id: 'wa-2',
          workerId: 'w-2',
          playerId,
          factoryId: 'f-2',
          seasonId,
          status: WorkerStatus.WORKING,
          statusChangedAt: null,
        },
      ];

      const mockQb = {
        setLock: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        andWhere: vi.fn().mockReturnThis(),
        getOne: vi.fn(),
        update: vi.fn().mockReturnThis(),
        set: vi.fn().mockReturnThis(),
        execute: vi.fn().mockResolvedValue({ affected: 2 }),
      };
      (mockManager.createQueryBuilder as ReturnType<typeof vi.fn>).mockReturnValue(mockQb);
      (mockManager.find as ReturnType<typeof vi.fn>).mockResolvedValue(mockWorkers);

      const result = await service.triggerVacation(playerId, seasonId);

      expect(result).toBe(2);
      expect(mockManager.save).toHaveBeenCalledWith(
        WorkerAssignment,
        expect.arrayContaining([
          expect.objectContaining({
            id: 'wa-1',
            status: WorkerStatus.ON_VACATION,
          }),
          expect.objectContaining({
            id: 'wa-2',
            status: WorkerStatus.ON_VACATION,
          }),
        ]),
      );
    });

    it('should return 0 when no working workers exist', async () => {
      (mockManager.find as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const result = await service.triggerVacation(playerId, seasonId);

      expect(result).toBe(0);
    });
  });

  describe('checkDisruptions', () => {
    it('should not affect workers when happiness is at critical threshold', async () => {
      playerSeasonRepo.find!.mockResolvedValue([
        { ...mockPlayerSeason, workforceHappiness: '25.00' },
      ]);

      const results = await service.checkDisruptions(seasonId);

      expect(results).toHaveLength(0);
      // Should not even query for workers
      expect(workerAssignmentRepo.find).not.toHaveBeenCalled();
    });

    it('should roll disruptions for workers based on effective commitment', async () => {
      playerSeasonRepo.find!.mockResolvedValue([
        { ...mockPlayerSeason, playerId, workforceHappiness: '80.00' },
      ]);

      // Mock Math.random to force a disruption
      const mockRandom = vi.spyOn(Math, 'random');
      mockRandom.mockReturnValue(0.001); // Very low roll = disruption triggered

      const mockAssignment = {
        id: 'wa-1',
        workerId: 'w-1',
        playerId,
        factoryId: 'f-1',
        seasonId,
        status: WorkerStatus.WORKING,
        statusChangedAt: null,
        disruptionEndsAt: null,
        workerProfile: {
          id: 'w-1',
          commitmentLevel: '70.00', // Low commitment = higher disruption chance
        },
      };

      workerAssignmentRepo.find!.mockResolvedValue([mockAssignment]);

      const results = await service.checkDisruptions(seasonId);

      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].playerId).toBe(playerId);
      expect(results[0].workersAffected).toBe(1);
      expect([WorkerStatus.ABSENT, WorkerStatus.SICK]).toContain(results[0].disruptionType);

      mockRandom.mockRestore();
    });

    it('should not disrupt workers with high commitment and high happiness', async () => {
      playerSeasonRepo.find!.mockResolvedValue([
        { ...mockPlayerSeason, playerId, workforceHappiness: '100.00' },
      ]);

      // Math.random returns a value too high to trigger disruption
      const mockRandom = vi.spyOn(Math, 'random');
      mockRandom.mockReturnValue(0.99);

      const mockAssignment = {
        id: 'wa-1',
        workerId: 'w-1',
        playerId,
        factoryId: 'f-1',
        seasonId,
        status: WorkerStatus.WORKING,
        workerProfile: {
          id: 'w-1',
          commitmentLevel: '100.00', // Max commitment
        },
      };

      workerAssignmentRepo.find!.mockResolvedValue([mockAssignment]);

      const results = await service.checkDisruptions(seasonId);

      expect(results).toHaveLength(0);

      mockRandom.mockRestore();
    });
  });

  describe('resolveExpiredDisruptions', () => {
    it('should restore expired disruptions to WORKING status', async () => {
      const expiredAssignments = [
        {
          id: 'wa-1',
          workerId: 'w-1',
          playerId,
          factoryId: 'f-1',
          seasonId,
          status: WorkerStatus.ABSENT,
          disruptionEndsAt: new Date('2024-01-01'),
        },
        {
          id: 'wa-2',
          workerId: 'w-2',
          playerId,
          factoryId: 'f-2',
          seasonId,
          status: WorkerStatus.SICK,
          disruptionEndsAt: new Date('2024-01-01'),
        },
      ];

      const mockQb = {
        where: vi.fn().mockReturnThis(),
        andWhere: vi.fn().mockReturnThis(),
        getMany: vi.fn().mockResolvedValue(expiredAssignments),
      };
      workerAssignmentRepo.createQueryBuilder!.mockReturnValue(mockQb);

      const result = await service.resolveExpiredDisruptions(seasonId);

      expect(result).toBe(2);
      expect(workerAssignmentRepo.save).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'wa-1',
            status: WorkerStatus.WORKING,
            disruptionEndsAt: null,
          }),
          expect.objectContaining({
            id: 'wa-2',
            status: WorkerStatus.WORKING,
            disruptionEndsAt: null,
          }),
        ]),
      );
    });

    it('should return 0 when no expired disruptions', async () => {
      const mockQb = {
        where: vi.fn().mockReturnThis(),
        andWhere: vi.fn().mockReturnThis(),
        getMany: vi.fn().mockResolvedValue([]),
      };
      workerAssignmentRepo.createQueryBuilder!.mockReturnValue(mockQb);

      const result = await service.resolveExpiredDisruptions(seasonId);

      expect(result).toBe(0);
    });
  });

  describe('loadBoostDefinitions', () => {
    it('should override default boosts with custom definitions', () => {
      const customBoosts = [
        { slug: 'mega-boost', name: 'Mega Boost', cost: 500, happinessIncrease: 25 },
      ];

      service.loadBoostDefinitions(customBoosts);
      const boosts = service.getAvailableBoosts();

      expect(boosts).toHaveLength(1);
      expect(boosts[0].slug).toBe('mega-boost');
      expect(boosts[0].cost).toBe(500);
      expect(boosts[0].happinessIncrease).toBe(25);
    });
  });
});
