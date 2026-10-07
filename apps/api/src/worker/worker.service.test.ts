import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WorkerService } from './worker.service';
import {
  CommodityCategory,
  SeasonStatus,
  TransactionType,
  WorkerStatus,
} from '@sea-commodity-tycoon/shared-types';
import { DataSource, Repository, EntityManager } from 'typeorm';
import { WorkerProfile } from '../entities/worker-profile.entity';
import { WorkerAssignment } from '../entities/worker-assignment.entity';
import { Factory } from '../entities/factory.entity';
import { Season } from '../entities/season.entity';
import { PlayerSeason } from '../entities/player-season.entity';
import { WalletService } from '../wallet/wallet.service';

describe('WorkerService', () => {
  let workerService: WorkerService;
  let mockWorkerProfileRepo: Partial<Repository<WorkerProfile>>;
  let mockWorkerAssignmentRepo: Partial<Repository<WorkerAssignment>>;
  let mockFactoryRepo: Partial<Repository<Factory>>;
  let mockSeasonRepo: Partial<Repository<Season>>;
  let mockPlayerSeasonRepo: Partial<Repository<PlayerSeason>>;
  let mockDataSource: Partial<DataSource>;
  let mockWalletService: Partial<WalletService>;

  const playerId = '11111111-1111-1111-1111-111111111111';
  const seasonId = '22222222-2222-2222-2222-222222222222';
  const factoryId = '33333333-3333-3333-3333-333333333333';
  const workerId = '44444444-4444-4444-4444-444444444444';
  const assignmentId = '55555555-5555-5555-5555-555555555555';

  const activeSeason: Partial<Season> = {
    id: seasonId,
    status: SeasonStatus.ACTIVE,
    startsAt: new Date('2024-01-01'),
    endsAt: new Date('2024-01-31'),
    mapSeed: '12345',
  };

  const sampleWorker: Partial<WorkerProfile> = {
    id: workerId,
    name: 'Ahmad Wijaya',
    age: 25,
    gender: 'male',
    specialty: 'farmer',
    salary: '8.00',
    experienceLevel: 3,
    commitmentLevel: '85.00',
    seasonId,
    unlocked: true,
  };

  const sampleFactory: Partial<Factory> = {
    id: factoryId,
    playerId,
    seasonId,
    category: CommodityCategory.AGRICULTURE,
  };

  const sampleAssignment: Partial<WorkerAssignment> = {
    id: assignmentId,
    workerId,
    playerId,
    factoryId,
    seasonId,
    status: WorkerStatus.WORKING,
    hiredAt: new Date(),
    workerProfile: sampleWorker as WorkerProfile,
  };

  beforeEach(() => {
    mockWorkerProfileRepo = {
      findOneBy: vi.fn().mockResolvedValue(sampleWorker),
      count: vi.fn().mockResolvedValue(0),
      createQueryBuilder: vi.fn().mockReturnValue({
        insert: vi.fn().mockReturnThis(),
        into: vi.fn().mockReturnThis(),
        values: vi.fn().mockReturnThis(),
        execute: vi.fn().mockResolvedValue({ identifiers: [] }),
        where: vi.fn().mockReturnThis(),
        andWhere: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        addOrderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        offset: vi.fn().mockReturnThis(),
        getMany: vi.fn().mockResolvedValue([sampleWorker]),
        update: vi.fn().mockReturnThis(),
        set: vi.fn().mockReturnThis(),
        whereInIds: vi.fn().mockReturnThis(),
      }),
    };

    mockWorkerAssignmentRepo = {
      findOneBy: vi.fn().mockResolvedValue(null),
      findOne: vi.fn().mockResolvedValue(sampleAssignment),
      find: vi.fn().mockResolvedValue([sampleAssignment]),
      count: vi.fn().mockResolvedValue(0),
      create: vi.fn().mockImplementation((data) => ({
        id: assignmentId,
        ...data,
      })),
      save: vi.fn().mockImplementation((data) => ({
        id: assignmentId,
        ...data,
      })),
    };

    mockFactoryRepo = {
      findOneBy: vi.fn().mockResolvedValue(sampleFactory),
    };

    mockSeasonRepo = {
      findOne: vi.fn().mockResolvedValue(activeSeason),
      findOneBy: vi.fn().mockResolvedValue(activeSeason),
    };

    mockPlayerSeasonRepo = {};

    mockWalletService = {
      executeTransactionWithManager: vi.fn().mockResolvedValue({
        transactionId: 'tx-1',
        balanceAfter: 992,
        amount: -8,
      }),
    };

    mockDataSource = {
      transaction: vi.fn().mockImplementation(async (cb: (manager: EntityManager) => Promise<unknown>) => {
        const mockManager = {
          findOneBy: vi.fn().mockResolvedValue({
            playerId,
            seasonId,
            workforceHappiness: '80.00',
          }),
          save: vi.fn().mockImplementation((_entity, data) => data),
          remove: vi.fn().mockResolvedValue(undefined),
          count: vi.fn().mockResolvedValue(0),
          createQueryBuilder: vi.fn().mockReturnValue({
            update: vi.fn().mockReturnThis(),
            set: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            execute: vi.fn().mockResolvedValue({}),
          }),
        } as unknown as EntityManager;
        return cb(mockManager);
      }),
    };

    workerService = new WorkerService(
      mockWorkerProfileRepo as Repository<WorkerProfile>,
      mockWorkerAssignmentRepo as Repository<WorkerAssignment>,
      mockFactoryRepo as Repository<Factory>,
      mockSeasonRepo as Repository<Season>,
      mockPlayerSeasonRepo as Repository<PlayerSeason>,
      mockDataSource as DataSource,
      mockWalletService as WalletService,
      { startProduction: vi.fn().mockResolvedValue({}) } as any,
    );
  });

  describe('hire', () => {
    it('should hire a worker and assign to factory', async () => {
      const result = await workerService.hire(playerId, workerId, factoryId);

      expect(result.workerId).toBe(workerId);
      expect(result.playerId).toBe(playerId);
      expect(result.factoryId).toBe(factoryId);
      expect(result.status).toBe(WorkerStatus.WORKING);
      expect(mockWorkerAssignmentRepo.save).toHaveBeenCalled();
    });

    it('should reject hiring a locked worker', async () => {
      (mockWorkerProfileRepo.findOneBy as ReturnType<typeof vi.fn>).mockResolvedValue({
        ...sampleWorker,
        unlocked: false,
      });

      await expect(workerService.hire(playerId, workerId, factoryId)).rejects.toThrow(
        'Worker is not yet available for hire',
      );
    });

    it('should reject if worker is already assigned', async () => {
      (mockWorkerAssignmentRepo.findOneBy as ReturnType<typeof vi.fn>).mockResolvedValue(
        sampleAssignment,
      );

      await expect(workerService.hire(playerId, workerId, factoryId)).rejects.toThrow(
        'Worker is already assigned to a player',
      );
    });

    it('should reject if factory is not found', async () => {
      (mockFactoryRepo.findOneBy as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      await expect(workerService.hire(playerId, workerId, factoryId)).rejects.toThrow(
        'not found or does not belong to player',
      );
    });

    it('should reject if factory already has max workers', async () => {
      (mockWorkerAssignmentRepo.count as ReturnType<typeof vi.fn>).mockResolvedValue(2);

      await expect(workerService.hire(playerId, workerId, factoryId)).rejects.toThrow(
        'maximum of 2 workers',
      );
    });

    it('should reject if worker not found', async () => {
      (mockWorkerProfileRepo.findOneBy as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      await expect(workerService.hire(playerId, workerId, factoryId)).rejects.toThrow(
        `Worker ${workerId} not found`,
      );
    });
  });

  describe('fire', () => {
    it('should fire a worker, settle salary, and reduce happiness', async () => {
      await workerService.fire(playerId, workerId);

      expect(mockDataSource.transaction).toHaveBeenCalled();
      // The wallet service should have been called with the firing settlement
      const txCallback = (mockDataSource.transaction as ReturnType<typeof vi.fn>).mock.calls[0][0];
      const mockManager = {
        findOneBy: vi.fn().mockResolvedValue({
          playerId,
          seasonId,
          workforceHappiness: '80.00',
        }),
        save: vi.fn().mockImplementation((_entity, data) => data),
        remove: vi.fn().mockResolvedValue(undefined),
        count: vi.fn().mockResolvedValue(0),
        createQueryBuilder: vi.fn().mockReturnValue({
          update: vi.fn().mockReturnThis(),
          set: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          execute: vi.fn().mockResolvedValue({}),
        }),
      } as unknown as EntityManager;

      await txCallback(mockManager);

      expect(mockWalletService.executeTransactionWithManager).toHaveBeenCalledWith(
        mockManager,
        playerId,
        seasonId,
        TransactionType.WORKER_FIRING_SETTLEMENT,
        -8, // salary is 8.00
        expect.objectContaining({
          referenceType: 'worker',
          referenceId: workerId,
        }),
      );
    });

    it('should throw if worker assignment not found', async () => {
      (mockWorkerAssignmentRepo.findOne as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      await expect(workerService.fire(playerId, workerId)).rejects.toThrow(
        'Worker assignment not found',
      );
    });
  });

  describe('reassign', () => {
    it('should reassign a worker to a new factory', async () => {
      const newFactoryId = '66666666-6666-6666-6666-666666666666';
      (mockWorkerAssignmentRepo.findOneBy as ReturnType<typeof vi.fn>).mockResolvedValue(sampleAssignment);
      (mockFactoryRepo.findOneBy as ReturnType<typeof vi.fn>).mockResolvedValue({
        ...sampleFactory,
        id: newFactoryId,
      });
      (mockWorkerAssignmentRepo.count as ReturnType<typeof vi.fn>).mockResolvedValue(0);

      const result = await workerService.reassign(playerId, workerId, newFactoryId);

      expect(result.factoryId).toBe(newFactoryId);
      expect(result.status).toBe(WorkerStatus.WORKING);
      expect(mockWorkerAssignmentRepo.save).toHaveBeenCalled();
    });

    it('should reject reassignment to the same factory', async () => {
      const assignmentWithFactory = {
        ...sampleAssignment,
        factoryId: factoryId,
      };
      (mockWorkerAssignmentRepo.findOneBy as ReturnType<typeof vi.fn>).mockResolvedValue(assignmentWithFactory);

      await expect(workerService.reassign(playerId, workerId, factoryId)).rejects.toThrow(
        'already assigned to this factory',
      );
    });

    it('should reject if target factory is full', async () => {
      const newFactoryId = '66666666-6666-6666-6666-666666666666';
      const assignmentAtDifferentFactory = {
        ...sampleAssignment,
        factoryId: '77777777-7777-7777-7777-777777777777', // currently at a different factory
      };
      (mockWorkerAssignmentRepo.findOneBy as ReturnType<typeof vi.fn>).mockResolvedValue(assignmentAtDifferentFactory);
      (mockFactoryRepo.findOneBy as ReturnType<typeof vi.fn>).mockResolvedValue({
        ...sampleFactory,
        id: newFactoryId,
      });
      (mockWorkerAssignmentRepo.count as ReturnType<typeof vi.fn>).mockResolvedValue(2);

      await expect(workerService.reassign(playerId, workerId, newFactoryId)).rejects.toThrow(
        'maximum of 2 workers',
      );
    });

    it('should reject if worker assignment not found', async () => {
      (mockWorkerAssignmentRepo.findOneBy as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      await expect(workerService.reassign(playerId, workerId, factoryId)).rejects.toThrow(
        'Worker assignment not found',
      );
    });
  });

  describe('getPlayerWorkers', () => {
    it('should return all workers assigned to the player', async () => {
      const result = await workerService.getPlayerWorkers(playerId);

      expect(result).toEqual([sampleAssignment]);
      expect(mockWorkerAssignmentRepo.find).toHaveBeenCalledWith({
        where: { playerId, seasonId },
        relations: ['workerProfile', 'factory'],
        order: { hiredAt: 'ASC' },
      });
    });
  });

  describe('generateWorkerPool', () => {
    it('should generate 2000 workers for a season', async () => {
      const mockInsertQB = {
        insert: vi.fn().mockReturnThis(),
        into: vi.fn().mockReturnThis(),
        values: vi.fn().mockReturnThis(),
        execute: vi.fn().mockResolvedValue({ identifiers: [] }),
      };
      (mockWorkerProfileRepo.createQueryBuilder as ReturnType<typeof vi.fn>).mockReturnValue(mockInsertQB);

      const count = await workerService.generateWorkerPool(seasonId);

      expect(count).toBe(2000);
      expect(mockInsertQB.values).toHaveBeenCalled();
      const workers = mockInsertQB.values.mock.calls[0][0];
      expect(workers).toHaveLength(2000);
    });

    it('should skip generation if pool already exists', async () => {
      (mockWorkerProfileRepo.count as ReturnType<typeof vi.fn>).mockResolvedValue(2000);

      const count = await workerService.generateWorkerPool(seasonId);

      expect(count).toBe(2000);
    });

    it('should generate deterministic workers from season seed', async () => {
      const mockInsertQB = {
        insert: vi.fn().mockReturnThis(),
        into: vi.fn().mockReturnThis(),
        values: vi.fn().mockReturnThis(),
        execute: vi.fn().mockResolvedValue({ identifiers: [] }),
      };
      (mockWorkerProfileRepo.createQueryBuilder as ReturnType<typeof vi.fn>).mockReturnValue(mockInsertQB);

      await workerService.generateWorkerPool(seasonId);
      const workers1 = mockInsertQB.values.mock.calls[0][0];

      // Reset and regenerate
      mockInsertQB.values.mockClear();
      (mockWorkerProfileRepo.count as ReturnType<typeof vi.fn>).mockResolvedValue(0);
      await workerService.generateWorkerPool(seasonId);
      const workers2 = mockInsertQB.values.mock.calls[0][0];

      // Same seed should produce same workers
      expect(workers1[0].name).toBe(workers2[0].name);
      expect(workers1[0].salary).toBe(workers2[0].salary);
    });

    it('should initially unlock 200 workers', async () => {
      const mockInsertQB = {
        insert: vi.fn().mockReturnThis(),
        into: vi.fn().mockReturnThis(),
        values: vi.fn().mockReturnThis(),
        execute: vi.fn().mockResolvedValue({ identifiers: [] }),
      };
      (mockWorkerProfileRepo.createQueryBuilder as ReturnType<typeof vi.fn>).mockReturnValue(mockInsertQB);

      await workerService.generateWorkerPool(seasonId);
      const workers = mockInsertQB.values.mock.calls[0][0];

      const unlocked = workers.filter((w: any) => w.unlocked === true);
      const locked = workers.filter((w: any) => w.unlocked === false);

      expect(unlocked.length).toBe(200);
      expect(locked.length).toBe(1800);
    });

    it('should generate workers with valid attribute ranges', async () => {
      const mockInsertQB = {
        insert: vi.fn().mockReturnThis(),
        into: vi.fn().mockReturnThis(),
        values: vi.fn().mockReturnThis(),
        execute: vi.fn().mockResolvedValue({ identifiers: [] }),
      };
      (mockWorkerProfileRepo.createQueryBuilder as ReturnType<typeof vi.fn>).mockReturnValue(mockInsertQB);

      await workerService.generateWorkerPool(seasonId);
      const workers = mockInsertQB.values.mock.calls[0][0];

      for (const worker of workers) {
        expect(worker.age).toBeGreaterThanOrEqual(18);
        expect(worker.age).toBeLessThanOrEqual(49);
        expect(parseFloat(worker.salary)).toBeGreaterThanOrEqual(3);
        expect(parseFloat(worker.salary)).toBeLessThanOrEqual(12);
        expect(worker.experienceLevel).toBeGreaterThanOrEqual(1);
        expect(worker.experienceLevel).toBeLessThanOrEqual(5);
        expect(parseFloat(worker.commitmentLevel)).toBeGreaterThanOrEqual(50);
        expect(parseFloat(worker.commitmentLevel)).toBeLessThanOrEqual(100);
        expect(['male', 'female']).toContain(worker.gender);
        expect(['farmer', 'miner', 'fisherman', 'driller', 'rancher', 'lumberjack', 'shopkeeper', 'engineer', 'technician']).toContain(worker.specialty);
      }
    });
  });

  describe('getFactoryWorkerCount', () => {
    it('should return the count of workers at a factory', async () => {
      (mockWorkerAssignmentRepo.count as ReturnType<typeof vi.fn>).mockResolvedValue(1);

      const count = await workerService.getFactoryWorkerCount(factoryId, seasonId);

      expect(count).toBe(1);
      expect(mockWorkerAssignmentRepo.count).toHaveBeenCalledWith({
        where: { factoryId, seasonId },
      });
    });
  });
});
