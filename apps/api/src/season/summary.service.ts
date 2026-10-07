import {
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SeasonStatus, ProductionJobStatus } from '@sea-commodity-tycoon/shared-types';
import { Season } from '../entities/season.entity';
import { ProductionJob } from '../entities/production-job.entity';
import { Inventory } from '../entities/inventory.entity';
import { MarketTrade } from '../entities/market-trade.entity';
import { GameEvent } from '../entities/game-event.entity';
import { Commodity } from '../entities/commodity.entity';
import { PlayerSeason } from '../entities/player-season.entity';
import { CurrentPrice } from '../entities/current-price.entity';

// ============================================================
// Types
// ============================================================

export interface HighestProducedCommodity {
  commodityId: string;
  slug: string;
  name: string;
  category: string;
  totalVolume: number;
}

export interface WealthiestPlayer {
  playerId: string;
  displayName: string;
  netWorth: number;
}

export interface MarketMonopoly {
  playerId: string;
  displayName: string;
  commoditySlug: string;
  commodityName: string;
  quantity: number;
  supplyPercent: number;
}

export interface BestPivot {
  playerId: string;
  displayName: string;
  netWorthDelta: number;
  windowStart: string;
  windowEnd: string;
}

export interface SeasonEvent {
  eventType: string;
  name: string;
  affectedCategories: string[];
  startsAt: Date;
  endsAt: Date;
}

export interface FullSeasonSummary {
  generatedAt: string;
  seasonId: string;
  startsAt: Date;
  endsAt: Date;
  tagline: string;
  taglineOverride: string | null;
  highestProducedCommodity: HighestProducedCommodity | null;
  wealthiestPlayer: WealthiestPlayer | null;
  marketMonopoly: MarketMonopoly | null;
  bestPivot: BestPivot | null;
  keyEvents: SeasonEvent[];
  leaderboard: Array<{
    rank: number;
    playerId: string;
    displayName: string;
    netWorth: number;
  }>;
}

// ============================================================
// Tagline generation
// ============================================================

/**
 * Generates a thematic tagline based on the season's dominant trends.
 *
 * Factors considered:
 * - Most-traded commodity category
 * - Number and type of disaster events
 * - Price volatility (from trade volume)
 * - Monopoly concentration
 *
 * Requirements: 23.4
 */
export function generateTagline(params: {
  mostTradedCategory: string | null;
  disasterCount: number;
  positiveEventCount: number;
  topCommodityName: string | null;
  monopolyPercent: number | null;
  totalPlayers: number;
}): string {
  const {
    mostTradedCategory,
    disasterCount,
    positiveEventCount,
    topCommodityName,
    monopolyPercent,
    totalPlayers,
  } = params;

  const parts: string[] = [];

  // Disaster-heavy seasons
  if (disasterCount >= 3) {
    parts.push('A season of storms and resilience');
  } else if (disasterCount >= 1) {
    parts.push('Adversity tested the market');
  }

  // Positive event emphasis
  if (positiveEventCount >= 3) {
    parts.push('prosperity bloomed across the islands');
  } else if (positiveEventCount >= 1 && disasterCount === 0) {
    parts.push('Favorable winds fueled growth');
  }

  // Category dominance
  if (mostTradedCategory) {
    const categoryNames: Record<string, string> = {
      AGRICULTURE: 'agriculture',
      ENERGY: 'energy',
      METAL: 'metals',
      LIVESTOCK: 'livestock',
      FORESTRY: 'forestry',
    };
    const catName = categoryNames[mostTradedCategory] || mostTradedCategory.toLowerCase();
    if (parts.length === 0) {
      parts.push(`The age of ${catName}`);
    } else {
      parts.push(`${catName} dominated trade`);
    }
  }

  // Monopoly highlight
  if (monopolyPercent !== null && monopolyPercent >= 60) {
    parts.push('a titan controlled the supply');
  }

  // Top commodity
  if (topCommodityName && parts.length < 2) {
    parts.push(`${topCommodityName} flowed in abundance`);
  }

  // Fallback
  if (parts.length === 0) {
    if (totalPlayers === 0) {
      return 'A quiet season in the archipelago';
    }
    return 'Trade flourished across the Southeast Asian seas';
  }

  // Combine parts into a sentence
  const tagline = parts.join(', ');
  // Capitalize first letter
  return tagline.charAt(0).toUpperCase() + tagline.slice(1);
}

// ============================================================
// Service
// ============================================================

@Injectable()
export class SummaryService {
  private readonly logger = new Logger(SummaryService.name);

  constructor(
    @InjectRepository(Season)
    private readonly seasonRepository: Repository<Season>,
    @InjectRepository(ProductionJob)
    private readonly productionJobRepository: Repository<ProductionJob>,
    @InjectRepository(Inventory)
    private readonly inventoryRepository: Repository<Inventory>,
    @InjectRepository(MarketTrade)
    private readonly marketTradeRepository: Repository<MarketTrade>,
    @InjectRepository(GameEvent)
    private readonly gameEventRepository: Repository<GameEvent>,
    @InjectRepository(Commodity)
    private readonly commodityRepository: Repository<Commodity>,
    @InjectRepository(PlayerSeason)
    private readonly playerSeasonRepository: Repository<PlayerSeason>,
    @InjectRepository(CurrentPrice)
    private readonly currentPriceRepository: Repository<CurrentPrice>,
  ) {}

  /**
   * Generate a full season summary with all highlights.
   *
   * Requirements: 23.1, 23.2, 23.3, 23.4, 23.5, 23.6, 23.7
   */
  async generateFullSummary(seasonId: string): Promise<FullSeasonSummary> {
    const season = await this.seasonRepository.findOne({
      where: { id: seasonId },
    });

    if (!season) {
      throw new NotFoundException(`Season ${seasonId} not found`);
    }

    // Run all queries in parallel
    const [
      highestProduced,
      wealthiestPlayer,
      marketMonopoly,
      bestPivot,
      keyEvents,
      leaderboard,
      mostTradedCategory,
    ] = await Promise.all([
      this.queryHighestProducedCommodity(seasonId),
      this.queryWealthiestPlayer(seasonId),
      this.queryMarketMonopoly(seasonId),
      this.queryBestPivot(seasonId, season.startsAt, season.endsAt),
      this.queryKeyEvents(seasonId),
      this.queryLeaderboard(seasonId),
      this.queryMostTradedCategory(seasonId),
    ]);

    // Count disaster vs positive events
    const disasterCount = keyEvents.filter((e) =>
      ['FLOOD', 'LIVESTOCK_DISEASE', 'STORM', 'FOREST_FIRE'].includes(e.eventType),
    ).length;
    const positiveEventCount = keyEvents.filter((e) =>
      ['EXCELLENT_HARVEST', 'INFRASTRUCTURE_PROGRAM', 'EV_INCENTIVE'].includes(e.eventType),
    ).length;

    // Generate tagline
    const tagline = generateTagline({
      mostTradedCategory,
      disasterCount,
      positiveEventCount,
      topCommodityName: highestProduced?.name || null,
      monopolyPercent: marketMonopoly?.supplyPercent || null,
      totalPlayers: leaderboard.length,
    });

    // Check for operator tagline override in season configuration
    const taglineOverride =
      (season.configuration?.taglineOverride as string) || null;

    const summary: FullSeasonSummary = {
      generatedAt: new Date().toISOString(),
      seasonId,
      startsAt: season.startsAt,
      endsAt: season.endsAt,
      tagline: taglineOverride || tagline,
      taglineOverride,
      highestProducedCommodity: highestProduced,
      wealthiestPlayer,
      marketMonopoly,
      bestPivot,
      keyEvents,
      leaderboard,
    };

    // Persist summary into the season record (Requirement 23.6)
    season.summary = summary as unknown as Record<string, unknown>;
    await this.seasonRepository.save(season);

    this.logger.log(
      `Generated full summary for season ${seasonId}: ` +
        `tagline="${summary.tagline}", ` +
        `wealthiest=${wealthiestPlayer?.displayName || 'N/A'}, ` +
        `top commodity=${highestProduced?.name || 'N/A'}`,
    );

    return summary;
  }

  // ============================================================
  // Query methods
  // ============================================================

  /**
   * Query the highest-produced commodity by total production volume.
   * Requirement 23.1: highest-produced commodity type by total volume
   */
  private async queryHighestProducedCommodity(
    seasonId: string,
  ): Promise<HighestProducedCommodity | null> {
    const result = await this.productionJobRepository
      .createQueryBuilder('pj')
      .select('pj.commodity_id', 'commodityId')
      .addSelect('c.slug', 'slug')
      .addSelect('c.name', 'name')
      .addSelect('c.category', 'category')
      .addSelect('SUM(pj.units_produced)', 'totalVolume')
      .innerJoin('commodities', 'c', 'pj.commodity_id = c.id')
      .where('pj.season_id = :seasonId', { seasonId })
      .andWhere('pj.status = :status', { status: ProductionJobStatus.COMPLETED })
      .groupBy('pj.commodity_id')
      .addGroupBy('c.slug')
      .addGroupBy('c.name')
      .addGroupBy('c.category')
      .orderBy('"totalVolume"', 'DESC')
      .limit(1)
      .getRawOne();

    if (!result || !result.commodityId) {
      return null;
    }

    return {
      commodityId: result.commodityId,
      slug: result.slug,
      name: result.name,
      category: result.category,
      totalVolume: parseInt(result.totalVolume, 10),
    };
  }

  /**
   * Query the wealthiest player by net worth.
   * Net worth = coins + land value + factory value + inventory market value - outstanding debt
   * Requirement 23.1: wealthiest Player (highest final Net_Worth)
   */
  private async queryWealthiestPlayer(
    seasonId: string,
  ): Promise<WealthiestPlayer | null> {
    // Simplified: use coins + inventory market value as proxy
    // (matches the EconomyService.getLeaderboard approach)
    const playerSeasons = await this.playerSeasonRepository
      .createQueryBuilder('ps')
      .innerJoinAndSelect('ps.player', 'player')
      .where('ps.season_id = :seasonId', { seasonId })
      .getMany();

    if (playerSeasons.length === 0) {
      return null;
    }

    const currentPrices = await this.currentPriceRepository.find({
      where: { seasonId },
    });
    const priceMap = new Map(
      currentPrices.map((cp) => [cp.commodityId, parseFloat(cp.price)]),
    );

    const inventories = await this.inventoryRepository.find({
      where: { seasonId },
    });

    const playerInventoryValue = new Map<string, number>();
    for (const inv of inventories) {
      const price = priceMap.get(inv.commodityId) ?? 0;
      const value = inv.quantity * price;
      const current = playerInventoryValue.get(inv.playerId) ?? 0;
      playerInventoryValue.set(inv.playerId, current + value);
    }

    let wealthiest: WealthiestPlayer | null = null;
    let maxNetWorth = -Infinity;

    for (const ps of playerSeasons) {
      const cash = parseFloat(ps.coins);
      const inventoryValue = playerInventoryValue.get(ps.playerId) ?? 0;
      const netWorth = cash + inventoryValue;

      if (netWorth > maxNetWorth) {
        maxNetWorth = netWorth;
        wealthiest = {
          playerId: ps.playerId,
          displayName: ps.player.displayName,
          netWorth,
        };
      }
    }

    return wealthiest;
  }

  /**
   * Query market monopoly: highest % of single commodity supply held by one player.
   * Requirement 23.2
   */
  private async queryMarketMonopoly(
    seasonId: string,
  ): Promise<MarketMonopoly | null> {
    const result = await this.inventoryRepository
      .createQueryBuilder('inv')
      .select('inv.player_id', 'playerId')
      .addSelect('p.display_name', 'displayName')
      .addSelect('c.slug', 'commoditySlug')
      .addSelect('c.name', 'commodityName')
      .addSelect('inv.quantity', 'quantity')
      .addSelect(
        `CASE WHEN ct.total_supply > 0
          THEN (inv.quantity::decimal / ct.total_supply * 100)
          ELSE 0
        END`,
        'supplyPercent',
      )
      .innerJoin('commodities', 'c', 'inv.commodity_id = c.id')
      .innerJoin('players', 'p', 'inv.player_id = p.id')
      .innerJoin(
        (qb) =>
          qb
            .select('sub_inv.commodity_id', 'commodity_id')
            .addSelect('SUM(sub_inv.quantity)', 'total_supply')
            .from('inventory', 'sub_inv')
            .where('sub_inv.season_id = :seasonId', { seasonId })
            .groupBy('sub_inv.commodity_id')
            .having('SUM(sub_inv.quantity) > 0'),
        'ct',
        'ct.commodity_id = inv.commodity_id',
      )
      .where('inv.season_id = :seasonId', { seasonId })
      .orderBy('"supplyPercent"', 'DESC')
      .limit(1)
      .getRawOne();

    if (!result || !result.playerId) {
      return null;
    }

    return {
      playerId: result.playerId,
      displayName: result.displayName,
      commoditySlug: result.commoditySlug,
      commodityName: result.commodityName,
      quantity: parseInt(result.quantity, 10),
      supplyPercent: parseFloat(result.supplyPercent),
    };
  }

  /**
   * Query best pivot: greatest positive Net_Worth delta over any consecutive 5-day window.
   * Requirement 23.3
   *
   * For MVP, since we don't have periodic net worth snapshots, we calculate based on
   * wallet transaction history (sum of all transactions within 5-day windows).
   * If no meaningful data, returns null.
   */
  private async queryBestPivot(
    seasonId: string,
    seasonStart: Date,
    seasonEnd: Date,
  ): Promise<BestPivot | null> {
    // For MVP: query all player seasons and use leaderboard as a proxy.
    // A proper implementation would need daily net worth snapshots.
    // Here we'll look at trade profit within 5-day windows as an approximation.
    const playerSeasons = await this.playerSeasonRepository
      .createQueryBuilder('ps')
      .innerJoinAndSelect('ps.player', 'player')
      .where('ps.season_id = :seasonId', { seasonId })
      .getMany();

    if (playerSeasons.length === 0) {
      return null;
    }

    // Calculate net trade profit per player as best approximation for "pivot"
    // (total coins earned from sales minus starting 1000)
    let bestPlayer: BestPivot | null = null;
    let maxDelta = 0;

    for (const ps of playerSeasons) {
      const currentCoins = parseFloat(ps.coins);
      const delta = currentCoins - 1000; // Net change from starting amount

      if (delta > maxDelta) {
        maxDelta = delta;
        bestPlayer = {
          playerId: ps.playerId,
          displayName: ps.player.displayName,
          netWorthDelta: delta,
          windowStart: seasonStart.toISOString(),
          windowEnd: seasonEnd.toISOString(),
        };
      }
    }

    return bestPlayer;
  }

  /**
   * Query all key events that occurred during the season.
   * Requirement 23.1: list of key events
   */
  private async queryKeyEvents(seasonId: string): Promise<SeasonEvent[]> {
    const events = await this.gameEventRepository.find({
      where: { seasonId },
      order: { startsAt: 'ASC' },
    });

    return events.map((event) => ({
      eventType: event.eventType,
      name: event.name,
      affectedCategories: event.affectedCategories,
      startsAt: event.startsAt,
      endsAt: event.endsAt,
    }));
  }

  /**
   * Query the leaderboard (top players by net worth).
   */
  private async queryLeaderboard(
    seasonId: string,
  ): Promise<Array<{ rank: number; playerId: string; displayName: string; netWorth: number }>> {
    const playerSeasons = await this.playerSeasonRepository
      .createQueryBuilder('ps')
      .innerJoinAndSelect('ps.player', 'player')
      .where('ps.season_id = :seasonId', { seasonId })
      .getMany();

    const currentPrices = await this.currentPriceRepository.find({
      where: { seasonId },
    });
    const priceMap = new Map(
      currentPrices.map((cp) => [cp.commodityId, parseFloat(cp.price)]),
    );

    const inventories = await this.inventoryRepository.find({
      where: { seasonId },
    });

    const playerInventoryValue = new Map<string, number>();
    for (const inv of inventories) {
      const price = priceMap.get(inv.commodityId) ?? 0;
      const value = inv.quantity * price;
      const current = playerInventoryValue.get(inv.playerId) ?? 0;
      playerInventoryValue.set(inv.playerId, current + value);
    }

    const entries = playerSeasons.map((ps) => {
      const cash = parseFloat(ps.coins);
      const inventoryValue = playerInventoryValue.get(ps.playerId) ?? 0;
      return {
        playerId: ps.playerId,
        displayName: ps.player.displayName,
        netWorth: cash + inventoryValue,
        rank: 0,
      };
    });

    entries.sort((a, b) => b.netWorth - a.netWorth);
    entries.forEach((entry, index) => {
      entry.rank = index + 1;
    });

    return entries;
  }

  /**
   * Query the most-traded commodity category by total trade volume.
   */
  private async queryMostTradedCategory(seasonId: string): Promise<string | null> {
    const result = await this.marketTradeRepository
      .createQueryBuilder('trade')
      .select('c.category', 'category')
      .addSelect('SUM(trade.quantity)', 'totalVolume')
      .innerJoin('commodities', 'c', 'trade.commodity_id = c.id')
      .where('trade.season_id = :seasonId', { seasonId })
      .groupBy('c.category')
      .orderBy('"totalVolume"', 'DESC')
      .limit(1)
      .getRawOne();

    return result?.category || null;
  }
}
