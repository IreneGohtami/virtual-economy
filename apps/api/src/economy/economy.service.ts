import {
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan } from 'typeorm';
import { SeasonStatus, ListingStatus, ProductionJobStatus } from '@sea-commodity-tycoon/shared-types';
import { calculateDynamicPrice } from '@sea-commodity-tycoon/game-rules';
import { Commodity } from '../entities/commodity.entity';
import { CommodityPrice } from '../entities/commodity-price.entity';
import { CurrentPrice } from '../entities/current-price.entity';
import { Season } from '../entities/season.entity';
import { MarketTrade } from '../entities/market-trade.entity';
import { ProductionJob } from '../entities/production-job.entity';
import { Inventory } from '../entities/inventory.entity';
import { MarketListing } from '../entities/market-listing.entity';
import { PlayerSeason } from '../entities/player-season.entity';

export interface PriceHistoryEntry {
  id: string;
  price: number;
  supplyMultiplier: number;
  demandMultiplier: number;
  supplyMetric: number | null;
  demandMetric: number | null;
  tradeVolume: number;
  recordedAt: Date;
}

export interface LeaderboardEntry {
  playerId: string;
  displayName: string;
  netWorth: number;
  rank: number;
}

export interface RecalibrationResult {
  commodityId: string;
  commoditySlug: string;
  previousPrice: number;
  newPrice: number;
  supplyMultiplier: number;
  demandMultiplier: number;
}

@Injectable()
export class EconomyService {
  private readonly logger = new Logger(EconomyService.name);

  /** Number of days from season start where prices remain at base values */
  private readonly STABILIZATION_DAYS = 7;

  constructor(
    @InjectRepository(Commodity)
    private readonly commodityRepository: Repository<Commodity>,
    @InjectRepository(CommodityPrice)
    private readonly commodityPriceRepository: Repository<CommodityPrice>,
    @InjectRepository(CurrentPrice)
    private readonly currentPriceRepository: Repository<CurrentPrice>,
    @InjectRepository(Season)
    private readonly seasonRepository: Repository<Season>,
    @InjectRepository(MarketTrade)
    private readonly marketTradeRepository: Repository<MarketTrade>,
    @InjectRepository(ProductionJob)
    private readonly productionJobRepository: Repository<ProductionJob>,
    @InjectRepository(Inventory)
    private readonly inventoryRepository: Repository<Inventory>,
    @InjectRepository(MarketListing)
    private readonly marketListingRepository: Repository<MarketListing>,
    @InjectRepository(PlayerSeason)
    private readonly playerSeasonRepository: Repository<PlayerSeason>,
  ) {}

  /**
   * Initialize current prices for all active commodities at the start of a season.
   * Sets all prices to base_price with multipliers = 1.0.
   */
  async initializePrices(seasonId: string): Promise<void> {
    const commodities = await this.commodityRepository.find({
      where: { active: true },
    });

    for (const commodity of commodities) {
      const basePrice = parseFloat(commodity.basePrice);

      const existing = await this.currentPriceRepository.findOne({
        where: { seasonId, commodityId: commodity.id },
      });

      if (existing) {
        existing.price = basePrice.toFixed(2);
        existing.supplyMultiplier = '1.0000';
        existing.demandMultiplier = '1.0000';
        existing.lastUpdatedAt = new Date();
        await this.currentPriceRepository.save(existing);
      } else {
        const currentPrice = this.currentPriceRepository.create({
          seasonId,
          commodityId: commodity.id,
          price: basePrice.toFixed(2),
          supplyMultiplier: '1.0000',
          demandMultiplier: '1.0000',
          lastUpdatedAt: new Date(),
        });
        await this.currentPriceRepository.save(currentPrice);
      }

      // Record initial entry in price history
      const historyEntry = this.commodityPriceRepository.create({
        seasonId,
        commodityId: commodity.id,
        price: basePrice.toFixed(2),
        supplyMultiplier: '1.0000',
        demandMultiplier: '1.0000',
        supplyMetric: null,
        demandMetric: null,
        tradeVolume: 0,
        recordedAt: new Date(),
      });
      await this.commodityPriceRepository.save(historyEntry);
    }

    this.logger.log(`Initialized prices for ${commodities.length} commodities in season ${seasonId}`);
  }

  /**
   * Recalibrate all commodity prices for the given season.
   * Called daily by the economy worker.
   *
   * During the first 7 days (stabilization period), prices remain at base values.
   * After Day 7, supply and demand multipliers are calculated from market activity.
   */
  async recalibratePrices(seasonId: string): Promise<RecalibrationResult[]> {
    const season = await this.seasonRepository.findOne({
      where: { id: seasonId },
    });

    if (!season) {
      throw new NotFoundException('Season not found');
    }

    const daysSinceStart = this.getDaysSinceSeasonStart(season.startsAt);
    const isStabilizationPeriod = daysSinceStart <= this.STABILIZATION_DAYS;

    const commodities = await this.commodityRepository.find({
      where: { active: true },
    });

    const results: RecalibrationResult[] = [];

    for (const commodity of commodities) {
      const basePrice = parseFloat(commodity.basePrice);

      let supplyMultiplier = 1.0;
      let demandMultiplier = 1.0;
      let supplyMetric: number | null = null;
      let demandMetric: number | null = null;
      let tradeVolume = 0;

      if (!isStabilizationPeriod) {
        // Calculate supply metrics
        const supplyData = await this.calculateSupplyMetrics(commodity.id, seasonId);
        supplyMetric = supplyData.totalSupply;
        supplyMultiplier = supplyData.multiplier;

        // Calculate demand metrics
        const demandData = await this.calculateDemandMetrics(commodity.id, seasonId);
        demandMetric = demandData.totalDemand;
        demandMultiplier = demandData.multiplier;

        // Get trade volume (last 24h)
        tradeVolume = await this.getTradeVolume24h(commodity.id, seasonId);
      }

      const newPrice = calculateDynamicPrice(basePrice, supplyMultiplier, demandMultiplier);

      // Get previous price for result reporting
      const currentPriceRecord = await this.currentPriceRepository.findOne({
        where: { seasonId, commodityId: commodity.id },
      });
      const previousPrice = currentPriceRecord ? parseFloat(currentPriceRecord.price) : basePrice;

      // Update current price
      if (currentPriceRecord) {
        currentPriceRecord.price = newPrice.toFixed(2);
        currentPriceRecord.supplyMultiplier = supplyMultiplier.toFixed(4);
        currentPriceRecord.demandMultiplier = demandMultiplier.toFixed(4);
        currentPriceRecord.lastUpdatedAt = new Date();
        await this.currentPriceRepository.save(currentPriceRecord);
      } else {
        const newRecord = this.currentPriceRepository.create({
          seasonId,
          commodityId: commodity.id,
          price: newPrice.toFixed(2),
          supplyMultiplier: supplyMultiplier.toFixed(4),
          demandMultiplier: demandMultiplier.toFixed(4),
          lastUpdatedAt: new Date(),
        });
        await this.currentPriceRepository.save(newRecord);
      }

      // Record in price history
      const historyEntry = this.commodityPriceRepository.create({
        seasonId,
        commodityId: commodity.id,
        price: newPrice.toFixed(2),
        supplyMultiplier: supplyMultiplier.toFixed(4),
        demandMultiplier: demandMultiplier.toFixed(4),
        supplyMetric: supplyMetric !== null ? supplyMetric.toFixed(2) : null,
        demandMetric: demandMetric !== null ? demandMetric.toFixed(2) : null,
        tradeVolume,
        recordedAt: new Date(),
      });
      await this.commodityPriceRepository.save(historyEntry);

      results.push({
        commodityId: commodity.id,
        commoditySlug: commodity.slug,
        previousPrice,
        newPrice,
        supplyMultiplier,
        demandMultiplier,
      });
    }

    this.logger.log(
      `Recalibrated ${results.length} commodity prices for season ${seasonId} ` +
      `(day ${daysSinceStart}, stabilization: ${isStabilizationPeriod})`,
    );

    return results;
  }

  /**
   * Get price history for a commodity in the current season.
   */
  async getPriceHistory(commodityId: string, seasonId: string): Promise<PriceHistoryEntry[]> {
    const records = await this.commodityPriceRepository.find({
      where: { commodityId, seasonId },
      order: { recordedAt: 'ASC' },
    });

    return records.map((record) => ({
      id: record.id,
      price: parseFloat(record.price),
      supplyMultiplier: parseFloat(record.supplyMultiplier),
      demandMultiplier: parseFloat(record.demandMultiplier),
      supplyMetric: record.supplyMetric !== null ? parseFloat(record.supplyMetric) : null,
      demandMetric: record.demandMetric !== null ? parseFloat(record.demandMetric) : null,
      tradeVolume: record.tradeVolume,
      recordedAt: record.recordedAt,
    }));
  }

  /**
   * Get player leaderboard ranked by net worth (simplified calculation).
   * Uses: cash + inventory market value as a proxy (full net worth requires factory/land/loan data).
   * For a complete implementation, this queries player_seasons and inventory with current prices.
   */
  async getLeaderboard(seasonId: string): Promise<LeaderboardEntry[]> {
    // Get all player seasons with player info
    const playerSeasons = await this.playerSeasonRepository
      .createQueryBuilder('ps')
      .innerJoinAndSelect('ps.player', 'player')
      .where('ps.season_id = :seasonId', { seasonId })
      .getMany();

    // Get all current prices for this season
    const currentPrices = await this.currentPriceRepository.find({
      where: { seasonId },
    });
    const priceMap = new Map(
      currentPrices.map((cp) => [cp.commodityId, parseFloat(cp.price)]),
    );

    // Get all inventory for this season
    const inventories = await this.inventoryRepository.find({
      where: { seasonId },
    });

    // Group inventory by player
    const playerInventoryValue = new Map<string, number>();
    for (const inv of inventories) {
      const price = priceMap.get(inv.commodityId) ?? 0;
      const value = inv.quantity * price;
      const current = playerInventoryValue.get(inv.playerId) ?? 0;
      playerInventoryValue.set(inv.playerId, current + value);
    }

    // Calculate net worth for each player (cash + inventory market value)
    const entries: LeaderboardEntry[] = playerSeasons.map((ps) => {
      const cash = parseFloat(ps.coins);
      const inventoryValue = playerInventoryValue.get(ps.playerId) ?? 0;
      return {
        playerId: ps.playerId,
        displayName: ps.player.displayName,
        netWorth: cash + inventoryValue,
        rank: 0,
      };
    });

    // Sort by net worth descending
    entries.sort((a, b) => b.netWorth - a.netWorth);

    // Assign ranks
    entries.forEach((entry, index) => {
      entry.rank = index + 1;
    });

    return entries;
  }

  /**
   * Get the active season ID.
   */
  async getActiveSeasonId(): Promise<string> {
    const season = await this.seasonRepository.findOne({
      where: { status: SeasonStatus.ACTIVE },
    });

    if (!season) {
      throw new NotFoundException('No active season found');
    }

    return season.id;
  }

  // --- Private helper methods ---

  /**
   * Calculate the number of full days since the season started.
   */
  getDaysSinceSeasonStart(startsAt: Date): number {
    const now = new Date();
    const diffMs = now.getTime() - startsAt.getTime();
    return Math.floor(diffMs / (1000 * 60 * 60 * 24));
  }

  /**
   * Calculate supply metrics for a commodity.
   *
   * Supply = total_production_24h + total_inventory (all players + marketplace queue)
   * supply_multiplier = clamp(2.0 - supply_score, 0.5, 2.0)
   *
   * supply_score uses a baseline of the commodity's base_yield as a reference point.
   * Higher supply → lower multiplier (prices decrease).
   */
  private async calculateSupplyMetrics(
    commodityId: string,
    seasonId: string,
  ): Promise<{ totalSupply: number; multiplier: number }> {
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    // Total production in last 24h (completed production jobs that output this commodity)
    const productionResult = await this.productionJobRepository
      .createQueryBuilder('job')
      .select('COALESCE(SUM(job.units_produced), 0)', 'total')
      .where('job.commodity_id = :commodityId', { commodityId })
      .andWhere('job.season_id = :seasonId', { seasonId })
      .andWhere('job.status IN (:...statuses)', {
        statuses: [ProductionJobStatus.COMPLETED, ProductionJobStatus.ACTIVE],
      })
      .andWhere('job.started_at >= :since', { since: twentyFourHoursAgo })
      .getRawOne();
    const totalProduction24h = parseInt(productionResult?.total ?? '0', 10);

    // Total inventory across all players
    const inventoryResult = await this.inventoryRepository
      .createQueryBuilder('inv')
      .select('COALESCE(SUM(inv.quantity), 0)', 'total')
      .where('inv.commodity_id = :commodityId', { commodityId })
      .andWhere('inv.season_id = :seasonId', { seasonId })
      .getRawOne();
    const totalInventory = parseInt(inventoryResult?.total ?? '0', 10);

    // Total marketplace queue (remaining quantity in active listings)
    const listingResult = await this.marketListingRepository
      .createQueryBuilder('listing')
      .select('COALESCE(SUM(listing.remaining_quantity), 0)', 'total')
      .where('listing.commodity_id = :commodityId', { commodityId })
      .andWhere('listing.season_id = :seasonId', { seasonId })
      .andWhere('listing.status = :status', { status: ListingStatus.ACTIVE })
      .getRawOne();
    const totalListings = parseInt(listingResult?.total ?? '0', 10);

    const totalSupply = totalProduction24h + totalInventory + totalListings;

    // Baseline supply: use a reference point (e.g. 100 units as baseline)
    // This normalizes the supply score. If supply equals baseline, multiplier = 1.0
    const baselineSupply = 100;
    const supplyScore = baselineSupply > 0 ? totalSupply / baselineSupply : 1;

    // Higher supply → lower price: multiplier = 2.0 - supply_score, clamped [0.5, 2.0]
    const multiplier = Math.min(2.0, Math.max(0.5, 2.0 - supplyScore));

    return { totalSupply, multiplier };
  }

  /**
   * Calculate demand metrics for a commodity.
   *
   * Demand = marketplace_purchases_24h + shop_consumption_24h
   * demand_multiplier = clamp(demand_score, 0.5, 2.0)
   *
   * Higher demand → higher multiplier (prices increase).
   */
  private async calculateDemandMetrics(
    commodityId: string,
    seasonId: string,
  ): Promise<{ totalDemand: number; multiplier: number }> {
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    // Marketplace purchases in last 24h
    const tradeResult = await this.marketTradeRepository
      .createQueryBuilder('trade')
      .select('COALESCE(SUM(trade.quantity), 0)', 'total')
      .where('trade.commodity_id = :commodityId', { commodityId })
      .andWhere('trade.season_id = :seasonId', { seasonId })
      .andWhere('trade.traded_at >= :since', { since: twentyFourHoursAgo })
      .getRawOne();
    const marketplacePurchases24h = parseInt(tradeResult?.total ?? '0', 10);

    // Shop consumption in last 24h
    // Note: Shop consumption tracking would typically be recorded via a separate table or log.
    // For now we use marketplace trades as the primary demand signal.
    // When the shop consumption worker is implemented, this can be extended.
    const shopConsumption24h = 0;

    const totalDemand = marketplacePurchases24h + shopConsumption24h;

    // Baseline demand: use a reference point (e.g. 50 units as baseline)
    const baselineDemand = 50;
    const demandScore = baselineDemand > 0 ? totalDemand / baselineDemand : 1;

    // Higher demand → higher price: multiplier = demand_score, clamped [0.5, 2.0]
    const multiplier = Math.min(2.0, Math.max(0.5, demandScore));

    return { totalDemand, multiplier };
  }

  /**
   * Get total trade volume for a commodity in the last 24 hours.
   */
  private async getTradeVolume24h(commodityId: string, seasonId: string): Promise<number> {
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const result = await this.marketTradeRepository
      .createQueryBuilder('trade')
      .select('COALESCE(SUM(trade.quantity), 0)', 'total')
      .where('trade.commodity_id = :commodityId', { commodityId })
      .andWhere('trade.season_id = :seasonId', { seasonId })
      .andWhere('trade.traded_at >= :since', { since: twentyFourHoursAgo })
      .getRawOne();

    return parseInt(result?.total ?? '0', 10);
  }
}
