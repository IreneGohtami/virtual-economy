import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, EntityManager } from 'typeorm';
import {
  ListingStatus,
  TransactionType,
  SeasonStatus,
} from '@sea-commodity-tycoon/shared-types';
import { calculateInstantSellAmount } from '@sea-commodity-tycoon/game-rules';
import { MarketListing } from '../entities/market-listing.entity';
import { MarketTrade } from '../entities/market-trade.entity';
import { CurrentPrice } from '../entities/current-price.entity';
import { Season } from '../entities/season.entity';
import { InventoryService } from '../inventory/inventory.service';
import { WalletService } from '../wallet/wallet.service';
import { ProductionService } from '../production/production.service';

export interface QueueInfo {
  commodityId: string;
  seasonId: string;
  totalListings: number;
  totalQuantity: number;
  currentPrice: number;
}

export interface PriceInfo {
  commodityId: string;
  price: number;
  supplyMultiplier: number;
  demandMultiplier: number;
  lastUpdatedAt: Date;
}

export interface TradeResult {
  trades: {
    tradeId: string;
    listingId: string;
    sellerId: string;
    quantity: number;
    pricePerUnit: number;
    totalPrice: number;
  }[];
  totalQuantityFilled: number;
  totalCost: number;
}

export interface ListingResult {
  id: string;
  commodityId: string;
  quantity: number;
  remainingQuantity: number;
  listedAt: Date;
  status: ListingStatus;
}

export interface InstantSellResult {
  amount: number;
  pricePerUnit: number;
  quantity: number;
}

@Injectable()
export class MarketplaceService {
  private readonly logger = new Logger(MarketplaceService.name);

  constructor(
    @InjectRepository(MarketListing)
    private readonly listingRepository: Repository<MarketListing>,
    @InjectRepository(MarketTrade)
    private readonly tradeRepository: Repository<MarketTrade>,
    @InjectRepository(CurrentPrice)
    private readonly currentPriceRepository: Repository<CurrentPrice>,
    @InjectRepository(Season)
    private readonly seasonRepository: Repository<Season>,
    private readonly inventoryService: InventoryService,
    private readonly walletService: WalletService,
    private readonly productionService: ProductionService,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * List a commodity for sale on the marketplace.
   * Removes quantity from player's inventory and creates an ACTIVE listing.
   */
  async listForSale(
    playerId: string,
    seasonId: string,
    commodityId: string,
    quantity: number,
  ): Promise<ListingResult> {
    if (quantity <= 0) {
      throw new BadRequestException('Quantity must be positive');
    }

    return this.dataSource.transaction(async (manager: EntityManager) => {
      // Remove from player's inventory (validates sufficient quantity)
      await this.inventoryService.removeFromInventoryWithManager(
        manager,
        playerId,
        seasonId,
        commodityId,
        quantity,
      );

      // Create the marketplace listing
      const listing = manager.create(MarketListing, {
        playerId,
        seasonId,
        commodityId,
        quantity,
        remainingQuantity: quantity,
        status: ListingStatus.ACTIVE,
        listedAt: new Date(),
      });

      const saved = await manager.save(MarketListing, listing);

      this.logger.log(
        `Listing created: player=${playerId}, commodity=${commodityId}, qty=${quantity}, listing=${saved.id}`,
      );

      return {
        id: saved.id,
        commodityId: saved.commodityId,
        quantity: saved.quantity,
        remainingQuantity: saved.remainingQuantity,
        listedAt: saved.listedAt,
        status: saved.status,
      };
    });
  }

  /**
   * Purchase a commodity from the marketplace using FIFO ordering.
   * Locks earliest listings, fills them in order, transfers coins and inventory.
   * All transactions execute at the current global market price.
   */
  async purchase(
    buyerId: string,
    seasonId: string,
    commodityId: string,
    quantity: number,
  ): Promise<TradeResult> {
    if (quantity <= 0) {
      throw new BadRequestException('Quantity must be positive');
    }

    return this.dataSource.transaction(async (manager: EntityManager) => {
      // 1. Get current market price
      const currentPrice = await manager.findOne(CurrentPrice, {
        where: { seasonId, commodityId },
      });

      if (!currentPrice) {
        throw new NotFoundException(
          `No market price found for commodity ${commodityId} in current season`,
        );
      }

      const pricePerUnit = parseFloat(currentPrice.price);

      // 2. Lock earliest ACTIVE listings for this commodity (FIFO order)
      const listings = await manager
        .createQueryBuilder(MarketListing, 'listing')
        .setLock('pessimistic_write')
        .where('listing.commodity_id = :commodityId', { commodityId })
        .andWhere('listing.season_id = :seasonId', { seasonId })
        .andWhere('listing.status = :status', { status: ListingStatus.ACTIVE })
        .andWhere('listing.player_id != :buyerId', { buyerId })
        .orderBy('listing.listed_at', 'ASC')
        .getMany();

      // Calculate total available quantity
      const totalAvailable = listings.reduce(
        (sum, l) => sum + l.remainingQuantity,
        0,
      );

      if (totalAvailable === 0) {
        throw new BadRequestException(
          `No listings available for commodity ${commodityId}`,
        );
      }

      if (totalAvailable < quantity) {
        throw new BadRequestException(
          `Insufficient marketplace supply. Requested: ${quantity}, available: ${totalAvailable}`,
        );
      }

      // 3. Iterate through listings in FIFO order, filling as needed
      let remainingToBuy = quantity;
      const trades: TradeResult['trades'] = [];
      let totalCost = 0;

      for (const listing of listings) {
        if (remainingToBuy <= 0) break;

        const fillQuantity = Math.min(listing.remainingQuantity, remainingToBuy);
        const tradeCost = pricePerUnit * fillQuantity;

        // Reduce listing remaining quantity
        listing.remainingQuantity -= fillQuantity;

        // Mark as FILLED if fully consumed
        if (listing.remainingQuantity === 0) {
          listing.status = ListingStatus.FILLED;
          listing.filledAt = new Date();
        }

        await manager.save(MarketListing, listing);

        // Deduct coins from buyer
        await this.walletService.executeTransactionWithManager(
          manager,
          buyerId,
          seasonId,
          TransactionType.MARKETPLACE_SALE,
          -tradeCost,
          {
            referenceType: 'marketplace_purchase',
            referenceId: listing.id,
            description: `Purchase ${fillQuantity} units at ${pricePerUnit}/unit`,
          },
        );

        // Credit coins to seller
        await this.walletService.executeTransactionWithManager(
          manager,
          listing.playerId,
          seasonId,
          TransactionType.MARKETPLACE_SALE,
          tradeCost,
          {
            referenceType: 'marketplace_sale',
            referenceId: listing.id,
            description: `Sold ${fillQuantity} units at ${pricePerUnit}/unit`,
          },
        );

        // Record the trade
        const trade = manager.create(MarketTrade, {
          seasonId,
          listingId: listing.id,
          buyerId,
          sellerId: listing.playerId,
          commodityId,
          quantity: fillQuantity,
          pricePerUnit: pricePerUnit.toFixed(2),
          totalPrice: tradeCost.toFixed(2),
          tradedAt: new Date(),
        });

        const savedTrade = await manager.save(MarketTrade, trade);

        trades.push({
          tradeId: savedTrade.id,
          listingId: listing.id,
          sellerId: listing.playerId,
          quantity: fillQuantity,
          pricePerUnit,
          totalPrice: tradeCost,
        });

        totalCost += tradeCost;
        remainingToBuy -= fillQuantity;
      }

      // 4. Add commodity to buyer's inventory
      await this.inventoryService.addToInventoryWithManager(
        manager,
        buyerId,
        seasonId,
        commodityId,
        quantity,
      );

      this.logger.log(
        `Purchase completed: buyer=${buyerId}, commodity=${commodityId}, qty=${quantity}, cost=${totalCost.toFixed(2)}, trades=${trades.length}`,
      );

      // 5. Log WebSocket events (placeholder until NotificationModule is wired)
      this.logger.log(
        `[WS Event] marketplace.trade: commodity=${commodityId}, quantity=${quantity}, price=${pricePerUnit}`,
      );
      this.logger.log(
        `[WS Event] marketplace.price_update: commodity=${commodityId}, price=${pricePerUnit}`,
      );

      return {
        trades,
        totalQuantityFilled: quantity,
        totalCost,
      };
    }).then(async (result) => {
      // After transaction commits, trigger production resume check for buyer
      // (inventory increased so paused production may be able to resume)
      try {
        await this.productionService.checkAndResumeForPlayer(buyerId, seasonId);
      } catch (error) {
        this.logger.warn(
          `Failed to trigger production resume check after purchase: ${error}`,
        );
      }
      return result;
    });
  }

  /**
   * Cancel an active listing. Returns remaining quantity to seller's inventory.
   */
  async cancelListing(
    playerId: string,
    seasonId: string,
    listingId: string,
  ): Promise<{ returnedQuantity: number }> {
    return this.dataSource.transaction(async (manager: EntityManager) => {
      // Lock and fetch the listing
      const listing = await manager
        .createQueryBuilder(MarketListing, 'listing')
        .setLock('pessimistic_write')
        .where('listing.id = :listingId', { listingId })
        .getOne();

      if (!listing) {
        throw new NotFoundException(`Listing ${listingId} not found`);
      }

      if (listing.playerId !== playerId) {
        throw new ForbiddenException('You can only cancel your own listings');
      }

      if (listing.status !== ListingStatus.ACTIVE) {
        throw new BadRequestException(
          `Listing is not active (current status: ${listing.status})`,
        );
      }

      const returnedQuantity = listing.remainingQuantity;

      // Mark listing as cancelled
      listing.status = ListingStatus.CANCELLED;
      listing.cancelledAt = new Date();
      await manager.save(MarketListing, listing);

      // Return remaining quantity to player's inventory
      await this.inventoryService.addToInventoryWithManager(
        manager,
        playerId,
        seasonId,
        listing.commodityId,
        returnedQuantity,
      );

      this.logger.log(
        `Listing cancelled: listing=${listingId}, player=${playerId}, returned=${returnedQuantity}`,
      );

      return { returnedQuantity };
    }).then(async (result) => {
      // After transaction commits, trigger production resume check
      try {
        await this.productionService.checkAndResumeForPlayer(playerId, seasonId);
      } catch (error) {
        this.logger.warn(
          `Failed to trigger production resume check after cancel: ${error}`,
        );
      }
      return result;
    });
  }

  /**
   * Instant sell commodities at 90% of the current market price.
   * Independent from the FIFO marketplace queue.
   * Atomically removes from inventory and credits wallet.
   */
  async instantSell(
    playerId: string,
    seasonId: string,
    commodityId: string,
    quantity: number,
  ): Promise<InstantSellResult> {
    if (quantity <= 0) {
      throw new BadRequestException('Quantity must be positive');
    }

    // Get current market price
    const currentPrice = await this.currentPriceRepository.findOne({
      where: { seasonId, commodityId },
    });

    if (!currentPrice) {
      throw new NotFoundException(
        `No market price found for commodity ${commodityId} in current season`,
      );
    }

    const marketPrice = parseFloat(currentPrice.price);
    const amount = calculateInstantSellAmount(marketPrice, quantity);

    await this.dataSource.transaction(async (manager: EntityManager) => {
      // Remove from inventory (validates sufficient quantity)
      await this.inventoryService.removeFromInventoryWithManager(
        manager,
        playerId,
        seasonId,
        commodityId,
        quantity,
      );

      // Credit wallet with INSTANT_SELL transaction
      await this.walletService.executeTransactionWithManager(
        manager,
        playerId,
        seasonId,
        TransactionType.INSTANT_SELL,
        amount,
        {
          referenceType: 'instant_sell',
          referenceId: commodityId,
          description: `Instant sell ${quantity} units at ${(marketPrice * 0.90).toFixed(2)}/unit (90% of market price ${marketPrice.toFixed(2)})`,
        },
      );
    });

    this.logger.log(
      `Instant sell completed: player=${playerId}, commodity=${commodityId}, qty=${quantity}, amount=${amount.toFixed(2)}`,
    );

    // Trigger production resume check (inventory freed up)
    try {
      await this.productionService.checkAndResumeForPlayer(playerId, seasonId);
    } catch (error) {
      this.logger.warn(`Failed to trigger production resume check after instant sell: ${error}`);
    }

    return {
      amount,
      pricePerUnit: marketPrice * 0.90,
      quantity,
    };
  }

  /**
   * Get queue info for a specific commodity in the current season.
   */
  async getQueueInfo(commodityId: string, seasonId: string): Promise<QueueInfo> {
    // Get active listings count and total quantity
    const queueData = await this.listingRepository
      .createQueryBuilder('listing')
      .select('COUNT(*)', 'totalListings')
      .addSelect('COALESCE(SUM(listing.remaining_quantity), 0)', 'totalQuantity')
      .where('listing.commodity_id = :commodityId', { commodityId })
      .andWhere('listing.season_id = :seasonId', { seasonId })
      .andWhere('listing.status = :status', { status: ListingStatus.ACTIVE })
      .getRawOne();

    // Get current price
    const currentPrice = await this.currentPriceRepository.findOne({
      where: { seasonId, commodityId },
    });

    return {
      commodityId,
      seasonId,
      totalListings: parseInt(queueData?.totalListings ?? '0', 10),
      totalQuantity: parseInt(queueData?.totalQuantity ?? '0', 10),
      currentPrice: currentPrice ? parseFloat(currentPrice.price) : 0,
    };
  }

  /**
   * Get all current prices for a season.
   */
  async getAllPrices(seasonId: string): Promise<PriceInfo[]> {
    const prices = await this.currentPriceRepository.find({
      where: { seasonId },
    });

    return prices.map((p) => ({
      commodityId: p.commodityId,
      price: parseFloat(p.price),
      supplyMultiplier: parseFloat(p.supplyMultiplier),
      demandMultiplier: parseFloat(p.demandMultiplier),
      lastUpdatedAt: p.lastUpdatedAt,
    }));
  }

  /**
   * Get a player's active listings.
   */
  async getPlayerListings(
    playerId: string,
    seasonId: string,
  ): Promise<ListingResult[]> {
    const listings = await this.listingRepository.find({
      where: { playerId, seasonId, status: ListingStatus.ACTIVE },
      order: { listedAt: 'DESC' },
    });

    return listings.map((l) => ({
      id: l.id,
      commodityId: l.commodityId,
      quantity: l.quantity,
      remainingQuantity: l.remainingQuantity,
      listedAt: l.listedAt,
      status: l.status,
    }));
  }

  /**
   * Get the currently active season ID.
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

  /**
   * Get all active listings grouped by commodity, with player display names.
   */
  async getAllActiveListings(seasonId: string): Promise<unknown[]> {
    const listings = await this.listingRepository.find({
      where: { seasonId, status: ListingStatus.ACTIVE },
      relations: ['commodity'],
      order: { commodityId: 'ASC', listedAt: 'ASC' },
    });

    // Get player names
    const playerIds = [...new Set(listings.map(l => l.playerId))];
    let playerNames: Record<string, string> = {};
    if (playerIds.length > 0) {
      const { DataSource } = require('typeorm');
      // Use a raw query for player names since we don't have Player repo here
      const rawResults = await this.dataSource.query(
        `SELECT id, display_name FROM players WHERE id = ANY($1)`,
        [playerIds],
      );
      for (const row of rawResults) {
        playerNames[row.id] = row.display_name;
      }
    }

    // Build grouped result
    const grouped: Record<string, { commodity: string; commodityId: string; currentPrice: number; listings: unknown[] }> = {};

    for (const entity of listings) {
      const commodityName = entity.commodity?.name || 'Unknown';
      const commodityId = entity.commodityId;

      if (!grouped[commodityId]) {
        const price = await this.currentPriceRepository.findOne({
          where: { seasonId, commodityId },
        });
        grouped[commodityId] = {
          commodity: commodityName,
          commodityId,
          currentPrice: price ? parseFloat(price.price) : 0,
          listings: [],
        };
      }

      grouped[commodityId].listings.push({
        id: entity.id,
        playerId: entity.playerId,
        playerName: playerNames[entity.playerId] || 'Unknown',
        quantity: entity.quantity,
        remainingQuantity: entity.remainingQuantity,
        listedAt: entity.listedAt,
        queuePosition: grouped[commodityId].listings.length + 1,
      });
    }

    return Object.values(grouped);
  }

}
