import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Not } from 'typeorm';
import { SeasonStatus } from '@sea-commodity-tycoon/shared-types';
import { Season } from '../entities/season.entity';
import { Player } from '../entities/player.entity';
import { PlayerSeason } from '../entities/player-season.entity';
import { Factory } from '../entities/factory.entity';
import { MarketListing } from '../entities/market-listing.entity';
import { MapService } from '../map/map.service';
import { EconomyService } from '../economy/economy.service';
import { WorkerService } from '../worker/worker.service';

export interface StartSeasonConfig {
  durationDays?: number;
  mapWidth?: number;
  mapHeight?: number;
  configuration?: Record<string, unknown>;
}

export interface SeasonSummary {
  id: string;
  startsAt: Date;
  endsAt: Date;
  status: SeasonStatus;
  configuration: Record<string, unknown>;
  summary: Record<string, unknown> | null;
  createdAt: Date;
}

export interface SeasonHistoryEntry {
  id: string;
  startsAt: Date;
  endsAt: Date;
  status: SeasonStatus;
  createdAt: Date;
}

@Injectable()
export class SeasonService {
  private readonly logger = new Logger(SeasonService.name);

  /** Default season duration in days */
  private readonly DEFAULT_DURATION_DAYS = 30;

  constructor(
    @InjectRepository(Season)
    private readonly seasonRepository: Repository<Season>,
    @InjectRepository(Player)
    private readonly playerRepository: Repository<Player>,
    @InjectRepository(PlayerSeason)
    private readonly playerSeasonRepository: Repository<PlayerSeason>,
    @InjectRepository(Factory)
    private readonly factoryRepository: Repository<Factory>,
    @InjectRepository(MarketListing)
    private readonly marketListingRepository: Repository<MarketListing>,
    private readonly mapService: MapService,
    private readonly economyService: EconomyService,
    private readonly workerService: WorkerService,
  ) {}

  /**
   * Start a new season. Generates a new map, resets all players, clears marketplace,
   * initializes prices, and generates worker pool.
   *
   * Requirements: 13.1, 13.2, 13.3, 22.10
   */
  async startSeason(config?: StartSeasonConfig): Promise<Season> {
    // Ensure no season is currently active
    const activeSeason = await this.seasonRepository.findOne({
      where: { status: SeasonStatus.ACTIVE },
    });

    if (activeSeason) {
      throw new ConflictException('Cannot start a new season while one is already active');
    }

    const durationDays = config?.durationDays ?? this.DEFAULT_DURATION_DAYS;
    const now = new Date();
    const endsAt = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000);

    // Generate a random map seed
    const mapSeed = Math.floor(Math.random() * 2147483647);

    // Create the season record
    const season = this.seasonRepository.create({
      startsAt: now,
      endsAt,
      status: SeasonStatus.ACTIVE,
      configuration: config?.configuration ?? {},
      mapSeed: mapSeed.toString(),
      summary: null,
    });

    const savedSeason = await this.seasonRepository.save(season);
    this.logger.log(`Created new season ${savedSeason.id} (${durationDays} days)`);

    // Generate map
    await this.mapService.generateMap(savedSeason.id, {
      width: config?.mapWidth,
      height: config?.mapHeight,
    });
    this.logger.log(`Map generated for season ${savedSeason.id}`);

    // Initialize commodity prices at base values
    await this.economyService.initializePrices(savedSeason.id);
    this.logger.log(`Prices initialized for season ${savedSeason.id}`);

    // Generate worker pool
    await this.workerService.generateWorkerPool(savedSeason.id);
    this.logger.log(`Worker pool generated for season ${savedSeason.id}`);

    // Create PlayerSeason records for all existing players (fresh start)
    await this.initializePlayerSeasons(savedSeason.id);

    // Cancel all active marketplace listings from previous season
    // (marketplace is fresh each season)
    this.logger.log(`Season ${savedSeason.id} started successfully`);

    return savedSeason;
  }

  /**
   * End an active season. Calculates final standings, records leaderboard,
   * and prevents further actions.
   *
   * Requirements: 13.5
   */
  async endSeason(seasonId: string): Promise<Season> {
    const season = await this.seasonRepository.findOne({
      where: { id: seasonId },
    });

    if (!season) {
      throw new NotFoundException(`Season ${seasonId} not found`);
    }

    if (season.status !== SeasonStatus.ACTIVE) {
      throw new BadRequestException(
        `Cannot end season with status ${season.status}. Only ACTIVE seasons can be ended.`,
      );
    }

    // Calculate final leaderboard
    const leaderboard = await this.economyService.getLeaderboard(seasonId);

    // Build summary
    const summary: Record<string, unknown> = {
      finalStandings: leaderboard,
      endedAt: new Date().toISOString(),
      totalPlayers: leaderboard.length,
      topPlayer: leaderboard.length > 0 ? {
        playerId: leaderboard[0].playerId,
        displayName: leaderboard[0].displayName,
        netWorth: leaderboard[0].netWorth,
      } : null,
    };

    // Update season status and summary
    season.status = SeasonStatus.ENDED;
    season.summary = summary;

    const updatedSeason = await this.seasonRepository.save(season);
    this.logger.log(`Season ${seasonId} ended. ${leaderboard.length} players ranked.`);

    return updatedSeason;
  }

  /**
   * Get the currently active season.
   *
   * Requirements: 13.1
   */
  async getCurrentSeason(): Promise<Season> {
    const season = await this.seasonRepository.findOne({
      where: { status: SeasonStatus.ACTIVE },
      order: { startsAt: 'DESC' },
    });

    if (!season) {
      throw new NotFoundException('No active season found');
    }

    return season;
  }

  /**
   * Get season history (all past seasons ordered by start date).
   */
  async getSeasonHistory(): Promise<SeasonHistoryEntry[]> {
    const seasons = await this.seasonRepository.find({
      order: { startsAt: 'DESC' },
    });

    return seasons.map((season) => ({
      id: season.id,
      startsAt: season.startsAt,
      endsAt: season.endsAt,
      status: season.status,
      createdAt: season.createdAt,
    }));
  }

  /**
   * Get a specific season's summary data.
   */
  async getSeasonSummary(seasonId: string): Promise<SeasonSummary> {
    const season = await this.seasonRepository.findOne({
      where: { id: seasonId },
    });

    if (!season) {
      throw new NotFoundException(`Season ${seasonId} not found`);
    }

    return {
      id: season.id,
      startsAt: season.startsAt,
      endsAt: season.endsAt,
      status: season.status,
      configuration: season.configuration,
      summary: season.summary,
      createdAt: season.createdAt,
    };
  }

  // --- Private helpers ---

  /**
   * Create PlayerSeason records for all registered players with fresh starting state.
   * Resets: 1,000 coins, 500 storage, no specialty, 80% happiness.
   * Also resets factory maintenance_count to 0 (Requirement 22.10).
   */
  private async initializePlayerSeasons(seasonId: string): Promise<void> {
    const players = await this.playerRepository.find();

    const playerSeasons = players.map((player) =>
      this.playerSeasonRepository.create({
        playerId: player.id,
        seasonId,
        specialty: null, // must re-select each season (Requirement 13.3)
        coins: '1000.00',
        storageCapacity: 500,
        workforceHappiness: '80.00',
        lastHappinessDecayAt: null,
        inactivityReminderSent: false,
      }),
    );

    if (playerSeasons.length > 0) {
      await this.playerSeasonRepository.save(playerSeasons);
    }

    this.logger.log(`Initialized ${playerSeasons.length} player seasons for season ${seasonId}`);
  }

  /**
   * Update the end date of an active season.
   */
  async updateEndDate(seasonId: string, newEndsAt: Date): Promise<Season> {
    const season = await this.seasonRepository.findOne({ where: { id: seasonId } });
    if (!season) {
      throw new NotFoundException(`Season ${seasonId} not found`);
    }
    season.endsAt = newEndsAt;
    return this.seasonRepository.save(season);
  }

}
