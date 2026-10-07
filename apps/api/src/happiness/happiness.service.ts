import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, In } from 'typeorm';
import {
  SeasonStatus,
  TransactionType,
  WorkerStatus,
  NotificationType,
  ProductionJobStatus,
  FactoryStatus,
} from '@sea-commodity-tycoon/shared-types';
import { calculateEffectiveCommitment } from '@sea-commodity-tycoon/game-rules';
import { PlayerSeason } from '../entities/player-season.entity';
import { WorkerAssignment } from '../entities/worker-assignment.entity';
import { WorkerProfile } from '../entities/worker-profile.entity';
import { Season } from '../entities/season.entity';
import { Factory } from '../entities/factory.entity';
import { ProductionJob } from '../entities/production-job.entity';
import { Notification } from '../entities/notification.entity';
import { WalletService } from '../wallet/wallet.service';
import { GameConfig } from '../entities/game-config.entity';

/**
 * Default happiness boost definitions.
 * These can be overridden by loading from recipe-config.json via the config package.
 */
const DEFAULT_BOOSTS = [
  { slug: 'free-meals', name: 'Free Meals', cost: 25, happinessIncrease: 5 },
  { slug: 'team-event', name: 'Team Event', cost: 50, happinessIncrease: 10 },
  { slug: 'company-trip', name: 'Company Trip', cost: 75, happinessIncrease: 15 },
  { slug: 'salary-bonus', name: 'Salary Bonus', cost: 100, happinessIncrease: 20 },
];

/** Warning threshold — send notification */
const WARNING_THRESHOLD = 50;

/** Critical threshold — trigger ON_VACATION for all workers */
const CRITICAL_THRESHOLD = 30;

/** Daily decay percent */
const DAILY_DECAY_PERCENT = 1;

/** Neutral baseline for effective commitment calculation */
const NEUTRAL_BASELINE = 80;

export interface HappinessBoostDefinition {
  slug: string;
  name: string;
  icon?: string;
  description?: string;
  cost: number;
  happinessIncrease: number;
  cooldownDays?: number;
}

export interface ConfigurableBoost {
  slug: string;
  name: string;
  icon: string;
  costPerWorker: number;
  happinessIncrease: number;
  cooldownDays: number;
}

export interface HappinessState {
  currentHappiness: number;
  warningThreshold: number;
  criticalThreshold: number;
  isWarning: boolean;
  isCritical: boolean;
  lastDecayAt: Date | null;
}

export interface BoostResult {
  previousHappiness: number;
  newHappiness: number;
  boostApplied: string;
  boostAmount: number;
  coinsCost: number;
}

export interface DisruptionResult {
  playerId: string;
  workersAffected: number;
  disruptionType: WorkerStatus.ABSENT | WorkerStatus.SICK;
}

@Injectable()
export class HappinessService {
  private readonly logger = new Logger(HappinessService.name);
  private boosts: HappinessBoostDefinition[] = DEFAULT_BOOSTS;

  constructor(
    @InjectRepository(PlayerSeason)
    private readonly playerSeasonRepository: Repository<PlayerSeason>,
    @InjectRepository(WorkerAssignment)
    private readonly workerAssignmentRepository: Repository<WorkerAssignment>,
    @InjectRepository(WorkerProfile)
    private readonly workerProfileRepository: Repository<WorkerProfile>,
    @InjectRepository(Season)
    private readonly seasonRepository: Repository<Season>,
    @InjectRepository(Factory)
    private readonly factoryRepository: Repository<Factory>,
    @InjectRepository(ProductionJob)
    private readonly productionJobRepository: Repository<ProductionJob>,
    @InjectRepository(Notification)
    private readonly notificationRepository: Repository<Notification>,
    @InjectRepository(GameConfig)
    private readonly gameConfigRepository: Repository<GameConfig>,
    private readonly dataSource: DataSource,
    private readonly walletService: WalletService,
  ) {}

  /**
   * Load boost definitions from configuration (allows operator tuning).
   * Call this during module initialization or when config is hot-reloaded.
   */
  loadBoostDefinitions(boosts: HappinessBoostDefinition[]): void {
    this.boosts = boosts;
    this.logger.log(`Loaded ${boosts.length} happiness boost definitions`);
  }

  /**
   * Get current happiness state for a player in the active season.
   */
  async getHappiness(playerId: string): Promise<HappinessState> {
    const seasonId = await this.getActiveSeasonId();
    const playerSeason = await this.playerSeasonRepository.findOne({
      where: { playerId, seasonId },
    });

    if (!playerSeason) {
      throw new NotFoundException('Player season record not found');
    }

    const currentHappiness = parseFloat(playerSeason.workforceHappiness);

    return {
      currentHappiness,
      warningThreshold: WARNING_THRESHOLD,
      criticalThreshold: CRITICAL_THRESHOLD,
      isWarning: currentHappiness <= WARNING_THRESHOLD,
      isCritical: currentHappiness <= CRITICAL_THRESHOLD,
      lastDecayAt: playerSeason.lastHappinessDecayAt,
    };
  }

  /**
   * Get all available boost definitions.
   */
  getAvailableBoosts(): HappinessBoostDefinition[] {
    return this.boosts;
  }

  /**
   * Load boosts from the happiness_boost_config DB table and refresh in-memory cache.
   * Falls back to game_config JSON, then hardcoded defaults.
   */
  async refreshBoostsFromDb(): Promise<HappinessBoostDefinition[]> {
    // First try game_config JSON (admin-configured via config page)
    try {
      const config = await this.gameConfigRepository.findOne({ where: { key: 'happiness_boosts' } });
      if (config && Array.isArray(config.value)) {
        const configBoosts = config.value as any[];
        this.boosts = configBoosts.map((b: any) => ({
          slug: b.slug,
          name: b.name,
          icon: b.icon || '🎁',
          description: b.description,
          cost: b.costPerWorker ?? b.cost ?? 0,
          happinessIncrease: b.happinessIncrease ?? 5,
          cooldownDays: b.cooldownDays ?? 5,
        }));
        return this.boosts;
      }
    } catch { /* fall through */ }

    // Then try happiness_boost_config table
    try {
      const rows = await this.dataSource.query(
        `SELECT slug, name, icon, description, cost, happiness_increase, cooldown_days
         FROM happiness_boost_config WHERE is_active = true ORDER BY cost`,
      );
      if (rows.length > 0) {
        this.boosts = rows.map((r: any) => ({
          slug: r.slug,
          name: r.name,
          icon: r.icon,
          description: r.description,
          cost: r.cost,
          happinessIncrease: r.happiness_increase,
          cooldownDays: r.cooldown_days ?? 5,
        }));
      }
    } catch { /* use defaults */ }

    return this.boosts;
  }

  /**
   * Purchase and apply a happiness boost.
   * - Validates boost exists and player has sufficient funds
   * - Deducts cost via WalletService
   * - Applies boost capped at 100%
   * - Records HAPPINESS_BOOST transaction
   */
  async purchaseBoost(playerId: string, boostSlug: string): Promise<BoostResult> {
    // Refresh from DB to get latest config
    await this.refreshBoostsFromDb();

    const boost = this.boosts.find((b) => b.slug === boostSlug);
    if (!boost) {
      throw new BadRequestException(
        `Invalid boost slug: "${boostSlug}". Available: ${this.boosts.map((b) => b.slug).join(', ')}`,
      );
    }

    const seasonId = await this.getActiveSeasonId();
    const cooldownDays = boost.cooldownDays ?? 5;

    // Check cooldown
    const lastPurchase = await this.dataSource.query(
      `SELECT created_at FROM wallet_transactions
       WHERE player_id = $1 AND season_id = $2
         AND reference_type = 'happiness_boost' AND reference_id = $3
       ORDER BY created_at DESC LIMIT 1`,
      [playerId, seasonId, boostSlug],
    );

    if (lastPurchase.length > 0) {
      const lastDate = new Date(lastPurchase[0].created_at);
      const daysSince = (Date.now() - lastDate.getTime()) / (1000 * 60 * 60 * 24);
      if (daysSince < cooldownDays) {
        const daysRemaining = Math.ceil(cooldownDays - daysSince);
        throw new BadRequestException(
          `This boost is on cooldown. Available again in ${daysRemaining} day(s).`,
        );
      }
    }

    return this.dataSource.transaction(async (manager) => {
      // Lock player season for update
      const playerSeason = await manager
        .createQueryBuilder(PlayerSeason, 'ps')
        .setLock('pessimistic_write')
        .where('ps.player_id = :playerId AND ps.season_id = :seasonId', {
          playerId,
          seasonId,
        })
        .getOne();

      if (!playerSeason) {
        throw new NotFoundException('Player season record not found');
      }

      const previousHappiness = parseFloat(playerSeason.workforceHappiness);

      // Count workers to calculate total cost (cost is per worker)
      const workerCount = await manager.count(WorkerAssignment, {
        where: { playerId, seasonId },
      });
      const totalCost = boost.cost * Math.max(1, workerCount);

      // Deduct coins via wallet service
      await this.walletService.executeTransactionWithManager(
        manager,
        playerId,
        seasonId,
        TransactionType.HAPPINESS_BOOST,
        -totalCost,
        {
          referenceType: 'happiness_boost',
          referenceId: boost.slug,
          description: `Purchased happiness boost: ${boost.name} (+${boost.happinessIncrease}%) for ${workerCount} worker(s)`,
        },
      );

      // Apply boost, cap at 100%
      const newHappiness = Math.min(100, previousHappiness + boost.happinessIncrease);

      // Re-read playerSeason to get the updated coins (wallet service modified it)
      const updatedPlayerSeason = await manager.findOneBy(PlayerSeason, { playerId, seasonId });
      if (updatedPlayerSeason) {
        updatedPlayerSeason.workforceHappiness = newHappiness.toFixed(2);
        await manager.save(PlayerSeason, updatedPlayerSeason);
      }

      this.logger.log(
        `Happiness boost applied: player=${playerId}, boost=${boost.slug}, ${previousHappiness}% → ${newHappiness}%`,
      );

      return {
        previousHappiness,
        newHappiness,
        boostApplied: boost.name,
        boostAmount: boost.happinessIncrease,
        coinsCost: totalCost,
      };
    });
  }

  /**
   * Process daily happiness decay for a player.
   * Reduces happiness by 1%, checks thresholds, and triggers effects.
   * Called by the background worker daily.
   */
  async processDailyDecay(playerId: string, seasonId: string): Promise<number> {
    return this.dataSource.transaction(async (manager) => {
      const playerSeason = await manager
        .createQueryBuilder(PlayerSeason, 'ps')
        .setLock('pessimistic_write')
        .where('ps.player_id = :playerId AND ps.season_id = :seasonId', {
          playerId,
          seasonId,
        })
        .getOne();

      if (!playerSeason) {
        throw new NotFoundException('Player season record not found');
      }

      const currentHappiness = parseFloat(playerSeason.workforceHappiness);
      const newHappiness = Math.max(0, currentHappiness - DAILY_DECAY_PERCENT);

      playerSeason.workforceHappiness = newHappiness.toFixed(2);
      playerSeason.lastHappinessDecayAt = new Date();
      await manager.save(PlayerSeason, playerSeason);

      // Check warning threshold
      if (newHappiness <= WARNING_THRESHOLD && currentHappiness > WARNING_THRESHOLD) {
        await this.createNotification(
          manager,
          playerId,
          seasonId,
          NotificationType.HAPPINESS_WARNING,
          'Workforce Happiness Warning',
          `Your workforce happiness has dropped to ${newHappiness.toFixed(1)}%. Consider purchasing a boost to prevent worker disruptions.`,
          'HIGH',
        );
      }

      // Check critical threshold — trigger ON_VACATION
      if (newHappiness <= CRITICAL_THRESHOLD) {
        await this.triggerVacationWithManager(manager, playerId, seasonId);
      }

      this.logger.debug(
        `Happiness decay: player=${playerId}, ${currentHappiness}% → ${newHappiness}%`,
      );

      return newHappiness;
    });
  }

  /**
   * Trigger ON_VACATION for all workers of a player.
   * Halts production at affected factories.
   * Called when happiness drops to or below critical threshold (30%).
   */
  async triggerVacation(playerId: string, seasonId: string): Promise<number> {
    return this.dataSource.transaction(async (manager) => {
      return this.triggerVacationWithManager(manager, playerId, seasonId);
    });
  }

  private async triggerVacationWithManager(
    manager: import('typeorm').EntityManager,
    playerId: string,
    seasonId: string,
  ): Promise<number> {
    // Find all working workers for this player
    const workingAssignments = await manager.find(WorkerAssignment, {
      where: {
        playerId,
        seasonId,
        status: WorkerStatus.WORKING,
      },
    });

    if (workingAssignments.length === 0) {
      return 0;
    }

    const now = new Date();

    // Set all working workers to ON_VACATION
    for (const assignment of workingAssignments) {
      assignment.status = WorkerStatus.ON_VACATION;
      assignment.statusChangedAt = now;
    }
    await manager.save(WorkerAssignment, workingAssignments);

    // Pause active production jobs at affected factories
    const affectedFactoryIds = [
      ...new Set(workingAssignments.map((a) => a.factoryId).filter(Boolean)),
    ];

    if (affectedFactoryIds.length > 0) {
      // Pause active production jobs
      await manager
        .createQueryBuilder()
        .update(ProductionJob)
        .set({
          status: ProductionJobStatus.PAUSED,
          pausedAt: now,
          pauseReason: 'WORKER_ON_VACATION',
        })
        .where('factory_id IN (:...factoryIds)', { factoryIds: affectedFactoryIds })
        .andWhere('status = :status', { status: ProductionJobStatus.ACTIVE })
        .execute();

      // Set factories to PAUSED
      await manager
        .createQueryBuilder()
        .update(Factory)
        .set({ status: FactoryStatus.PAUSED })
        .where('id IN (:...factoryIds)', { factoryIds: affectedFactoryIds })
        .andWhere('status = :producingStatus', { producingStatus: FactoryStatus.PRODUCING })
        .execute();
    }

    this.logger.warn(
      `ON_VACATION triggered: player=${playerId}, workers affected=${workingAssignments.length}, factories paused=${affectedFactoryIds.length}`,
    );

    // Send notification
    await this.createNotification(
      manager,
      playerId,
      seasonId,
      NotificationType.HAPPINESS_WARNING,
      'Workers On Vacation - Critical Happiness',
      `Your workforce happiness has dropped below ${CRITICAL_THRESHOLD}%. All ${workingAssignments.length} workers have gone on vacation and production has been halted. Purchase happiness boosts to recover.`,
      'CRITICAL',
    );

    return workingAssignments.length;
  }

  /**
   * Check and generate random worker disruptions (ABSENT/SICK) for all players in a season.
   * Called by background worker every 4 hours.
   *
   * Disruption probability = (1 - effective_commitment / 100) × frequency_factor
   * Where effective_commitment = clamp(base_commitment × (happiness / 80), 0, 100)
   */
  async checkDisruptions(seasonId: string): Promise<DisruptionResult[]> {
    const results: DisruptionResult[] = [];

    // Get all player seasons in this season
    const playerSeasons = await this.playerSeasonRepository.find({
      where: { seasonId },
    });

    for (const ps of playerSeasons) {
      const happiness = parseFloat(ps.workforceHappiness);

      // Skip if happiness is at critical level (workers already ON_VACATION)
      if (happiness <= CRITICAL_THRESHOLD) {
        continue;
      }

      // Get all working workers for this player
      const workingAssignments = await this.workerAssignmentRepository.find({
        where: {
          playerId: ps.playerId,
          seasonId,
          status: WorkerStatus.WORKING,
        },
        relations: ['workerProfile'],
      });

      for (const assignment of workingAssignments) {
        const baseCommitment = parseFloat(assignment.workerProfile.commitmentLevel);
        const effectiveCommitment = calculateEffectiveCommitment(baseCommitment, happiness);

        // Disruption probability per 4-hour check
        // Higher commitment = lower probability
        const disruptionProbability = (1 - effectiveCommitment / 100) * 0.1;

        const roll = Math.random();
        if (roll < disruptionProbability) {
          // Determine type: 60% ABSENT, 40% SICK
          const disruptionType = Math.random() < 0.6
            ? WorkerStatus.ABSENT
            : WorkerStatus.SICK;

          // Set disruption duration: ABSENT 4-8 hours, SICK 8-24 hours
          const durationHours = disruptionType === WorkerStatus.ABSENT
            ? 4 + Math.random() * 4
            : 8 + Math.random() * 16;

          const now = new Date();
          const endsAt = new Date(now.getTime() + durationHours * 60 * 60 * 1000);

          assignment.status = disruptionType;
          assignment.statusChangedAt = now;
          assignment.disruptionEndsAt = endsAt;
          await this.workerAssignmentRepository.save(assignment);

          results.push({
            playerId: ps.playerId,
            workersAffected: 1,
            disruptionType,
          });

          this.logger.debug(
            `Worker disruption: worker=${assignment.workerId}, player=${ps.playerId}, type=${disruptionType}, ends=${endsAt.toISOString()}`,
          );
        }
      }
    }

    return results;
  }

  /**
   * Resolve disruptions that have expired (disruptionEndsAt <= now).
   * Called periodically to restore workers to WORKING status.
   */
  async resolveExpiredDisruptions(seasonId: string): Promise<number> {
    const now = new Date();

    const expiredAssignments = await this.workerAssignmentRepository
      .createQueryBuilder('wa')
      .where('wa.season_id = :seasonId', { seasonId })
      .andWhere('wa.status IN (:...statuses)', {
        statuses: [WorkerStatus.ABSENT, WorkerStatus.SICK],
      })
      .andWhere('wa.disruption_ends_at <= :now', { now })
      .getMany();

    if (expiredAssignments.length === 0) {
      return 0;
    }

    for (const assignment of expiredAssignments) {
      assignment.status = WorkerStatus.WORKING;
      assignment.statusChangedAt = now;
      assignment.disruptionEndsAt = null;
    }

    await this.workerAssignmentRepository.save(expiredAssignments);

    this.logger.log(`Resolved ${expiredAssignments.length} expired worker disruptions`);
    return expiredAssignments.length;
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

  private async createNotification(
    manager: import('typeorm').EntityManager,
    playerId: string,
    seasonId: string,
    type: NotificationType,
    title: string,
    body: string,
    priority: string,
  ): Promise<void> {
    const notification = manager.create(Notification, {
      playerId,
      seasonId,
      type,
      title,
      body,
      priority,
      read: false,
      delivered: false,
    });
    await manager.save(Notification, notification);
  }

  /**
   * Load boost definitions from game_config table. Falls back to defaults.
   */
  async getAvailableBoostsFromConfig(): Promise<ConfigurableBoost[]> {
    try {
      const config = await this.gameConfigRepository.findOne({ where: { key: 'happiness_boosts' } });
      if (config && Array.isArray(config.value)) {
        return (config.value as unknown as ConfigurableBoost[]).map(b => ({
          slug: b.slug || 'unknown',
          name: b.name || 'Unnamed',
          icon: b.icon || '🎁',
          costPerWorker: b.costPerWorker || 20,
          happinessIncrease: b.happinessIncrease || 5,
          cooldownDays: b.cooldownDays || 5,
        }));
      }
    } catch { /* fall through to defaults */ }

    return [
      { slug: 'meals', name: 'Team Meals', icon: '🍜', costPerWorker: 20, happinessIncrease: 5, cooldownDays: 5 },
      { slug: 'company-trip', name: 'Company Trip', icon: '✈️', costPerWorker: 50, happinessIncrease: 10, cooldownDays: 5 },
      { slug: 'salary-raise', name: 'Salary Raise', icon: '💰', costPerWorker: 80, happinessIncrease: 15, cooldownDays: 5 },
    ];
  }

  /**
   * Get boost cooldowns for a player. Returns map of slug -> cooldown end date.
   */
  async getPlayerBoostCooldowns(playerId: string): Promise<Record<string, string>> {
    await this.refreshBoostsFromDb();
    const seasonId = await this.getActiveSeasonId();

    // Query wallet_transactions for recent happiness_boost purchases
    const recentBoosts = await this.dataSource.query(
      `SELECT reference_id as slug, created_at
       FROM wallet_transactions
       WHERE player_id = $1 AND season_id = $2
         AND reference_type = 'happiness_boost'
       ORDER BY created_at DESC`,
      [playerId, seasonId],
    );

    const cooldowns: Record<string, string> = {};
    for (const row of recentBoosts) {
      const slug = row.slug;
      if (!slug || cooldowns[slug]) continue; // only take the latest per slug

      // Find the boost config to get its cooldown days
      const boost = this.boosts.find((b) => b.slug === slug);
      const cooldownDays = boost?.cooldownDays ?? 5;

      const purchaseDate = new Date(row.created_at);
      const cooldownEnd = new Date(purchaseDate.getTime() + cooldownDays * 24 * 60 * 60 * 1000);

      if (cooldownEnd > new Date()) {
        cooldowns[slug] = cooldownEnd.toISOString();
      }
    }

    return cooldowns;
  }

}
