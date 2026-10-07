import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { LoanStatus, SeasonStatus } from '@sea-commodity-tycoon/shared-types';
import { Player } from '../entities/player.entity';
import { PlayerSeason } from '../entities/player-season.entity';
import { Season } from '../entities/season.entity';
import { MapTile } from '../entities/map-tile.entity';
import { Factory } from '../entities/factory.entity';
import { Inventory } from '../entities/inventory.entity';
import { CurrentPrice } from '../entities/current-price.entity';
import { Loan } from '../entities/loan.entity';
import { UpdateProfileDto, SelectSpecialtyDto } from './dto';

export interface NetWorthBreakdown {
  cash: number;
  landValue: number;
  factoryValue: number;
  inventoryMarketValue: number;
  outstandingDebt: number;
  total: number;
}

export interface PlayerDashboard {
  player: {
    id: string;
    email: string;
    displayName: string;
    avatarConfig: Record<string, unknown>;
    createdAt: Date;
    lastActiveAt: Date;
  };
  season: {
    id: string;
    specialty: string | null;
    coins: number;
    storageCapacity: number;
    workforceHappiness: number;
  } | null;
  netWorth: NetWorthBreakdown | null;
}

@Injectable()
export class PlayerService {
  constructor(
    @InjectRepository(Player)
    private readonly playerRepository: Repository<Player>,
    @InjectRepository(PlayerSeason)
    private readonly playerSeasonRepository: Repository<PlayerSeason>,
    @InjectRepository(Season)
    private readonly seasonRepository: Repository<Season>,
    @InjectRepository(MapTile)
    private readonly mapTileRepository: Repository<MapTile>,
    @InjectRepository(Factory)
    private readonly factoryRepository: Repository<Factory>,
    @InjectRepository(Inventory)
    private readonly inventoryRepository: Repository<Inventory>,
    @InjectRepository(CurrentPrice)
    private readonly currentPriceRepository: Repository<CurrentPrice>,
    @InjectRepository(Loan)
    private readonly loanRepository: Repository<Loan>,
  ) {}

  /**
   * Update player profile (display name and/or avatar).
   */
  async updateProfile(playerId: string, dto: UpdateProfileDto): Promise<Player> {
    const player = await this.playerRepository.findOneBy({ id: playerId });
    if (!player) {
      throw new NotFoundException('Player not found');
    }

    if (dto.displayName && dto.displayName !== player.displayName) {
      const existing = await this.playerRepository.findOneBy({ displayName: dto.displayName });
      if (existing) {
        throw new ConflictException('Display name already taken');
      }
      player.displayName = dto.displayName;
    }

    if (dto.avatarConfig !== undefined) {
      player.avatarConfig = dto.avatarConfig;
    }

    return this.playerRepository.save(player);
  }

  /**
   * Select a specialty for the current season.
   * Exactly one L0 commodity per season, cannot be changed once set.
   */
  async selectSpecialty(playerId: string, dto: SelectSpecialtyDto): Promise<PlayerSeason> {
    const season = await this.getActiveSeason();
    const playerSeason = await this.getOrCreatePlayerSeason(playerId, season.id);

    if (playerSeason.specialty !== null) {
      throw new BadRequestException('Specialty already selected for this season. Cannot change.');
    }

    playerSeason.specialty = dto.commodity;
    return this.playerSeasonRepository.save(playerSeason);
  }

  /**
   * Get the full current player state including season data.
   */
  async getPlayerState(playerId: string): Promise<{
    player: Player;
    playerSeason: PlayerSeason | null;
    season: Season | null;
  }> {
    const player = await this.playerRepository.findOneBy({ id: playerId });
    if (!player) {
      throw new NotFoundException('Player not found');
    }

    const season = await this.seasonRepository.findOne({
      where: { status: SeasonStatus.ACTIVE },
      order: { startsAt: 'DESC' },
    });

    let playerSeason: PlayerSeason | null = null;
    if (season) {
      playerSeason = await this.playerSeasonRepository.findOne({
        where: { playerId, seasonId: season.id },
      });
    }

    return { player, playerSeason, season };
  }

  /**
   * Calculate net worth breakdown for a player in the current season.
   * Formula: cash + land_value + factory_value + inventory_market_value - outstanding_debt
   */
  async getNetWorth(playerId: string): Promise<NetWorthBreakdown> {
    const season = await this.getActiveSeason();
    const playerSeason = await this.playerSeasonRepository.findOne({
      where: { playerId, seasonId: season.id },
    });

    if (!playerSeason) {
      throw new NotFoundException('Player season record not found');
    }

    const cash = parseFloat(playerSeason.coins);

    // Land value: sum of purchase_price for all owned tiles
    const landResult = await this.mapTileRepository
      .createQueryBuilder('tile')
      .select('COALESCE(SUM(tile.purchase_price), 0)', 'total')
      .where('tile.owner_player_id = :playerId', { playerId })
      .andWhere('tile.season_id = :seasonId', { seasonId: season.id })
      .getRawOne();
    const landValue = parseFloat(landResult?.total ?? '0');

    // Factory value: sum of setup_cost for all owned factories
    const factoryResult = await this.factoryRepository
      .createQueryBuilder('factory')
      .select('COALESCE(SUM(factory.setup_cost), 0)', 'total')
      .where('factory.player_id = :playerId', { playerId })
      .andWhere('factory.season_id = :seasonId', { seasonId: season.id })
      .getRawOne();
    const factoryValue = parseFloat(factoryResult?.total ?? '0');

    // Inventory market value: sum of (quantity × current_market_price)
    const inventoryItems = await this.inventoryRepository.find({
      where: { playerId, seasonId: season.id },
    });

    let inventoryMarketValue = 0;
    if (inventoryItems.length > 0) {
      const commodityIds = inventoryItems.map((item) => item.commodityId);
      const prices = await this.currentPriceRepository
        .createQueryBuilder('cp')
        .where('cp.season_id = :seasonId', { seasonId: season.id })
        .andWhere('cp.commodity_id IN (:...commodityIds)', { commodityIds })
        .getMany();

      const priceMap = new Map(prices.map((p) => [p.commodityId, parseFloat(p.price)]));

      for (const item of inventoryItems) {
        const price = priceMap.get(item.commodityId) ?? 0;
        inventoryMarketValue += item.quantity * price;
      }
    }

    // Outstanding debt: sum of outstanding_balance for all active loans
    const debtResult = await this.loanRepository
      .createQueryBuilder('loan')
      .select('COALESCE(SUM(loan.outstanding_balance), 0)', 'total')
      .where('loan.player_id = :playerId', { playerId })
      .andWhere('loan.season_id = :seasonId', { seasonId: season.id })
      .andWhere('loan.status = :status', { status: LoanStatus.ACTIVE })
      .getRawOne();
    const outstandingDebt = parseFloat(debtResult?.total ?? '0');

    const total = cash + landValue + factoryValue + inventoryMarketValue - outstandingDebt;

    return {
      cash: Math.round(cash),
      landValue: Math.round(landValue),
      factoryValue: Math.round(factoryValue),
      inventoryMarketValue: Math.round(inventoryMarketValue),
      outstandingDebt: Math.round(outstandingDebt),
      total: Math.round(total),
    };
  }

  /**
   * Get full dashboard stats for a player.
   */
  async getDashboard(playerId: string): Promise<PlayerDashboard> {
    const { player, playerSeason, season } = await this.getPlayerState(playerId);

    let netWorth: NetWorthBreakdown | null = null;
    if (season && playerSeason) {
      netWorth = await this.getNetWorth(playerId);
    }

    return {
      player: {
        id: player.id,
        email: player.email,
        displayName: player.displayName,
        avatarConfig: player.avatarConfig,
        createdAt: player.createdAt,
        lastActiveAt: player.lastActiveAt,
      },
      season: playerSeason
        ? {
            id: playerSeason.seasonId,
            specialty: playerSeason.specialty,
            coins: Math.round(parseFloat(playerSeason.coins)),
            storageCapacity: playerSeason.storageCapacity,
            workforceHappiness: Math.round(parseFloat(playerSeason.workforceHappiness)),
          }
        : null,
      netWorth,
    };
  }

  /**
   * Update last active timestamp. Called on every game action for inactivity tracking.
   */
  async updateLastActiveAt(playerId: string): Promise<void> {
    await this.playerRepository.update(playerId, { lastActiveAt: new Date() });

    // Clear inactivity reminder flag if set
    const season = await this.seasonRepository.findOne({
      where: { status: SeasonStatus.ACTIVE },
      order: { startsAt: 'DESC' },
    });

    if (season) {
      await this.playerSeasonRepository.update(
        { playerId, seasonId: season.id },
        { inactivityReminderSent: false },
      );
    }
  }

  // --- Helper methods ---

  private async getActiveSeason(): Promise<Season> {
    const season = await this.seasonRepository.findOne({
      where: { status: SeasonStatus.ACTIVE },
      order: { startsAt: 'DESC' },
    });

    if (!season) {
      throw new NotFoundException('No active season found');
    }

    return season;
  }

  private async getOrCreatePlayerSeason(playerId: string, seasonId: string): Promise<PlayerSeason> {
    let playerSeason = await this.playerSeasonRepository.findOne({
      where: { playerId, seasonId },
    });

    if (!playerSeason) {
      playerSeason = this.playerSeasonRepository.create({
        playerId,
        seasonId,
        specialty: null,
        coins: '1000.00',
        storageCapacity: 500,
        workforceHappiness: '80.00',
      });
      playerSeason = await this.playerSeasonRepository.save(playerSeason);
    }

    return playerSeason;
  }
}
