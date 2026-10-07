import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MapService, BoundingBox } from './map.service';
import { TerrainType, CommodityCategory } from '@sea-commodity-tycoon/shared-types';
import { Repository } from 'typeorm';
import { MapTile } from '../entities/map-tile.entity';
import { Season } from '../entities/season.entity';

describe('MapService', () => {
  let mapService: MapService;
  let mockMapTileRepo: Partial<Repository<MapTile>>;
  let mockSeasonRepo: Partial<Repository<Season>>;

  const seasonId = '11111111-1111-1111-1111-111111111111';
  const testSeed = 42;

  beforeEach(() => {
    mockMapTileRepo = {
      save: vi.fn().mockImplementation((tiles) => Promise.resolve(tiles)),
      findBy: vi.fn().mockResolvedValue([]),
      createQueryBuilder: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnThis(),
        andWhere: vi.fn().mockReturnThis(),
        getMany: vi.fn().mockResolvedValue([]),
      }),
    };

    mockSeasonRepo = {
      findOneBy: vi.fn().mockResolvedValue({
        id: seasonId,
        mapSeed: String(testSeed),
      } as Season),
    };

    mapService = new MapService(
      mockMapTileRepo as Repository<MapTile>,
      mockSeasonRepo as Repository<Season>,
    );
  });

  describe('generateElevationGrid', () => {
    it('should generate a grid of the correct dimensions', () => {
      const grid = mapService.generateElevationGrid(testSeed, 50, 50);
      expect(grid.length).toBe(50);
      expect(grid[0].length).toBe(50);
    });

    it('should produce values in [0, 1]', () => {
      const grid = mapService.generateElevationGrid(testSeed, 30, 30);
      for (let y = 0; y < 30; y++) {
        for (let x = 0; x < 30; x++) {
          expect(grid[y][x]).toBeGreaterThanOrEqual(0);
          expect(grid[y][x]).toBeLessThanOrEqual(1);
        }
      }
    });

    it('should produce deterministic results with the same seed', () => {
      const grid1 = mapService.generateElevationGrid(testSeed, 20, 20);
      const grid2 = mapService.generateElevationGrid(testSeed, 20, 20);
      expect(grid1).toEqual(grid2);
    });

    it('should produce different results with different seeds', () => {
      const grid1 = mapService.generateElevationGrid(testSeed, 20, 20);
      const grid2 = mapService.generateElevationGrid(testSeed + 1, 20, 20);
      // At least some values should differ
      let hasDifference = false;
      for (let y = 0; y < 20 && !hasDifference; y++) {
        for (let x = 0; x < 20 && !hasDifference; x++) {
          if (grid1[y][x] !== grid2[y][x]) hasDifference = true;
        }
      }
      expect(hasDifference).toBe(true);
    });
  });

  describe('assignTerrain', () => {
    it('should assign terrain based on elevation thresholds', () => {
      // Manually create an elevation grid with known values
      const elevationGrid = [
        [0.05, 0.25, 0.50, 0.75, 0.90],
      ];
      const terrain = mapService.assignTerrain(elevationGrid, 5, 1);

      expect(terrain[0][0]).toBe(TerrainType.WATER_TERRAIN); // < 0.15
      expect(terrain[0][1]).toBe(TerrainType.FERTILE_SOIL);  // 0.15 - 0.40
      expect(terrain[0][2]).toBe(TerrainType.FARMLAND);      // 0.40 - 0.65
      expect(terrain[0][3]).toBe(TerrainType.MOUNTAIN);      // 0.65 - 0.85
      expect(terrain[0][4]).toBe(TerrainType.CITY);          // >= 0.85
    });

    it('should assign boundary values correctly', () => {
      const elevationGrid = [
        [0.0, 0.15, 0.40, 0.65, 0.85, 1.0],
      ];
      const terrain = mapService.assignTerrain(elevationGrid, 6, 1);

      expect(terrain[0][0]).toBe(TerrainType.WATER_TERRAIN); // 0.0
      expect(terrain[0][1]).toBe(TerrainType.FERTILE_SOIL);  // exactly 0.15
      expect(terrain[0][2]).toBe(TerrainType.FARMLAND);      // exactly 0.40
      expect(terrain[0][3]).toBe(TerrainType.MOUNTAIN);      // exactly 0.65
      expect(terrain[0][4]).toBe(TerrainType.CITY);          // exactly 0.85
      expect(terrain[0][5]).toBe(TerrainType.CITY);          // 1.0
    });
  });

  describe('applySmoothingPass', () => {
    it('should smooth isolated terrain tiles to match their neighborhood', () => {
      // A 3x3 grid with one isolated different tile in the center
      const grid: TerrainType[][] = [
        [TerrainType.FARMLAND, TerrainType.FARMLAND, TerrainType.FARMLAND],
        [TerrainType.FARMLAND, TerrainType.WATER_TERRAIN, TerrainType.FARMLAND],
        [TerrainType.FARMLAND, TerrainType.FARMLAND, TerrainType.FARMLAND],
      ];

      const smoothed = mapService.applySmoothingPass(grid, 3, 3);
      // The isolated WATER in the center should become FARMLAND
      expect(smoothed[1][1]).toBe(TerrainType.FARMLAND);
    });

    it('should preserve majority terrain areas', () => {
      const grid: TerrainType[][] = [
        [TerrainType.MOUNTAIN, TerrainType.MOUNTAIN, TerrainType.MOUNTAIN],
        [TerrainType.MOUNTAIN, TerrainType.MOUNTAIN, TerrainType.MOUNTAIN],
        [TerrainType.MOUNTAIN, TerrainType.MOUNTAIN, TerrainType.MOUNTAIN],
      ];

      const smoothed = mapService.applySmoothingPass(grid, 3, 3);
      for (let y = 0; y < 3; y++) {
        for (let x = 0; x < 3; x++) {
          expect(smoothed[y][x]).toBe(TerrainType.MOUNTAIN);
        }
      }
    });
  });

  describe('calculateDistribution', () => {
    it('should count terrain types correctly', () => {
      const grid: TerrainType[][] = [
        [TerrainType.WATER_TERRAIN, TerrainType.FERTILE_SOIL],
        [TerrainType.FARMLAND, TerrainType.MOUNTAIN],
        [TerrainType.CITY, TerrainType.WATER_TERRAIN],
      ];

      const dist = mapService.calculateDistribution(grid, 2, 3);
      expect(dist[TerrainType.WATER_TERRAIN]).toBe(2);
      expect(dist[TerrainType.FERTILE_SOIL]).toBe(1);
      expect(dist[TerrainType.FARMLAND]).toBe(1);
      expect(dist[TerrainType.MOUNTAIN]).toBe(1);
      expect(dist[TerrainType.CITY]).toBe(1);
    });
  });

  describe('adjustDistribution', () => {
    it('should adjust terrain to meet target distributions within tolerance', () => {
      // Generate with a seed that may have skewed distribution
      const elevation = mapService.generateElevationGrid(testSeed, 50, 50);
      let terrain = mapService.assignTerrain(elevation, 50, 50);
      terrain = mapService.applySmoothingPass(terrain, 50, 50);
      terrain = mapService.adjustDistribution(terrain, 50, 50, testSeed);

      const dist = mapService.calculateDistribution(terrain, 50, 50);
      const total = 50 * 50;

      // Each terrain should be within ±5% tolerance of target
      expect(dist[TerrainType.WATER_TERRAIN] / total).toBeGreaterThanOrEqual(0.10);
      expect(dist[TerrainType.WATER_TERRAIN] / total).toBeLessThanOrEqual(0.20);

      expect(dist[TerrainType.FERTILE_SOIL] / total).toBeGreaterThanOrEqual(0.20);
      expect(dist[TerrainType.FERTILE_SOIL] / total).toBeLessThanOrEqual(0.30);

      expect(dist[TerrainType.FARMLAND] / total).toBeGreaterThanOrEqual(0.20);
      expect(dist[TerrainType.FARMLAND] / total).toBeLessThanOrEqual(0.30);

      expect(dist[TerrainType.MOUNTAIN] / total).toBeGreaterThanOrEqual(0.15);
      expect(dist[TerrainType.MOUNTAIN] / total).toBeLessThanOrEqual(0.25);

      expect(dist[TerrainType.CITY] / total).toBeGreaterThanOrEqual(0.10);
      expect(dist[TerrainType.CITY] / total).toBeLessThanOrEqual(0.20);
    });
  });

  describe('generateMap', () => {
    it('should generate and persist tiles for a season', async () => {
      const tiles = await mapService.generateMap(seasonId, { width: 10, height: 10 });

      expect(tiles.length).toBe(100);
      expect(mockMapTileRepo.save).toHaveBeenCalled();

      // Verify all tiles have the correct seasonId
      for (const tile of tiles) {
        expect(tile.seasonId).toBe(seasonId);
        expect(tile.ownerPlayerId).toBeNull();
        expect(tile.factoryId).toBeNull();
      }
    });

    it('should throw if season not found', async () => {
      (mockSeasonRepo.findOneBy as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      await expect(mapService.generateMap('non-existent-id')).rejects.toThrow('Season non-existent-id not found');
    });

    it('should generate deterministic maps for the same seed', async () => {
      const tiles1 = await mapService.generateMap(seasonId, { width: 20, height: 20 });

      // Reset mock call count
      vi.clearAllMocks();
      (mockSeasonRepo.findOneBy as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: seasonId,
        mapSeed: String(testSeed),
      } as Season);
      (mockMapTileRepo.save as ReturnType<typeof vi.fn>).mockImplementation((tiles) => Promise.resolve(tiles));

      const tiles2 = await mapService.generateMap(seasonId, { width: 20, height: 20 });

      // Compare terrain assignments
      for (let i = 0; i < tiles1.length; i++) {
        expect(tiles1[i].terrainType).toBe(tiles2[i].terrainType);
        expect(tiles1[i].x).toBe(tiles2[i].x);
        expect(tiles1[i].y).toBe(tiles2[i].y);
      }
    });

    it('should use default 100x100 when no config provided', async () => {
      const tiles = await mapService.generateMap(seasonId);
      expect(tiles.length).toBe(10000);
    });
  });

  describe('getTiles', () => {
    it('should query tiles within bounding box', async () => {
      const bounds: BoundingBox = { minX: 0, minY: 0, maxX: 10, maxY: 10 };
      await mapService.getTiles(seasonId, bounds);

      expect(mockMapTileRepo.createQueryBuilder).toHaveBeenCalledWith('tile');
    });
  });

  describe('validateTerrain', () => {
    function createTile(x: number, y: number, terrain: TerrainType, id?: string): MapTile {
      const tile = new MapTile();
      tile.id = id || `tile-${x}-${y}`;
      tile.seasonId = seasonId;
      tile.x = x;
      tile.y = y;
      tile.terrainType = terrain;
      tile.ownerPlayerId = null;
      tile.factoryId = null;
      tile.purchasedAt = null;
      tile.purchasePrice = null;
      return tile;
    }

    describe('Agriculture - 3x3 Fertile Soil', () => {
      it('should validate a valid 3x3 Fertile Soil layout', async () => {
        const tiles: MapTile[] = [];
        for (let y = 0; y < 3; y++) {
          for (let x = 0; x < 3; x++) {
            tiles.push(createTile(x, y, TerrainType.FERTILE_SOIL));
          }
        }
        (mockMapTileRepo.findBy as ReturnType<typeof vi.fn>).mockResolvedValue(tiles);

        const result = await mapService.validateTerrain(
          tiles.map((t) => t.id),
          CommodityCategory.AGRICULTURE,
        );
        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
      });

      it('should reject if wrong number of tiles', async () => {
        const tiles = [createTile(0, 0, TerrainType.FERTILE_SOIL)];
        (mockMapTileRepo.findBy as ReturnType<typeof vi.fn>).mockResolvedValue(tiles);

        const result = await mapService.validateTerrain(['tile-0-0'], CommodityCategory.AGRICULTURE);
        expect(result.valid).toBe(false);
        expect(result.errors[0]).toContain('requires exactly 9 tiles');
      });

      it('should reject if terrain type is wrong', async () => {
        const tiles: MapTile[] = [];
        for (let y = 0; y < 3; y++) {
          for (let x = 0; x < 3; x++) {
            tiles.push(createTile(x, y, TerrainType.FARMLAND));
          }
        }
        (mockMapTileRepo.findBy as ReturnType<typeof vi.fn>).mockResolvedValue(tiles);

        const result = await mapService.validateTerrain(
          tiles.map((t) => t.id),
          CommodityCategory.AGRICULTURE,
        );
        expect(result.valid).toBe(false);
        expect(result.errors[0]).toContain('FERTILE_SOIL');
      });
    });

    describe('Energy - 3x2 Mountain/Farmland', () => {
      it('should validate a mixed Mountain/Farmland 3x2 layout', async () => {
        const tiles: MapTile[] = [
          createTile(0, 0, TerrainType.MOUNTAIN),
          createTile(1, 0, TerrainType.FARMLAND),
          createTile(2, 0, TerrainType.MOUNTAIN),
          createTile(0, 1, TerrainType.FARMLAND),
          createTile(1, 1, TerrainType.MOUNTAIN),
          createTile(2, 1, TerrainType.FARMLAND),
        ];
        (mockMapTileRepo.findBy as ReturnType<typeof vi.fn>).mockResolvedValue(tiles);

        const result = await mapService.validateTerrain(
          tiles.map((t) => t.id),
          CommodityCategory.ENERGY,
        );
        expect(result.valid).toBe(true);
      });
    });

    describe('Metal - 2x2 Mountain', () => {
      it('should validate a valid 2x2 Mountain layout', async () => {
        const tiles: MapTile[] = [
          createTile(5, 5, TerrainType.MOUNTAIN),
          createTile(6, 5, TerrainType.MOUNTAIN),
          createTile(5, 6, TerrainType.MOUNTAIN),
          createTile(6, 6, TerrainType.MOUNTAIN),
        ];
        (mockMapTileRepo.findBy as ReturnType<typeof vi.fn>).mockResolvedValue(tiles);

        const result = await mapService.validateTerrain(
          tiles.map((t) => t.id),
          CommodityCategory.METAL,
        );
        expect(result.valid).toBe(true);
      });
    });

    describe('Livestock - 3x2 Farmland', () => {
      it('should validate a valid 3x2 Farmland layout', async () => {
        const tiles: MapTile[] = [
          createTile(0, 0, TerrainType.FARMLAND),
          createTile(1, 0, TerrainType.FARMLAND),
          createTile(2, 0, TerrainType.FARMLAND),
          createTile(0, 1, TerrainType.FARMLAND),
          createTile(1, 1, TerrainType.FARMLAND),
          createTile(2, 1, TerrainType.FARMLAND),
        ];
        (mockMapTileRepo.findBy as ReturnType<typeof vi.fn>).mockResolvedValue(tiles);

        const result = await mapService.validateTerrain(
          tiles.map((t) => t.id),
          CommodityCategory.LIVESTOCK,
        );
        expect(result.valid).toBe(true);
      });
    });

    describe('Fishery - 2x2 (2 Water + 2 adjacent land)', () => {
      it('should validate a valid Fishery layout', async () => {
        const tiles: MapTile[] = [
          createTile(0, 0, TerrainType.WATER_TERRAIN),
          createTile(1, 0, TerrainType.WATER_TERRAIN),
          createTile(0, 1, TerrainType.FARMLAND),
          createTile(1, 1, TerrainType.FERTILE_SOIL),
        ];
        (mockMapTileRepo.findBy as ReturnType<typeof vi.fn>).mockResolvedValue(tiles);

        const result = await mapService.validateTerrain(
          tiles.map((t) => t.id),
          CommodityCategory.FISHERY,
        );
        expect(result.valid).toBe(true);
      });

      it('should reject Fishery with wrong water tile count', async () => {
        const tiles: MapTile[] = [
          createTile(0, 0, TerrainType.WATER_TERRAIN),
          createTile(1, 0, TerrainType.FARMLAND),
          createTile(0, 1, TerrainType.FARMLAND),
          createTile(1, 1, TerrainType.FARMLAND),
        ];
        (mockMapTileRepo.findBy as ReturnType<typeof vi.fn>).mockResolvedValue(tiles);

        const result = await mapService.validateTerrain(
          tiles.map((t) => t.id),
          CommodityCategory.FISHERY,
        );
        expect(result.valid).toBe(false);
        expect(result.errors[0]).toContain('exactly 2 Water');
      });
    });

    describe('Forestry - 3x3 Fertile Soil/Farmland', () => {
      it('should validate a valid mixed Fertile Soil/Farmland 3x3 layout', async () => {
        const tiles: MapTile[] = [];
        for (let y = 0; y < 3; y++) {
          for (let x = 0; x < 3; x++) {
            const terrain = (x + y) % 2 === 0 ? TerrainType.FERTILE_SOIL : TerrainType.FARMLAND;
            tiles.push(createTile(x, y, terrain));
          }
        }
        (mockMapTileRepo.findBy as ReturnType<typeof vi.fn>).mockResolvedValue(tiles);

        const result = await mapService.validateTerrain(
          tiles.map((t) => t.id),
          CommodityCategory.FORESTRY,
        );
        expect(result.valid).toBe(true);
      });
    });

    describe('CITY terrain rejection', () => {
      it('should reject any factory on CITY terrain', async () => {
        const tiles: MapTile[] = [
          createTile(0, 0, TerrainType.CITY),
          createTile(1, 0, TerrainType.CITY),
          createTile(0, 1, TerrainType.CITY),
          createTile(1, 1, TerrainType.CITY),
        ];
        (mockMapTileRepo.findBy as ReturnType<typeof vi.fn>).mockResolvedValue(tiles);

        const result = await mapService.validateTerrain(
          tiles.map((t) => t.id),
          CommodityCategory.METAL,
        );
        expect(result.valid).toBe(false);
        expect(result.errors[0]).toContain('CITY terrain');
      });
    });

    describe('Contiguous rectangle validation', () => {
      it('should reject non-contiguous tile arrangements', async () => {
        const tiles: MapTile[] = [
          createTile(0, 0, TerrainType.MOUNTAIN),
          createTile(1, 0, TerrainType.MOUNTAIN),
          createTile(0, 1, TerrainType.MOUNTAIN),
          createTile(5, 5, TerrainType.MOUNTAIN), // not contiguous
        ];
        (mockMapTileRepo.findBy as ReturnType<typeof vi.fn>).mockResolvedValue(tiles);

        const result = await mapService.validateTerrain(
          tiles.map((t) => t.id),
          CommodityCategory.METAL,
        );
        expect(result.valid).toBe(false);
        expect(result.errors[0]).toContain('contiguous rectangle');
      });
    });

    describe('Electronics/Automotive (no standalone)', () => {
      it('should reject Electronics category as no standalone terrain requirements', async () => {
        const result = await mapService.validateTerrain(
          ['tile-1'],
          CommodityCategory.ELECTRONICS,
        );
        expect(result.valid).toBe(false);
        expect(result.errors[0]).toContain('does not have standalone terrain requirements');
      });

      it('should reject Automotive category', async () => {
        const result = await mapService.validateTerrain(
          ['tile-1'],
          CommodityCategory.AUTOMOTIVE,
        );
        expect(result.valid).toBe(false);
        expect(result.errors[0]).toContain('does not have standalone terrain requirements');
      });
    });

    it('should reject when no tiles found', async () => {
      (mockMapTileRepo.findBy as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const result = await mapService.validateTerrain(['non-existent'], CommodityCategory.METAL);
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('No tiles found');
    });
  });
});
