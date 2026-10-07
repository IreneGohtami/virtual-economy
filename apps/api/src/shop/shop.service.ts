import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, EntityManager } from 'typeorm';
import { ShopType, TransactionType, SeasonStatus } from '@sea-commodity-tycoon/shared-types';
import { Shop } from '../entities/shop.entity';
import { ShopInventory } from '../entities/shop-inventory.entity';
import { ShopAcceptedCommodity } from '../entities/shop-accepted-commodity.entity';
import { MapTile } from '../entities/map-tile.entity';
import { CurrentPrice } from '../entities/current-price.entity';
import { Season } from '../entities/season.entity';
import { Commodity } from '../entities/commodity.entity';
import { WalletService } from '../wallet/wallet.service';
import { InventoryService } from '../inventory/inventory.service';

/**
 * Shop configuration loaded from recipe-config.json (hard-coded for now as constants).
 * In production, these would be loaded from the GameConfig / config package.
 */
export interface ShopConfig {
  type: ShopType;
  setupCost: number;
  storageCapacity: number;
  demandRatePerHour: number;
  revenueMultiplier: number;
  minTypesRequired: number;
}

export const SHOP_CONFIGS: Record<ShopType, ShopConfig> = {
  [ShopType.SUPERMARKET]: {
    type: ShopType.SUPERMARKET,
    setupCost: 500,
    storageCapacity: 200,
    demandRatePerHour: 3,
    revenueMultiplier: 1.2,
    minTypesRequired: 2,
  },
  [ShopType.BUTCHER]: {
    type: ShopType.BUTCHER,
    setupCost: 350,
    storageCapacity: 100,
    demandRatePerHour: 2,
    revenueMultiplier: 1.3,
    minTypesRequired: 1,
  },
  [ShopType.CAFE]: {
    type: ShopType.CAFE,
    setupCost: 400,
    storageCapacity: 50,
    demandRatePerHour: 2,
    revenueMultiplier: 1.5,
    minTypesRequired: 1,
  },
  [ShopType.PETROL_STATION]: {
    type: ShopType.PETROL_STATION,
    setupCost: 600,
    storageCapacity: 150,
    demandRatePerHour: 4,
    revenueMultiplier: 1.1,
    minTypesRequired: 1,
  },
  [ShopType.FURNITURE]: {
    type: ShopType.FURNITURE,
    setupCost: 450,
    storageCapacity: 80,
    demandRatePerHour: 1,
    revenueMultiplier: 1.4,
    minTypesRequired: 1,
  },
  [ShopType.ELECTRONICS]: {
    type: ShopType.ELECTRONICS,
    setupCost: 800,
    storageCapacity: 50,
    demandRatePerHour: 1,
    revenueMultiplier: 1.6,
    minTypesRequired: 1,
  },
  [ShopType.CAR_STORE]: {
    type: ShopType.CAR_STORE,
    setupCost: 1000,
    storageCapacity: 30,
    demandRatePerHour: 0.5,
    revenueMultiplier: 1.8,
    minTypesRequired: 1,
  },
};

export interface ShopRevenueResult {
  shopId: string;
  totalRevenue: number;
  commoditiesConsumed: { commodityId: string; quantity: number; revenue: number }[];
}

@Injectable()
export class ShopService {
  private readonly logger = new Logger(ShopService.name);

  constructor(
    @InjectRepository(Shop)
    private readonly shopRepository: Repository<Shop>,
    @InjectRepository(ShopInventory)
    private readonly shopInventoryRepository: Repository<ShopInventory>,
    @InjectRepository(ShopAcceptedCommodity)
    private readonly shopAcceptedCommodityRepository: Repository<ShopAcceptedCommodity>,
    @InjectRepository(MapTile)
    private readonly mapTileRepository: Repository<MapTile>,
    @InjectRepository(CurrentPrice)
    private readonly currentPriceRepository: Repository<CurrentPrice>,
    @InjectRepository(Season)
    private readonly seasonRepository: Repository<Season>,
    @InjectRepository(Commodity)
    private readonly commodityRepository: Repository<Commodity>,
    private readonly walletService: WalletService,
    private readonly inventoryService: InventoryService,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Construct a new shop on a CITY tile owned by the player.
   */
  async construct(playerId: string, dto: { tileId: string; shopType: ShopType }): Promise<Shop> {
    const seasonId = await this.getActiveSeasonId();
    const config = SHOP_CONFIGS[dto.shopType];

    if (!config) {
      throw new BadRequestException(`Invalid shop type: ${dto.shopType}`);
    }

    return this.dataSource.transaction(async (manager: EntityManager) => {
      // 1. Validate tile: must be CITY terrain, owned by player, unoccupied by shop or factory
      const tile = await manager.findOne(MapTile, {
        where: { id: dto.tileId, seasonId },
      });

      if (!tile) {
        throw new NotFoundException(`Tile ${dto.tileId} not found in current season`);
      }

      if (tile.terrainType !== 'CITY') {
        throw new BadRequestException('Shops can only be constructed on CITY terrain tiles');
      }

      if (tile.ownerPlayerId !== playerId) {
        throw new ForbiddenException('You do not own this tile');
      }

      if (tile.factoryId) {
        throw new BadRequestException('This tile is already occupied by a factory');
      }

      // Check if tile is already used by another shop
      const existingShop = await manager.findOne(Shop, {
        where: { tileId: dto.tileId, seasonId },
      });

      if (existingShop) {
        throw new BadRequestException('This tile is already occupied by a shop');
      }

      // 2. Deduct setup cost via wallet
      await this.walletService.executeTransactionWithManager(
        manager,
        playerId,
        seasonId,
        TransactionType.FACTORY_PURCHASE,
        -config.setupCost,
        {
          referenceType: 'shop_construction',
          description: `Constructed ${dto.shopType} shop`,
        },
      );

      // 3. Create the shop
      const shop = manager.create(Shop, {
        playerId,
        seasonId,
        tileId: dto.tileId,
        shopType: dto.shopType,
        level: 1,
        storageCapacity: config.storageCapacity,
        demandRate: config.demandRatePerHour.toFixed(2),
      });

      const savedShop = await manager.save(Shop, shop);

      this.logger.log(
        `Shop constructed: player=${playerId}, type=${dto.shopType}, tile=${dto.tileId}, cost=${config.setupCost}`,
      );

      return savedShop;
    });
  }

  /**
   * Stock a shop with commodities from player inventory.
   * Validates the shop accepts the commodity and has capacity.
   */
  async stockShop(
    playerId: string,
    shopId: string,
    commodityId: string,
    quantity: number,
  ): Promise<ShopInventory> {
    const seasonId = await this.getActiveSeasonId();

    // Validate shop exists and belongs to player
    const shop = await this.shopRepository.findOne({
      where: { id: shopId, playerId, seasonId },
    });

    if (!shop) {
      throw new NotFoundException(`Shop ${shopId} not found or not owned by player`);
    }

    // Validate commodity is accepted by this shop type
    const accepted = await this.shopAcceptedCommodityRepository.findOne({
      where: { shopType: shop.shopType, commodityId },
    });

    if (!accepted) {
      throw new BadRequestException(
        `This shop type (${shop.shopType}) does not accept commodity ${commodityId}`,
      );
    }

    // Check shop storage capacity
    const currentStock = await this.getShopTotalStock(shopId);
    if (currentStock + quantity > shop.storageCapacity) {
      throw new BadRequestException(
        `Insufficient shop storage. Current: ${currentStock}, adding: ${quantity}, capacity: ${shop.storageCapacity}`,
      );
    }

    // Transfer from player inventory to shop
    return this.dataSource.transaction(async (manager: EntityManager) => {
      // Remove from player inventory
      await this.inventoryService.removeFromInventoryWithManager(
        manager,
        playerId,
        seasonId,
        commodityId,
        quantity,
      );

      // Add to shop inventory (upsert)
      const existing = await manager.findOne(ShopInventory, {
        where: { shopId, commodityId },
      });

      if (existing) {
        existing.quantity += quantity;
        return manager.save(ShopInventory, existing);
      }

      const newInventory = manager.create(ShopInventory, {
        shopId,
        commodityId,
        quantity,
      });
      return manager.save(ShopInventory, newInventory);
    });
  }

  /**
   * Process consumption for a shop: consume inventory at demand rate, generate revenue.
   * Called by the shop.consumption BullMQ worker hourly.
   *
   * Revenue formula: demand_rate × (market_price × 1.20) × revenue_multiplier per consumed unit
   */
  async processConsumption(shopId: string): Promise<ShopRevenueResult> {
    const shop = await this.shopRepository.findOne({
      where: { id: shopId },
      relations: ['shopInventories'],
    });

    if (!shop) {
      throw new NotFoundException(`Shop ${shopId} not found`);
    }

    const config = SHOP_CONFIGS[shop.shopType];
    const seasonId = shop.seasonId;

    // Check minimum stocking requirements
    const stockedTypes = shop.shopInventories.filter((si) => si.quantity > 0).length;
    if (stockedTypes < config.minTypesRequired) {
      this.logger.log(
        `Shop ${shopId} paused: stocked ${stockedTypes} types, requires ${config.minTypesRequired}`,
      );
      return { shopId, totalRevenue: 0, commoditiesConsumed: [] };
    }

    const demandRate = parseFloat(shop.demandRate);
    const commoditiesConsumed: { commodityId: string; quantity: number; revenue: number }[] = [];
    let totalRevenue = 0;

    // Process consumption for each stocked commodity
    for (const inventory of shop.shopInventories) {
      if (inventory.quantity <= 0) continue;

      // Consume up to demand_rate units per hour per commodity type
      const consumed = Math.min(inventory.quantity, Math.floor(demandRate));
      if (consumed <= 0) continue;

      // Get current market price for this commodity
      const currentPrice = await this.currentPriceRepository.findOne({
        where: { seasonId, commodityId: inventory.commodityId },
      });

      if (!currentPrice) continue;

      const marketPrice = parseFloat(currentPrice.price);

      // Revenue = demand_rate_consumed × (market_price × 1.20) × revenue_multiplier
      const revenue = consumed * (marketPrice * 1.20) * config.revenueMultiplier;
      totalRevenue += revenue;

      commoditiesConsumed.push({
        commodityId: inventory.commodityId,
        quantity: consumed,
        revenue,
      });

      // Reduce shop inventory
      inventory.quantity -= consumed;
      await this.shopInventoryRepository.save(inventory);
    }

    // Credit revenue to player wallet
    if (totalRevenue > 0) {
      await this.walletService.executeTransaction(
        shop.playerId,
        seasonId,
        TransactionType.SHOP_REVENUE,
        totalRevenue,
        {
          referenceType: 'shop',
          referenceId: shopId,
          description: `Revenue from ${shop.shopType} shop`,
        },
      );

      this.logger.log(
        `Shop ${shopId} generated revenue: ${totalRevenue.toFixed(2)} coins`,
      );
    }

    return { shopId, totalRevenue, commoditiesConsumed };
  }

  /**
   * Deconstruct a shop: charge 25% fee, release CITY tile.
   */
  async deconstruct(playerId: string, shopId: string): Promise<{ fee: number }> {
    const seasonId = await this.getActiveSeasonId();

    const shop = await this.shopRepository.findOne({
      where: { id: shopId, playerId, seasonId },
    });

    if (!shop) {
      throw new NotFoundException(`Shop ${shopId} not found or not owned by player`);
    }

    const config = SHOP_CONFIGS[shop.shopType];
    const fee = config.setupCost * 0.25;

    return this.dataSource.transaction(async (manager: EntityManager) => {
      // Charge deconstruction fee
      await this.walletService.executeTransactionWithManager(
        manager,
        playerId,
        seasonId,
        TransactionType.SHOP_DECONSTRUCTION,
        -fee,
        {
          referenceType: 'shop',
          referenceId: shopId,
          description: `Deconstructed ${shop.shopType} shop (25% fee)`,
        },
      );

      // Remove shop inventory records
      await manager.delete(ShopInventory, { shopId });

      // Remove the shop
      await manager.remove(Shop, shop);

      this.logger.log(
        `Shop deconstructed: player=${playerId}, type=${shop.shopType}, fee=${fee}`,
      );

      return { fee };
    });
  }

  /**
   * Get all shops for a player in the current season.
   */
  async getShops(playerId: string): Promise<Shop[]> {
    const seasonId = await this.getActiveSeasonId();

    return this.shopRepository.find({
      where: { playerId, seasonId },
      relations: ['shopInventories', 'tile'],
    });
  }

  /**
   * Get revenue info for a shop (current stock, revenue potential per hour).
   */
  async getRevenue(playerId: string, shopId: string): Promise<{
    shopId: string;
    shopType: ShopType;
    revenuePerHour: number;
    isPaused: boolean;
    stockedTypes: number;
    minTypesRequired: number;
    commodities: { commodityId: string; quantity: number; revenuePerHour: number }[];
  }> {
    const seasonId = await this.getActiveSeasonId();

    const shop = await this.shopRepository.findOne({
      where: { id: shopId, playerId, seasonId },
      relations: ['shopInventories'],
    });

    if (!shop) {
      throw new NotFoundException(`Shop ${shopId} not found or not owned by player`);
    }

    const config = SHOP_CONFIGS[shop.shopType];
    const demandRate = parseFloat(shop.demandRate);
    const stockedTypes = shop.shopInventories.filter((si) => si.quantity > 0).length;
    const isPaused = stockedTypes < config.minTypesRequired;

    let totalRevenuePerHour = 0;
    const commodities: { commodityId: string; quantity: number; revenuePerHour: number }[] = [];

    if (!isPaused) {
      for (const inventory of shop.shopInventories) {
        if (inventory.quantity <= 0) continue;

        const currentPrice = await this.currentPriceRepository.findOne({
          where: { seasonId, commodityId: inventory.commodityId },
        });

        if (!currentPrice) continue;

        const marketPrice = parseFloat(currentPrice.price);
        const consumed = Math.min(inventory.quantity, Math.floor(demandRate));
        const revenuePerHour = consumed * (marketPrice * 1.20) * config.revenueMultiplier;
        totalRevenuePerHour += revenuePerHour;

        commodities.push({
          commodityId: inventory.commodityId,
          quantity: inventory.quantity,
          revenuePerHour,
        });
      }
    }

    return {
      shopId,
      shopType: shop.shopType,
      revenuePerHour: totalRevenuePerHour,
      isPaused,
      stockedTypes,
      minTypesRequired: config.minTypesRequired,
      commodities,
    };
  }

  // --- Private helper methods ---

  private async getShopTotalStock(shopId: string): Promise<number> {
    const result = await this.shopInventoryRepository
      .createQueryBuilder('si')
      .select('COALESCE(SUM(si.quantity), 0)', 'total')
      .where('si.shop_id = :shopId', { shopId })
      .getRawOne();

    return parseInt(result?.total ?? '0', 10);
  }

  private async getActiveSeasonId(): Promise<string> {
    const season = await this.seasonRepository.findOne({
      where: { status: SeasonStatus.ACTIVE },
    });

    if (!season) {
      throw new NotFoundException('No active season found');
    }

    return season.id;
  }
}
