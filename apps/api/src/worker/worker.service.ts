import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import {
  FactoryStatus,
  SeasonStatus,
  TransactionType,
  WorkerStatus,
} from '@sea-commodity-tycoon/shared-types';
import { WorkerProfile } from '../entities/worker-profile.entity';
import { WorkerAssignment } from '../entities/worker-assignment.entity';
import { Factory } from '../entities/factory.entity';
import { Season } from '../entities/season.entity';
import { PlayerSeason } from '../entities/player-season.entity';
import { WalletService } from '../wallet/wallet.service';
import { ProductionService } from '../production/production.service';

/** Maximum number of workers that can be assigned to a single factory */
const MAX_WORKERS_PER_FACTORY = 2;

/** Total workers to generate per season */
const WORKER_POOL_SIZE = 2000;

/** How many workers are initially unlocked at season start */
const INITIAL_UNLOCKED_COUNT = 200;

/** Worker name pools for random generation (Southeast Asian mix: Indonesian, Malay, Indian, Chinese) */
const FIRST_NAMES_MALE = [
  // Indonesian
  'Ahmad', 'Budi', 'Dimas', 'Eko', 'Fajar', 'Gilang', 'Hadi',
  'Irfan', 'Joko', 'Lukman', 'Naufal', 'Rizky', 'Surya', 'Taufik', 'Wahyu',
  // Malay
  'Hafiz', 'Azlan', 'Syafiq', 'Aiman', 'Danial', 'Farhan', 'Ismail', 'Nazri',
  // Indian (Malaysian)
  'Rajesh', 'Kumar', 'Arjun', 'Vikram', 'Sanjay', 'Ravi', 'Deepak', 'Arun',
  // Chinese (Malaysian)
  'Wei Jie', 'Jun Kai', 'Zhi Hao', 'Ming', 'Cheng', 'Hao', 'Liang', 'Jian',
];

const FIRST_NAMES_FEMALE = [
  // Indonesian
  'Ayu', 'Bunga', 'Citra', 'Dewi', 'Fitri', 'Indah', 'Maya', 'Putri',
  'Sari', 'Tika', 'Zahra', 'Anisa', 'Bella', 'Laila', 'Rani',
  // Malay
  'Aisyah', 'Nurul', 'Farah', 'Aminah', 'Siti', 'Hanis', 'Izzah', 'Nadia',
  // Indian (Malaysian)
  'Priya', 'Lakshmi', 'Ananya', 'Divya', 'Kavitha', 'Meena', 'Nisha', 'Shalini',
  // Chinese (Malaysian)
  'Mei Ling', 'Xin Yi', 'Hui Min', 'Jia Ying', 'Li Wen', 'Shu Ting', 'Yan', 'Xiao',
];

const LAST_NAMES = [
  // Indonesian
  'Wijaya', 'Santoso', 'Pratama', 'Putra', 'Hidayat', 'Susanto', 'Nugroho',
  'Wibowo', 'Kurniawan', 'Setiawan', 'Gunawan', 'Hartono', 'Prabowo',
  // Malay
  'Abdullah', 'Ibrahim', 'Hassan', 'Othman', 'Yusof', 'Rahman', 'Mohamad',
  'Iskandar', 'Bakar', 'Ali', 'Zainal', 'Hamid',
  // Indian
  'Pillai', 'Nair', 'Krishnan', 'Subramaniam', 'Muthu', 'Chandra', 'Rajan',
  // Chinese
  'Tan', 'Lim', 'Wong', 'Lee', 'Ng', 'Ong', 'Chong', 'Koh', 'Chan', 'Goh',
];

const SPECIALTIES = [
  'farmer',       // Good for all Agriculture (rice, palm-fruit, cocoa, coffee)
  'miner',        // Good for all Metals (iron-ore, nickel-ore)
  'fisherman',    // Good for Fishery (fish)
  'driller',      // Good for all Energy (crude-oil, natural-gas)
  'rancher',      // Good for all Livestock (poultry, cattle)
  'lumberjack',   // Good for all Forestry (timber, rubber)
  'shopkeeper',   // Good for all Shop types
  'engineer',     // Good for all L1 processing factories
  'technician',   // Good for all L2 assembly factories
];

/**
 * Simple seeded PRNG (mulberry32) for deterministic worker pool generation.
 */
function createSeededRng(seed: number): () => number {
  let state = seed | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface WorkerFilters {
  specialty?: string;
  minExperience?: number;
  maxSalary?: number;
  limit?: number;
  offset?: number;
}

@Injectable()
export class WorkerService {
  private readonly logger = new Logger(WorkerService.name);

  constructor(
    @InjectRepository(WorkerProfile)
    private readonly workerProfileRepository: Repository<WorkerProfile>,
    @InjectRepository(WorkerAssignment)
    private readonly workerAssignmentRepository: Repository<WorkerAssignment>,
    @InjectRepository(Factory)
    private readonly factoryRepository: Repository<Factory>,
    @InjectRepository(Season)
    private readonly seasonRepository: Repository<Season>,
    @InjectRepository(PlayerSeason)
    private readonly playerSeasonRepository: Repository<PlayerSeason>,
    private readonly dataSource: DataSource,
    private readonly walletService: WalletService,
    @Inject(forwardRef(() => ProductionService))
    private readonly productionService: ProductionService,
  ) {}

  /**
   * Generate the full worker pool for a season.
   * Uses the season's map_seed for deterministic generation.
   */
  async generateWorkerPool(seasonId: string): Promise<number> {
    const season = await this.seasonRepository.findOneBy({ id: seasonId });
    if (!season) {
      throw new NotFoundException(`Season ${seasonId} not found`);
    }

    // Check if pool already exists for this season
    const existingCount = await this.workerProfileRepository.count({
      where: { seasonId },
    });
    if (existingCount > 0) {
      this.logger.warn(`Worker pool already exists for season ${seasonId} (${existingCount} workers)`);
      return existingCount;
    }

    const seed = parseInt(season.mapSeed, 10) || Date.now();
    const rng = createSeededRng(seed);

    // Load salary config from admin settings
    let salaryConfig: any[] | null = null;
    try {
      const configRow = await this.dataSource.query(
        `SELECT value FROM game_config WHERE key = 'salary_config'`,
      );
      if (configRow.length > 0 && configRow[0].value?.specialties) {
        salaryConfig = configRow[0].value.specialties;
      }
    } catch { /* use fallback formula */ }

    const workers: Partial<WorkerProfile>[] = [];

    for (let i = 0; i < WORKER_POOL_SIZE; i++) {
      const gender = rng() < 0.5 ? 'male' : 'female';
      const firstNames = gender === 'male' ? FIRST_NAMES_MALE : FIRST_NAMES_FEMALE;
      const firstName = firstNames[Math.floor(rng() * firstNames.length)];
      const lastName = LAST_NAMES[Math.floor(rng() * LAST_NAMES.length)];

      const age = 18 + Math.floor(rng() * 32); // 18-49
      const specialty = SPECIALTIES[Math.floor(rng() * SPECIALTIES.length)];
      // Experience weighted: more junior workers (40% exp 1-2, 35% exp 3, 25% exp 4-5)
      const expRoll = rng();
      const experienceLevel = expRoll < 0.20 ? 1 : expRoll < 0.40 ? 2 : expRoll < 0.65 ? 3 : expRoll < 0.85 ? 4 : 5;
      // Salary from admin config or fallback formula
      const configEntry = salaryConfig?.find((s: any) => s.key === specialty);
      const salary = configEntry?.baseSalary?.[experienceLevel - 1]
        ?? Math.max(3, Math.round(Math.round(experienceLevel * 7.5) * (specialty === 'technician' ? 1.75 : specialty === 'engineer' ? 1.5 : 1.0)));
      const commitmentLevel = 50 + Math.floor(rng() * 51); // 50-100

      // Initially unlock a batch of workers
      const unlocked = i < INITIAL_UNLOCKED_COUNT;

      workers.push({
        name: `${firstName} ${lastName}`,
        age,
        gender,
        specialty,
        salary: salary.toFixed(2),
        experienceLevel,
        commitmentLevel: commitmentLevel.toFixed(2),
        seasonId,
        unlocked,
      });
    }

    // Batch insert for performance
    await this.workerProfileRepository
      .createQueryBuilder()
      .insert()
      .into(WorkerProfile)
      .values(workers as any)
      .execute();

    this.logger.log(`Generated ${WORKER_POOL_SIZE} workers for season ${seasonId} (${INITIAL_UNLOCKED_COUNT} initially unlocked)`);
    return WORKER_POOL_SIZE;
  }

  /**
   * Unlock additional workers. Called as game progresses (players join, commodities produced).
   * For MVP: unlocks a batch of workers by count.
   */
  async unlockWorkers(seasonId: string, count: number): Promise<number> {
    const lockedWorkers = await this.workerProfileRepository
      .createQueryBuilder('wp')
      .where('wp.season_id = :seasonId', { seasonId })
      .andWhere('wp.unlocked = false')
      .orderBy('wp.id', 'ASC')
      .limit(count)
      .getMany();

    if (lockedWorkers.length === 0) {
      return 0;
    }

    const ids = lockedWorkers.map((w) => w.id);
    await this.workerProfileRepository
      .createQueryBuilder()
      .update(WorkerProfile)
      .set({ unlocked: true })
      .whereInIds(ids)
      .execute();

    this.logger.log(`Unlocked ${ids.length} workers for season ${seasonId}`);
    return ids.length;
  }

  /**
   * Get available workers (unlocked and not currently assigned).
   */
  async getAvailableWorkers(seasonId: string, filters?: WorkerFilters): Promise<WorkerProfile[]> {
    const qb = this.workerProfileRepository
      .createQueryBuilder('wp')
      .where('wp.season_id = :seasonId', { seasonId })
      .andWhere('wp.unlocked = true');

    // Exclude workers that have an active assignment
    qb.andWhere((subQb) => {
      const subQuery = subQb
        .subQuery()
        .select('wa.worker_id')
        .from(WorkerAssignment, 'wa')
        .where('wa.season_id = :seasonId')
        .getQuery();
      return `wp.id NOT IN ${subQuery}`;
    });

    if (filters?.specialty) {
      qb.andWhere('wp.specialty = :specialty', { specialty: filters.specialty });
    }

    if (filters?.minExperience) {
      qb.andWhere('wp.experience_level >= :minExp', { minExp: filters.minExperience });
    }

    if (filters?.maxSalary) {
      qb.andWhere('CAST(wp.salary AS DECIMAL) <= :maxSalary', { maxSalary: filters.maxSalary });
    }

    qb.orderBy('wp.experience_level', 'DESC')
      .addOrderBy('wp.salary', 'ASC');

    if (filters?.limit) {
      qb.limit(filters.limit);
    } else {
      qb.limit(50); // Default page size
    }

    if (filters?.offset) {
      qb.offset(filters.offset);
    }

    return qb.getMany();
  }

  /**
   * Hire a worker and optionally assign them to a factory.
   * Validates: worker is unlocked, not already assigned. If factoryId provided, validates factory.
   */
  async hire(playerId: string, workerId: string, factoryId?: string): Promise<WorkerAssignment> {
    const seasonId = await this.getActiveSeasonId();

    // Validate worker exists, is unlocked, and not assigned
    const worker = await this.workerProfileRepository.findOneBy({
      id: workerId,
      seasonId,
    });

    if (!worker) {
      throw new NotFoundException(`Worker ${workerId} not found`);
    }

    if (!worker.unlocked) {
      throw new BadRequestException('Worker is not yet available for hire');
    }

    const existingAssignment = await this.workerAssignmentRepository.findOneBy({
      workerId,
      seasonId,
    });

    if (existingAssignment) {
      throw new BadRequestException('Worker is already assigned to a player');
    }

    let factory: any = null;

    if (factoryId) {
      // Validate factory exists and belongs to player
      factory = await this.factoryRepository.findOneBy({
        id: factoryId,
        playerId,
        seasonId,
      });

      if (!factory) {
        throw new NotFoundException(`Factory ${factoryId} not found or does not belong to player`);
      }

      // Validate factory has fewer than max workers
      const currentWorkerCount = await this.workerAssignmentRepository.count({
        where: { factoryId, seasonId },
      });

      if (currentWorkerCount >= MAX_WORKERS_PER_FACTORY) {
        throw new BadRequestException(
          `Factory already has the maximum of ${MAX_WORKERS_PER_FACTORY} workers assigned`,
        );
      }
    }

    // Create the assignment
    const assignment = this.workerAssignmentRepository.create({
      workerId,
      playerId,
      factoryId: factoryId ?? null,
      seasonId,
      status: factoryId ? WorkerStatus.WORKING : WorkerStatus.UNASSIGNED,
      hiredAt: new Date(),
    });

    const saved = await this.workerAssignmentRepository.save(assignment);

    // Auto-set factory to PRODUCING and start production if it was IDLE
    if (factory && factory.status === FactoryStatus.IDLE) {
      // Start production first (it handles setting status to PRODUCING internally)
      try {
        await this.productionService.startProduction(playerId, { factoryId: factoryId! });
        this.logger.log(`Auto-started production for factory ${factoryId}`);
      } catch (err) {
        // Production may fail if no commodity assigned, exclusive output not set, etc.
        // Fall back to just setting PRODUCING status
        factory.status = FactoryStatus.PRODUCING;
        await this.factoryRepository.save(factory);
        this.logger.warn(`Auto-start production failed for factory ${factoryId}: ${(err as Error).message}. Factory set to PRODUCING.`);
      }
    }

    this.logger.log(`Worker ${workerId} hired by player ${playerId} at factory ${factoryId}`);

    // Recalibrate existing production if factory already has an active job
    if (factoryId && factory && factory.status === FactoryStatus.PRODUCING) {
      await this.recalibrateProduction(playerId, factoryId);
    }

    return saved;
  }

  /**
   * Fire a worker. Settles final salary, returns worker to pool, reduces happiness by 5%.
   */
  async fire(playerId: string, workerId: string): Promise<void> {
    const seasonId = await this.getActiveSeasonId();

    const assignment = await this.workerAssignmentRepository.findOne({
      where: { workerId, playerId, seasonId },
      relations: ['workerProfile'],
    });

    if (!assignment) {
      throw new NotFoundException('Worker assignment not found for this player');
    }

    const worker = assignment.workerProfile;
    const salary = parseFloat(worker.salary);

    // Execute firing within a transaction
    await this.dataSource.transaction(async (manager) => {
      // 1. Settle final salary (deduct one day's salary as settlement)
      await this.walletService.executeTransactionWithManager(
        manager,
        playerId,
        seasonId,
        TransactionType.WORKER_FIRING_SETTLEMENT,
        -salary,
        {
          referenceType: 'worker',
          referenceId: workerId,
          description: `Firing settlement for worker ${worker.name}`,
        },
      );

      // 2. Remove the assignment (returns worker to pool)
      await manager.remove(WorkerAssignment, assignment);

      // 3. Reduce workforce happiness by 5%
      const playerSeason = await manager.findOneBy(PlayerSeason, {
        playerId,
        seasonId,
      });

      if (playerSeason) {
        const currentHappiness = parseFloat(playerSeason.workforceHappiness);
        const newHappiness = Math.max(0, currentHappiness - 5);
        playerSeason.workforceHappiness = newHappiness.toFixed(2);
        await manager.save(PlayerSeason, playerSeason);
      }
    });

    this.logger.log(`Worker ${workerId} fired by player ${playerId}, happiness reduced by 5%`);

    // Recalibrate production for the affected factory
    if (assignment.factoryId) {
      await this.recalibrateProduction(playerId, assignment.factoryId);
    }
  }

  /**
   * Unassign a worker from their factory. Worker stays hired but becomes UNASSIGNED.
   */
  async unassign(playerId: string, workerId: string): Promise<void> {
    const seasonId = await this.getActiveSeasonId();

    const assignment = await this.workerAssignmentRepository.findOne({
      where: { workerId, playerId, seasonId },
    });

    if (!assignment) {
      throw new NotFoundException('Worker assignment not found for this player');
    }

    const previousFactoryId = assignment.factoryId;

    // Set worker to UNASSIGNED with no factory
    assignment.factoryId = null as any;
    assignment.status = WorkerStatus.UNASSIGNED;
    await this.workerAssignmentRepository.save(assignment);

    // If no workers remain on the factory, set it to IDLE
    if (previousFactoryId) {
      const remainingWorkers = await this.workerAssignmentRepository.count({
        where: { factoryId: previousFactoryId, seasonId },
      });
      if (remainingWorkers === 0) {
        await this.factoryRepository.update(previousFactoryId, { status: FactoryStatus.IDLE });
      }
    }

    this.logger.log(`Worker ${workerId} unassigned from factory by player ${playerId}`);

    // Recalibrate production for the affected factory
    if (previousFactoryId) {
      await this.recalibrateProduction(playerId, previousFactoryId);
    }
  }

  /**
   * Recalibrate an active production job for a factory based on current worker state.
   * Called when workers are hired/fired/unassigned/reassigned or status changes.
   *
   * - If no WORKING workers: pause the job and set factory to IDLE
   * - If workers changed: recalculate finalYield and incrementInterval, update the job
   */
  async recalibrateProduction(playerId: string, factoryId: string): Promise<void> {
    const seasonId = await this.getActiveSeasonId();

    // Find active production job for this factory
    const activeJob = await this.dataSource.query(
      `SELECT id, commodity_id, base_yield, final_yield, units_produced, increment_interval_minutes
       FROM production_jobs WHERE factory_id = $1 AND status = 'ACTIVE' LIMIT 1`,
      [factoryId],
    );

    if (activeJob.length === 0) return; // No active job to recalibrate

    const job = activeJob[0];

    // Get current WORKING workers for this factory
    const workers = await this.workerAssignmentRepository.find({
      where: { factoryId, seasonId, status: WorkerStatus.WORKING },
      relations: ['workerProfile'],
    });

    // If no working workers → pause production and set factory IDLE
    if (workers.length === 0) {
      await this.dataSource.query(
        `UPDATE production_jobs SET status = 'PAUSED', paused_at = NOW(), pause_reason = 'WORKERS_UNAVAILABLE' WHERE id = $1`,
        [job.id],
      );
      await this.factoryRepository.update(factoryId, { status: FactoryStatus.IDLE });
      this.logger.log(`Factory ${factoryId} paused: no WORKING workers`);
      return;
    }

    // Recalculate yield with current workers
    const factory = await this.factoryRepository.findOneBy({ id: factoryId });
    if (!factory) return;

    const playerSeason = await this.dataSource
      .getRepository(PlayerSeason)
      .findOne({ where: { playerId, seasonId } });
    if (!playerSeason) return;

    // Get commodity base data
    const commodity = await this.dataSource.query(
      `SELECT base_yield, base_production_time_minutes FROM commodities WHERE id = $1`,
      [job.commodity_id],
    );
    if (commodity.length === 0) return;

    const baseYield = commodity[0].base_yield;
    const prodTime = commodity[0].base_production_time_minutes;

    // Calculate modifiers (same logic as production service)
    const specCatMap: Record<string, string> = {
      'rice': 'AGRICULTURE', 'palm-fruit': 'AGRICULTURE', 'cocoa': 'AGRICULTURE', 'coffee': 'AGRICULTURE',
      'crude-oil': 'ENERGY', 'natural-gas': 'ENERGY',
      'iron-ore': 'METAL', 'nickel-ore': 'METAL',
      'poultry': 'LIVESTOCK', 'cattle': 'LIVESTOCK',
      'fish': 'FISHERY',
      'timber': 'FORESTRY', 'rubber': 'FORESTRY',
    };
    const roleCatMap: Record<string, string> = {
      'farmer': 'AGRICULTURE', 'miner': 'METAL', 'fisherman': 'FISHERY',
      'driller': 'ENERGY', 'rancher': 'LIVESTOCK', 'lumberjack': 'FORESTRY',
    };

    let totalBonus = 0;
    // Specialty bonus
    if (specCatMap[playerSeason.specialty ?? ''] === factory.category) {
      totalBonus += 0.10;
    }
    // Second worker bonus
    if (workers.length >= 2) {
      totalBonus += 0.25;
    }
    // Worker skill bonus
    for (const wa of workers) {
      if (!wa.workerProfile) continue;
      const spec = wa.workerProfile.specialty;
      let isMatch = false;
      if (factory.factoryLevel === 0) {
        isMatch = roleCatMap[spec] === factory.category;
      } else if (factory.factoryLevel === 1) {
        if (['ENERGY', 'METAL', 'FORESTRY'].includes(factory.category)) {
          isMatch = spec === 'engineer';
        } else {
          isMatch = roleCatMap[spec] === factory.category;
        }
      } else if (factory.factoryLevel === 2) {
        isMatch = spec === 'technician';
      }
      if (isMatch) {
        totalBonus += wa.workerProfile.experienceLevel / 100;
      }
    }

    const newFinalYield = Math.floor(baseYield * (1 + totalBonus));
    const remaining = newFinalYield - job.units_produced;

    if (remaining <= 0) {
      // Already produced enough — mark complete
      await this.dataSource.query(
        `UPDATE production_jobs SET final_yield = $1, status = 'COMPLETED', completed_at = NOW() WHERE id = $2`,
        [newFinalYield, job.id],
      );
      await this.factoryRepository.update(factoryId, { status: FactoryStatus.IDLE });
      this.logger.log(`Factory ${factoryId} production completed after recalibration`);
      return;
    }

    const newInterval = Math.max(1, Math.round(prodTime / newFinalYield));
    const newCompletesAt = new Date(Date.now() + remaining * newInterval * 60 * 1000);

    // Update the job with new parameters
    await this.dataSource.query(
      `UPDATE production_jobs SET final_yield = $1, increment_interval_minutes = $2, completes_at = $3 WHERE id = $4`,
      [newFinalYield, newInterval, newCompletesAt, job.id],
    );

    this.logger.log(
      `Factory ${factoryId} recalibrated: yield ${job.final_yield}→${newFinalYield}, interval ${job.increment_interval_minutes}→${newInterval}min, workers=${workers.length}`,
    );
  }

  /**
   * Reassign a worker from their current factory to a new factory.
   * Validates: worker is assigned to player, new factory belongs to player, new factory has < 2 workers.
   */
  async reassign(playerId: string, workerId: string, newFactoryId: string): Promise<WorkerAssignment> {
    const seasonId = await this.getActiveSeasonId();

    // Validate worker is assigned to this player
    const assignment = await this.workerAssignmentRepository.findOneBy({
      workerId,
      playerId,
      seasonId,
    });

    if (!assignment) {
      throw new NotFoundException('Worker assignment not found for this player');
    }

    if (assignment.factoryId === newFactoryId) {
      throw new BadRequestException('Worker is already assigned to this factory');
    }

    // Validate new factory belongs to the player
    const newFactory = await this.factoryRepository.findOneBy({
      id: newFactoryId,
      playerId,
      seasonId,
    });

    if (!newFactory) {
      throw new NotFoundException(`Factory ${newFactoryId} not found or does not belong to player`);
    }

    // Validate new factory has fewer than max workers
    const currentWorkerCount = await this.workerAssignmentRepository.count({
      where: { factoryId: newFactoryId, seasonId },
    });

    if (currentWorkerCount >= MAX_WORKERS_PER_FACTORY) {
      throw new BadRequestException(
        `Target factory already has the maximum of ${MAX_WORKERS_PER_FACTORY} workers assigned`,
      );
    }

    // Update the assignment
    const oldFactoryId = assignment.factoryId;
    assignment.factoryId = newFactoryId;
    assignment.status = WorkerStatus.WORKING;
    assignment.statusChangedAt = new Date();

    const saved = await this.workerAssignmentRepository.save(assignment);

    this.logger.log(`Worker ${workerId} reassigned to factory ${newFactoryId} by player ${playerId}`);

    // Recalibrate both old and new factories
    if (oldFactoryId) {
      await this.recalibrateProduction(playerId, oldFactoryId);
    }
    await this.recalibrateProduction(playerId, newFactoryId);

    return saved;
  }

  /**
   * Get all workers assigned to a player in the current season.
   */
  async getPlayerWorkers(playerId: string): Promise<WorkerAssignment[]> {
    const seasonId = await this.getActiveSeasonId();

    return this.workerAssignmentRepository.find({
      where: { playerId, seasonId },
      relations: ['workerProfile', 'factory'],
      order: { hiredAt: 'ASC' },
    });
  }

  /**
   * Get the count of workers assigned to a specific factory.
   */
  async getFactoryWorkerCount(factoryId: string, seasonId: string): Promise<number> {
    return this.workerAssignmentRepository.count({
      where: { factoryId, seasonId },
    });
  }

  // --- Helper methods ---

  async getActiveSeasonId(): Promise<string> {
    const season = await this.seasonRepository.findOne({
      where: { status: SeasonStatus.ACTIVE },
      order: { startsAt: 'DESC' },
    });

    if (!season) {
      throw new NotFoundException('No active season found');
    }

    return season.id;
  }
}
