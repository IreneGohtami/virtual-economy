import {
  Injectable,
  Logger,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, In } from 'typeorm';
import { TerrainType, TransactionType } from '@sea-commodity-tycoon/shared-types';
import { calculateLandPrice, calculateLandResalePrice } from '@sea-commodity-tycoon/game-rules';
import { MapTile } from '../entities/map-tile.entity';
import { Season } from '../entities/season.entity';
import { WalletService } from '../wallet/wallet.service';

export interface LandPurchaseResult {
  purchasedTiles: Array<{ id: string; x: number; y: number; purchasePrice: number }>;
  totalCost: number;
  newBalance: number;
}

export interface LandResaleResult {
  resoldTiles: Array<{ id: string; x: number; y: number; resalePrice: number }>;
  totalRefund: number;
  newBalance: number;
}

@Injectable()
export class LandService {
  private readonly logger = new Logger(LandService.name);

  constructor(
    @InjectRepository(MapTile)
    private readonly mapTileRepository: Repository<MapTile>,
    @InjectRepository(Season)
    private readonly seasonRepository: Repository<Season>,
    private readonly walletService: WalletService,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Purchases tiles for a player. Validates ownership, contiguity, CITY lock,
   * and sufficient coins. Applies tiered pricing and records in wallet ledger.
   *
   * Validates: Requirements 2.3, 2.4, 2.5, 2.9, 2.10
   */
  async purchaseTiles(
    playerId: string,
    seasonId: string,
    tileIds: string[],
  ): Promise<LandPurchaseResult> {
    return this.dataSource.transaction(async (manager) => {
      // 1. Fetch tiles with pessimistic lock to prevent race conditions
      const tiles = await manager
        .createQueryBuilder(MapTile, 'tile')
        .setLock('pessimistic_write')
        .where('tile.id IN (:...tileIds)', { tileIds })
        .getMany();

      // Validate all tile IDs are found
      if (tiles.length !== tileIds.length) {
        const foundIds = new Set(tiles.map((t) => t.id));
        const missing = tileIds.filter((id) => !foundIds.has(id));
        throw new NotFoundException(`Tiles not found: ${missing.join(', ')}`);
      }

      // 2. Validate all tiles belong to the current season
      const invalidSeasonTiles = tiles.filter((t) => t.seasonId !== seasonId);
      if (invalidSeasonTiles.length > 0) {
        throw new BadRequestException('All tiles must belong to the current season');
      }

      // 3. Validate no tile is already owned
      const ownedTiles = tiles.filter((t) => t.ownerPlayerId !== null);
      if (ownedTiles.length > 0) {
        throw new BadRequestException(
          `Tiles already owned: ${ownedTiles.map((t) => `(${t.x},${t.y})`).join(', ')}`,
        );
      }

      // 4. Validate CITY tile purchase lock (first 5 days of season)
      const cityTiles = tiles.filter((t) => t.terrainType === TerrainType.CITY);
      if (cityTiles.length > 0) {
        const season = await manager.findOneBy(Season, { id: seasonId });
        if (!season) {
          throw new NotFoundException('Season not found');
        }
        const lockExpiry = new Date(season.startsAt.getTime() + 5 * 24 * 60 * 60 * 1000);
        if (new Date() < lockExpiry) {
          const daysRemaining = Math.ceil(
            (lockExpiry.getTime() - Date.now()) / (24 * 60 * 60 * 1000),
          );
          throw new ForbiddenException(
            `CITY tiles are locked for purchase during the first 5 days of the season. Available in ${daysRemaining} day(s).`,
          );
        }
      }

      // 5. Validate tiles are contiguous (form a connected group)
      this.validateContiguous(tiles);

      // 6. Calculate total cost using tiered pricing
      const currentOwnedCount = await manager
        .createQueryBuilder(MapTile, 'tile')
        .where('tile.season_id = :seasonId', { seasonId })
        .andWhere('tile.owner_player_id = :playerId', { playerId })
        .getCount();

      const totalCost = calculateLandPrice(currentOwnedCount, tiles.length);

      // 7. Deduct coins via wallet ledger (will throw InsufficientFundsError if not enough)
      const txResult = await this.walletService.executeTransactionWithManager(
        manager,
        playerId,
        seasonId,
        TransactionType.LAND_PURCHASE,
        -totalCost,
        {
          referenceType: 'land_purchase',
          referenceId: tileIds.join(','),
          description: `Purchased ${tiles.length} tile(s)`,
        },
      );

      // 8. Assign tiles to player with individual prices
      const now = new Date();
      const purchasedTiles: LandPurchaseResult['purchasedTiles'] = [];

      for (let i = 0; i < tiles.length; i++) {
        const tileIndex = currentOwnedCount + i;
        const tier = Math.floor(tileIndex / 10);
        const pricePerTile = 25 + 5 * tier;

        tiles[i].ownerPlayerId = playerId;
        tiles[i].purchasedAt = now;
        tiles[i].purchasePrice = pricePerTile.toFixed(2);

        purchasedTiles.push({
          id: tiles[i].id,
          x: tiles[i].x,
          y: tiles[i].y,
          purchasePrice: pricePerTile,
        });
      }

      await manager.save(MapTile, tiles);

      this.logger.log(
        `Player ${playerId} purchased ${tiles.length} tiles for ${totalCost} coins`,
      );

      return {
        purchasedTiles,
        totalCost,
        newBalance: txResult.balanceAfter,
      };
    });
  }

  /**
   * Resells owned tiles at 50% of original purchase price.
   * Validates player owns the tiles and they have no factory on them.
   *
   * Validates: Requirements 2.5, 21.4
   */
  async resellTiles(
    playerId: string,
    seasonId: string,
    tileIds: string[],
  ): Promise<LandResaleResult> {
    return this.dataSource.transaction(async (manager) => {
      // 1. Fetch tiles with pessimistic lock
      const tiles = await manager
        .createQueryBuilder(MapTile, 'tile')
        .setLock('pessimistic_write')
        .where('tile.id IN (:...tileIds)', { tileIds })
        .getMany();

      // Validate all tile IDs are found
      if (tiles.length !== tileIds.length) {
        const foundIds = new Set(tiles.map((t) => t.id));
        const missing = tileIds.filter((id) => !foundIds.has(id));
        throw new NotFoundException(`Tiles not found: ${missing.join(', ')}`);
      }

      // 2. Validate all tiles belong to the current season
      const invalidSeasonTiles = tiles.filter((t) => t.seasonId !== seasonId);
      if (invalidSeasonTiles.length > 0) {
        throw new BadRequestException('All tiles must belong to the current season');
      }

      // 3. Validate player owns all tiles
      const notOwned = tiles.filter((t) => t.ownerPlayerId !== playerId);
      if (notOwned.length > 0) {
        throw new ForbiddenException(
          `You do not own tiles: ${notOwned.map((t) => `(${t.x},${t.y})`).join(', ')}`,
        );
      }

      // 4. Validate no factory is built on these tiles
      const tilesWithFactory = tiles.filter((t) => t.factoryId !== null);
      if (tilesWithFactory.length > 0) {
        throw new BadRequestException(
          `Cannot resell tiles with factories. Deconstruct factories first: ${tilesWithFactory.map((t) => `(${t.x},${t.y})`).join(', ')}`,
        );
      }

      // 5. Calculate total refund (50% of original purchase price per tile)
      let totalRefund = 0;
      const resoldTiles: LandResaleResult['resoldTiles'] = [];

      for (const tile of tiles) {
        const originalPrice = parseFloat(tile.purchasePrice || '0');
        const resalePrice = calculateLandResalePrice(originalPrice, tile.purchasedAt);
        totalRefund += resalePrice;
        resoldTiles.push({
          id: tile.id,
          x: tile.x,
          y: tile.y,
          resalePrice,
        });
      }

      // 6. Credit coins via wallet ledger
      const txResult = await this.walletService.executeTransactionWithManager(
        manager,
        playerId,
        seasonId,
        TransactionType.LAND_RESALE,
        totalRefund,
        {
          referenceType: 'land_resale',
          referenceId: tileIds.join(','),
          description: `Resold ${tiles.length} tile(s)`,
        },
      );

      // 7. Release tiles (clear ownership)
      for (const tile of tiles) {
        tile.ownerPlayerId = null;
        tile.purchasedAt = null;
        tile.purchasePrice = null;
      }

      await manager.save(MapTile, tiles);

      this.logger.log(
        `Player ${playerId} resold ${tiles.length} tiles for ${totalRefund} coins`,
      );

      return {
        resoldTiles,
        totalRefund,
        newBalance: txResult.balanceAfter,
      };
    });
  }

  /**
   * Validates that a set of tiles forms a connected group.
   * Uses BFS/flood-fill to check adjacency (4-connected: up, down, left, right).
   */
  private validateContiguous(tiles: MapTile[]): void {
    if (tiles.length <= 1) return;

    const tileSet = new Set(tiles.map((t) => `${t.x},${t.y}`));
    const visited = new Set<string>();
    const queue: string[] = [];

    // Start BFS from the first tile
    const start = `${tiles[0].x},${tiles[0].y}`;
    queue.push(start);
    visited.add(start);

    while (queue.length > 0) {
      const current = queue.shift()!;
      const [cx, cy] = current.split(',').map(Number);

      // Check 4-connected neighbors
      const neighbors = [
        `${cx - 1},${cy}`,
        `${cx + 1},${cy}`,
        `${cx},${cy - 1}`,
        `${cx},${cy + 1}`,
      ];

      for (const neighbor of neighbors) {
        if (tileSet.has(neighbor) && !visited.has(neighbor)) {
          visited.add(neighbor);
          queue.push(neighbor);
        }
      }
    }

    if (visited.size !== tiles.length) {
      throw new BadRequestException(
        'Selected tiles must form a contiguous group (all tiles must be adjacent)',
      );
    }
  }
}
