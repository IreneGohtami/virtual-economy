import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LandService } from './land.service';
import { TerrainType, TransactionType } from '@sea-commodity-tycoon/shared-types';
import { Repository, DataSource, EntityManager } from 'typeorm';
import { MapTile } from '../entities/map-tile.entity';
import { Season } from '../entities/season.entity';
import { WalletService } from '../wallet/wallet.service';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';

describe('LandService', () => {
  let landService: LandService;
  let mockMapTileRepo: Partial<Repository<MapTile>>;
  let mockSeasonRepo: Partial<Repository<Season>>;
  let mockWalletService: Partial<WalletService>;
  let mockDataSource: Partial<DataSource>;
  let mockManager: Partial<EntityManager>;

  const playerId = '11111111-1111-1111-1111-111111111111';
  const seasonId = '22222222-2222-2222-2222-222222222222';

  // Helper to create a tile at (x,y)
  function createTile(id: string, x: number, y: number, opts: Partial<MapTile> = {}): MapTile {
    const tile = new MapTile();
    tile.id = id;
    tile.seasonId = seasonId;
    tile.x = x;
    tile.y = y;
    tile.terrainType = TerrainType.FARMLAND;
    tile.ownerPlayerId = null;
    tile.factoryId = null;
    tile.purchasedAt = null;
    tile.purchasePrice = null;
    Object.assign(tile, opts);
    return tile;
  }

  beforeEach(() => {
    mockMapTileRepo = {};
    mockSeasonRepo = {};

    mockWalletService = {
      executeTransactionWithManager: vi.fn().mockResolvedValue({
        transactionId: 'tx-1',
        balanceAfter: 900,
        amount: -100,
      }),
    };

    // Mock EntityManager used inside transactions
    mockManager = {
      createQueryBuilder: vi.fn(),
      findOneBy: vi.fn(),
      save: vi.fn().mockImplementation((_, entities) => Promise.resolve(entities)),
    };

    // DataSource.transaction runs the callback with the mock manager
    mockDataSource = {
      transaction: vi.fn().mockImplementation(async (cb: (manager: EntityManager) => Promise<any>) => {
        return cb(mockManager as EntityManager);
      }),
    };

    landService = new LandService(
      mockMapTileRepo as Repository<MapTile>,
      mockSeasonRepo as Repository<Season>,
      mockWalletService as WalletService,
      mockDataSource as DataSource,
    );
  });

  describe('purchaseTiles', () => {
    it('should successfully purchase contiguous unowned tiles', async () => {
      const tiles = [
        createTile('t1', 0, 0),
        createTile('t2', 1, 0),
        createTile('t3', 0, 1),
      ];

      // Mock: queryBuilder for fetching tiles with lock
      const tileQueryBuilder = {
        setLock: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        getMany: vi.fn().mockResolvedValue(tiles),
      };

      // Mock: queryBuilder for counting owned tiles
      const countQueryBuilder = {
        where: vi.fn().mockReturnThis(),
        andWhere: vi.fn().mockReturnThis(),
        getCount: vi.fn().mockResolvedValue(0),
      };

      (mockManager.createQueryBuilder as any) = vi.fn()
        .mockReturnValueOnce(tileQueryBuilder)
        .mockReturnValueOnce(countQueryBuilder);

      const result = await landService.purchaseTiles(playerId, seasonId, ['t1', 't2', 't3']);

      expect(result.purchasedTiles).toHaveLength(3);
      expect(result.totalCost).toBe(75); // 3 tiles at 25 each (tier 0)
      expect(result.newBalance).toBe(900);

      // Verify wallet transaction was called
      expect(mockWalletService.executeTransactionWithManager).toHaveBeenCalledWith(
        mockManager,
        playerId,
        seasonId,
        TransactionType.LAND_PURCHASE,
        -75,
        expect.objectContaining({ referenceType: 'land_purchase' }),
      );

      // Verify tiles were saved with ownership
      expect(mockManager.save).toHaveBeenCalled();
      expect(tiles[0].ownerPlayerId).toBe(playerId);
      expect(tiles[0].purchasePrice).toBe('25.00');
    });

    it('should apply tiered pricing when player already owns tiles', async () => {
      const tiles = [
        createTile('t1', 5, 5),
        createTile('t2', 6, 5),
      ];

      const tileQueryBuilder = {
        setLock: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        getMany: vi.fn().mockResolvedValue(tiles),
      };

      // Player already owns 9 tiles, so next tile (index 9) is tier 0, index 10 is tier 1
      const countQueryBuilder = {
        where: vi.fn().mockReturnThis(),
        andWhere: vi.fn().mockReturnThis(),
        getCount: vi.fn().mockResolvedValue(9),
      };

      (mockManager.createQueryBuilder as any) = vi.fn()
        .mockReturnValueOnce(tileQueryBuilder)
        .mockReturnValueOnce(countQueryBuilder);

      const result = await landService.purchaseTiles(playerId, seasonId, ['t1', 't2']);

      // Tile index 9 → tier 0 → 25 coins, tile index 10 → tier 1 → 30 coins
      expect(result.totalCost).toBe(55);
      expect(result.purchasedTiles[0].purchasePrice).toBe(25);
      expect(result.purchasedTiles[1].purchasePrice).toBe(30);
    });

    it('should reject already-owned tiles', async () => {
      const tiles = [
        createTile('t1', 0, 0, { ownerPlayerId: 'other-player' }),
      ];

      const tileQueryBuilder = {
        setLock: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        getMany: vi.fn().mockResolvedValue(tiles),
      };

      (mockManager.createQueryBuilder as any) = vi.fn().mockReturnValue(tileQueryBuilder);

      await expect(
        landService.purchaseTiles(playerId, seasonId, ['t1']),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject CITY tiles during first 5 days of season', async () => {
      const tiles = [
        createTile('t1', 0, 0, { terrainType: TerrainType.CITY }),
      ];

      const tileQueryBuilder = {
        setLock: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        getMany: vi.fn().mockResolvedValue(tiles),
      };

      (mockManager.createQueryBuilder as any) = vi.fn().mockReturnValue(tileQueryBuilder);

      // Season started 2 days ago
      const season = {
        id: seasonId,
        startsAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
      } as Season;
      (mockManager.findOneBy as any) = vi.fn().mockResolvedValue(season);

      await expect(
        landService.purchaseTiles(playerId, seasonId, ['t1']),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should allow CITY tiles after Day 5', async () => {
      const tiles = [
        createTile('t1', 0, 0, { terrainType: TerrainType.CITY }),
      ];

      const tileQueryBuilder = {
        setLock: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        getMany: vi.fn().mockResolvedValue(tiles),
      };

      const countQueryBuilder = {
        where: vi.fn().mockReturnThis(),
        andWhere: vi.fn().mockReturnThis(),
        getCount: vi.fn().mockResolvedValue(0),
      };

      (mockManager.createQueryBuilder as any) = vi.fn()
        .mockReturnValueOnce(tileQueryBuilder)
        .mockReturnValueOnce(countQueryBuilder);

      // Season started 6 days ago
      const season = {
        id: seasonId,
        startsAt: new Date(Date.now() - 6 * 24 * 60 * 60 * 1000),
      } as Season;
      (mockManager.findOneBy as any) = vi.fn().mockResolvedValue(season);

      const result = await landService.purchaseTiles(playerId, seasonId, ['t1']);
      expect(result.purchasedTiles).toHaveLength(1);
    });

    it('should reject non-contiguous tiles', async () => {
      const tiles = [
        createTile('t1', 0, 0),
        createTile('t2', 5, 5), // Not adjacent to t1
      ];

      const tileQueryBuilder = {
        setLock: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        getMany: vi.fn().mockResolvedValue(tiles),
      };

      (mockManager.createQueryBuilder as any) = vi.fn().mockReturnValue(tileQueryBuilder);

      await expect(
        landService.purchaseTiles(playerId, seasonId, ['t1', 't2']),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject if some tiles are not found', async () => {
      const tiles = [createTile('t1', 0, 0)];

      const tileQueryBuilder = {
        setLock: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        getMany: vi.fn().mockResolvedValue(tiles),
      };

      (mockManager.createQueryBuilder as any) = vi.fn().mockReturnValue(tileQueryBuilder);

      await expect(
        landService.purchaseTiles(playerId, seasonId, ['t1', 't2']),
      ).rejects.toThrow(NotFoundException);
    });

    it('should handle single tile purchase (always contiguous)', async () => {
      const tiles = [createTile('t1', 3, 7)];

      const tileQueryBuilder = {
        setLock: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        getMany: vi.fn().mockResolvedValue(tiles),
      };

      const countQueryBuilder = {
        where: vi.fn().mockReturnThis(),
        andWhere: vi.fn().mockReturnThis(),
        getCount: vi.fn().mockResolvedValue(0),
      };

      (mockManager.createQueryBuilder as any) = vi.fn()
        .mockReturnValueOnce(tileQueryBuilder)
        .mockReturnValueOnce(countQueryBuilder);

      const result = await landService.purchaseTiles(playerId, seasonId, ['t1']);
      expect(result.purchasedTiles).toHaveLength(1);
      expect(result.totalCost).toBe(25);
    });
  });

  describe('resellTiles', () => {
    it('should successfully resell owned tiles at 50% price', async () => {
      const tiles = [
        createTile('t1', 0, 0, { ownerPlayerId: playerId, purchasePrice: '25.00' }),
        createTile('t2', 1, 0, { ownerPlayerId: playerId, purchasePrice: '30.00' }),
      ];

      const tileQueryBuilder = {
        setLock: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        getMany: vi.fn().mockResolvedValue(tiles),
      };

      (mockManager.createQueryBuilder as any) = vi.fn().mockReturnValue(tileQueryBuilder);

      (mockWalletService.executeTransactionWithManager as any) = vi.fn().mockResolvedValue({
        transactionId: 'tx-2',
        balanceAfter: 1027.5,
        amount: 27.5,
      });

      const result = await landService.resellTiles(playerId, seasonId, ['t1', 't2']);

      expect(result.resoldTiles).toHaveLength(2);
      expect(result.totalRefund).toBe(27.5); // (25 * 0.5) + (30 * 0.5)
      expect(result.newBalance).toBe(1027.5);

      // Verify wallet transaction was called with positive amount
      expect(mockWalletService.executeTransactionWithManager).toHaveBeenCalledWith(
        mockManager,
        playerId,
        seasonId,
        TransactionType.LAND_RESALE,
        27.5,
        expect.objectContaining({ referenceType: 'land_resale' }),
      );

      // Verify tiles ownership cleared
      expect(tiles[0].ownerPlayerId).toBeNull();
      expect(tiles[0].purchasePrice).toBeNull();
    });

    it('should reject if player does not own the tiles', async () => {
      const tiles = [
        createTile('t1', 0, 0, { ownerPlayerId: 'other-player', purchasePrice: '25.00' }),
      ];

      const tileQueryBuilder = {
        setLock: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        getMany: vi.fn().mockResolvedValue(tiles),
      };

      (mockManager.createQueryBuilder as any) = vi.fn().mockReturnValue(tileQueryBuilder);

      await expect(
        landService.resellTiles(playerId, seasonId, ['t1']),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should reject if tiles have factories on them', async () => {
      const tiles = [
        createTile('t1', 0, 0, {
          ownerPlayerId: playerId,
          purchasePrice: '25.00',
          factoryId: 'factory-1',
        }),
      ];

      const tileQueryBuilder = {
        setLock: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        getMany: vi.fn().mockResolvedValue(tiles),
      };

      (mockManager.createQueryBuilder as any) = vi.fn().mockReturnValue(tileQueryBuilder);

      await expect(
        landService.resellTiles(playerId, seasonId, ['t1']),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject tiles from wrong season', async () => {
      const tiles = [
        createTile('t1', 0, 0, { ownerPlayerId: playerId, purchasePrice: '25.00' }),
      ];
      tiles[0].seasonId = 'different-season-id';

      const tileQueryBuilder = {
        setLock: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        getMany: vi.fn().mockResolvedValue(tiles),
      };

      (mockManager.createQueryBuilder as any) = vi.fn().mockReturnValue(tileQueryBuilder);

      await expect(
        landService.resellTiles(playerId, seasonId, ['t1']),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
