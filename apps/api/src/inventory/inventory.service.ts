import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Repository, DataSource, EntityManager } from 'typeorm';
import { Queue } from 'bullmq';
import { TransactionType, SeasonStatus } from '@sea-commodity-tycoon/shared-types';
import { Inventory } from '../entities/inventory.entity';
import { Commodity } from '../entities/commodity.entity';
import { CurrentPrice } from '../entities/current-price.entity';
import { PlayerSeason } from '../entities/player-season.entity';
import { Season } from '../entities/season.entity';
import { WalletService } from '../wallet/wallet.service';
import { QUEUE_NAMES } from '../queue/queue.module';

/**
 * Storage upgrade tiers: capacity → cost to upgrade TO that tier.
 * 500 is the default (free). Subsequent tiers have fixed costs.
 */
export const STORAGE_TIERS: { capacity: number; cost: number }[] = [
  { capacity: 500, cost: 0 },
  { capacity: 750, cost: 250 },
  { capacity: 1000, cost: 500 },
  { capacity: 1500, cost: 1000 },
  { capacity: 2000, cost: 2000 },
  { capacity: 3000, cost: 4000 },
  { capacity: 5000, cost: 8000 },
];

export interface StorageUsage {
  used: number;
  capacity: number;
  available: number;
}

export interface StorageTierInfo {
  capacity: number;
  cost: number;
  current: boolean;
  available: boolean;
}

export interface InventoryItem {
  id: string;
  commodityId: string;
  commodityName: string;
  commoditySlug: string;
  category: string;
  quantity: number;
  storageSize: number;
  totalStorageUsed: number;
}

@Injectable()
export class InventoryService {
  private readonly logger = new Logger(InventoryService.name);

  constructor(
    @InjectRepository(Inventory)
    private readonly inventoryRepository: Repository<Inventory>,
    @InjectRepository(Commodity)
    private readonly commodityRepository: Repository<Commodity>,
    @InjectRepository(PlayerSeason)
    private readonly playerSeasonRepository: Repository<PlayerSeason>,
    @InjectRepository(Season)
    private readonly seasonRepository: Repository<Season>,
    private readonly walletService: WalletService,
    private readonly dataSource: DataSource,
    @InjectQueue(QUEUE_NAMES.PRODUCTION)
    private readonly productionQueue: Queue,
  ) {}

  /**
   * Get all inventory items for a player in a season, with commodity details.
   */
  async getInventory(playerId: string, seasonId: string): Promise<InventoryItem[]> {
    const items = await this.inventoryRepository.find({
      where: { playerId, seasonId },
      relations: ['commodity'],
    });

    // Fetch current prices for all commodities
    const currentPrices = await this.dataSource
      .getRepository(CurrentPrice)
      .find({ where: { seasonId } });
    const priceMap = new Map(currentPrices.map((cp) => [cp.commodityId, parseFloat(cp.price)]));

    return items
      .filter((item) => item.quantity > 0)
      .map((item) => ({
        id: item.id,
        commodityId: item.commodityId,
        commodityName: item.commodity.name,
        commoditySlug: item.commodity.slug,
        category: item.commodity.category,
        quantity: item.quantity,
        storageSize: item.commodity.storageSize,
        totalStorageUsed: item.quantity * item.commodity.storageSize,
        marketPrice: Math.round(priceMap.get(item.commodityId) ?? parseFloat(String(item.commodity.basePrice)) ?? 0),
      }));
  }

  /**
   * Add quantity of a commodity to a player's inventory.
   * Validates storage capacity is not exceeded.
   *
   * @throws BadRequestException if addition would exceed storage capacity
   */
  async addToInventory(
    playerId: string,
    seasonId: string,
    commodityId: string,
    quantity: number,
  ): Promise<Inventory> {
    if (quantity <= 0) {
      throw new BadRequestException('Quantity must be positive');
    }

    return this.dataSource.transaction(async (manager: EntityManager) => {
      return this.addToInventoryWithManager(manager, playerId, seasonId, commodityId, quantity);
    });
  }

  /**
   * Add to inventory within an existing transaction (for use by other modules).
   */
  async addToInventoryWithManager(
    manager: EntityManager,
    playerId: string,
    seasonId: string,
    commodityId: string,
    quantity: number,
  ): Promise<Inventory> {
    if (quantity <= 0) {
      throw new BadRequestException('Quantity must be positive');
    }

    // Fetch the commodity's storageSize
    const commodity = await manager.findOne(Commodity, {
      where: { id: commodityId },
    });
    if (!commodity) {
      throw new NotFoundException(`Commodity ${commodityId} not found`);
    }

    // Get player's storage capacity
    const playerSeason = await manager.findOne(PlayerSeason, {
      where: { playerId, seasonId },
    });
    if (!playerSeason) {
      throw new NotFoundException(`PlayerSeason not found for player ${playerId}`);
    }

    // Calculate current storage usage
    const currentUsage = await this.calculateStorageUsageWithManager(manager, playerId, seasonId);

    // Check if adding would exceed capacity
    const additionalStorage = quantity * commodity.storageSize;
    if (currentUsage + additionalStorage > playerSeason.storageCapacity) {
      throw new BadRequestException(
        `Insufficient storage capacity. Current usage: ${currentUsage}, ` +
        `adding: ${additionalStorage}, capacity: ${playerSeason.storageCapacity}`,
      );
    }

    // Upsert inventory record (increment if exists, create if not)
    const existing = await manager.findOne(Inventory, {
      where: { playerId, seasonId, commodityId },
    });

    if (existing) {
      existing.quantity += quantity;
      return manager.save(Inventory, existing);
    }

    const newInventory = manager.create(Inventory, {
      playerId,
      seasonId,
      commodityId,
      quantity,
    });
    return manager.save(Inventory, newInventory);
  }

  /**
   * Remove quantity of a commodity from a player's inventory.
   *
   * @throws BadRequestException if player doesn't have sufficient quantity
   */
  async removeFromInventory(
    playerId: string,
    seasonId: string,
    commodityId: string,
    quantity: number,
  ): Promise<Inventory> {
    if (quantity <= 0) {
      throw new BadRequestException('Quantity must be positive');
    }

    const result = await this.dataSource.transaction(async (manager: EntityManager) => {
      return this.removeFromInventoryWithManager(manager, playerId, seasonId, commodityId, quantity);
    });

    // Inventory decreased — trigger production resume check
    await this.emitProductionCheckResume(playerId, seasonId);

    return result;
  }

  /**
   * Remove from inventory within an existing transaction (for use by other modules).
   */
  async removeFromInventoryWithManager(
    manager: EntityManager,
    playerId: string,
    seasonId: string,
    commodityId: string,
    quantity: number,
  ): Promise<Inventory> {
    if (quantity <= 0) {
      throw new BadRequestException('Quantity must be positive');
    }

    const existing = await manager.findOne(Inventory, {
      where: { playerId, seasonId, commodityId },
    });

    if (!existing || existing.quantity < quantity) {
      const available = existing?.quantity ?? 0;
      throw new BadRequestException(
        `Insufficient inventory. Requested: ${quantity}, available: ${available}`,
      );
    }

    existing.quantity -= quantity;

    // Remove record if quantity reaches 0
    if (existing.quantity === 0) {
      await manager.remove(Inventory, existing);
      existing.quantity = 0;
      return existing;
    }

    return manager.save(Inventory, existing);
  }

  /**
   * Upgrade storage capacity to the next tier.
   * Deducts cost from player's wallet via WalletService.
   *
   * @throws BadRequestException if already at max tier or targetCapacity is invalid
   */
  async upgradeStorage(playerId: string, seasonId: string): Promise<{
    previousCapacity: number;
    newCapacity: number;
    cost: number;
  }> {
    const playerSeason = await this.playerSeasonRepository.findOne({
      where: { playerId, seasonId },
    });

    if (!playerSeason) {
      throw new NotFoundException(`PlayerSeason not found for player ${playerId}`);
    }

    const currentCapacity = playerSeason.storageCapacity;
    const currentTierIndex = STORAGE_TIERS.findIndex((t) => t.capacity === currentCapacity);

    if (currentTierIndex === -1) {
      // Current capacity doesn't match a known tier, find the next tier above current
      const nextTierIndex = STORAGE_TIERS.findIndex((t) => t.capacity > currentCapacity);
      if (nextTierIndex === -1) {
        throw new BadRequestException('Storage is already at maximum capacity (5000)');
      }
      return this.performUpgrade(playerId, seasonId, playerSeason, STORAGE_TIERS[nextTierIndex]);
    }

    if (currentTierIndex >= STORAGE_TIERS.length - 1) {
      throw new BadRequestException('Storage is already at maximum capacity (5000)');
    }

    const nextTier = STORAGE_TIERS[currentTierIndex + 1];
    return this.performUpgrade(playerId, seasonId, playerSeason, nextTier);
  }

  /**
   * Get storage usage for a player in a season.
   */
  async getStorageUsage(playerId: string, seasonId: string): Promise<StorageUsage> {
    const playerSeason = await this.playerSeasonRepository.findOne({
      where: { playerId, seasonId },
    });

    if (!playerSeason) {
      throw new NotFoundException(`PlayerSeason not found for player ${playerId}`);
    }

    const used = await this.calculateStorageUsage(playerId, seasonId);
    const capacity = playerSeason.storageCapacity;

    return {
      used,
      capacity,
      available: capacity - used,
    };
  }

  /**
   * Get all available storage tiers with their current/available status.
   */
  async getStorageTiers(playerId: string, seasonId: string): Promise<StorageTierInfo[]> {
    const playerSeason = await this.playerSeasonRepository.findOne({
      where: { playerId, seasonId },
    });

    if (!playerSeason) {
      throw new NotFoundException(`PlayerSeason not found for player ${playerId}`);
    }

    const currentCapacity = playerSeason.storageCapacity;

    return STORAGE_TIERS.map((tier) => ({
      capacity: tier.capacity,
      cost: tier.cost,
      current: tier.capacity === currentCapacity,
      available: tier.capacity > currentCapacity,
    }));
  }

  /**
   * Check whether a player has enough storage capacity for a given addition.
   * Returns true if the addition would fit, false otherwise.
   */
  async hasCapacityFor(
    playerId: string,
    seasonId: string,
    commodityId: string,
    quantity: number,
  ): Promise<boolean> {
    if (quantity <= 0) return true;

    const commodity = await this.commodityRepository.findOne({
      where: { id: commodityId },
    });
    if (!commodity) return false;

    const playerSeason = await this.playerSeasonRepository.findOne({
      where: { playerId, seasonId },
    });
    if (!playerSeason) return false;

    const currentUsage = await this.calculateStorageUsage(playerId, seasonId);
    const additionalStorage = quantity * commodity.storageSize;

    return currentUsage + additionalStorage <= playerSeason.storageCapacity;
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

  // --- Private helper methods ---

  private async performUpgrade(
    playerId: string,
    seasonId: string,
    playerSeason: PlayerSeason,
    targetTier: { capacity: number; cost: number },
  ): Promise<{
    previousCapacity: number;
    newCapacity: number;
    cost: number;
  }> {
    const previousCapacity = playerSeason.storageCapacity;

    // Deduct cost via wallet (negative amount = debit)
    await this.walletService.executeTransaction(
      playerId,
      seasonId,
      TransactionType.STORAGE_UPGRADE,
      -targetTier.cost,
      {
        referenceType: 'storage_upgrade',
        description: `Storage upgrade: ${previousCapacity} → ${targetTier.capacity}`,
      },
    );

    // Update storage capacity
    playerSeason.storageCapacity = targetTier.capacity;
    await this.playerSeasonRepository.save(playerSeason);

    this.logger.log(
      `Storage upgraded: player=${playerId}, ${previousCapacity} → ${targetTier.capacity}, cost=${targetTier.cost}`,
    );

    // Storage capacity increased — trigger production resume check
    await this.emitProductionCheckResume(playerId, seasonId);

    return {
      previousCapacity,
      newCapacity: targetTier.capacity,
      cost: targetTier.cost,
    };
  }

  /**
   * Calculate total storage used by a player (sum of quantity × storageSize).
   */
  private async calculateStorageUsage(playerId: string, seasonId: string): Promise<number> {
    const result = await this.inventoryRepository
      .createQueryBuilder('inv')
      .innerJoin('inv.commodity', 'commodity')
      .select('COALESCE(SUM(inv.quantity * commodity.storage_size), 0)', 'total')
      .where('inv.player_id = :playerId AND inv.season_id = :seasonId', {
        playerId,
        seasonId,
      })
      .getRawOne();

    return parseInt(result?.total ?? '0', 10);
  }

  /**
   * Calculate storage usage within a transaction context.
   */
  private async calculateStorageUsageWithManager(
    manager: EntityManager,
    playerId: string,
    seasonId: string,
  ): Promise<number> {
    const result = await manager
      .createQueryBuilder(Inventory, 'inv')
      .innerJoin('inv.commodity', 'commodity')
      .select('COALESCE(SUM(inv.quantity * commodity.storage_size), 0)', 'total')
      .where('inv.player_id = :playerId AND inv.season_id = :seasonId', {
        playerId,
        seasonId,
      })
      .getRawOne();

    return parseInt(result?.total ?? '0', 10);
  }

  /**
   * Emit a production.check_resume job when inventory frees up or storage upgrades.
   * This allows paused production jobs (STORAGE_FULL) to resume.
   */
  private async emitProductionCheckResume(playerId: string, seasonId: string): Promise<void> {
    try {
      await this.productionQueue.add(
        'production.check_resume',
        { playerId, seasonId },
        {
          removeOnComplete: true,
          removeOnFail: true,
          attempts: 2,
          backoff: { type: 'fixed', delay: 1000 },
        },
      );
    } catch (error) {
      // Non-critical: log but don't fail the inventory operation
      this.logger.warn(
        `Failed to emit production.check_resume for player ${playerId}: ${error}`,
      );
    }
  }
}
