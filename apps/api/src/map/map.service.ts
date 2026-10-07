import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { TerrainType, CommodityCategory, SeasonStatus } from '@sea-commodity-tycoon/shared-types';
import { MapTile } from '../entities/map-tile.entity';
import { Season } from '../entities/season.entity';
import { createSeededNoise, NoiseGenerator } from './perlin';

// --- Public interfaces ---

export interface MapConfig {
  width?: number;
  height?: number;
}

export interface BoundingBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface TerrainValidationResult {
  valid: boolean;
  errors: string[];
}

export interface GeneratedTile {
  seasonId: string;
  x: number;
  y: number;
  terrainType: TerrainType;
}

// --- Terrain distribution targets ---

const TERRAIN_TARGETS: Record<TerrainType, number> = {
  [TerrainType.WATER_TERRAIN]: 0.15,
  [TerrainType.FERTILE_SOIL]: 0.25,
  [TerrainType.FARMLAND]: 0.25,
  [TerrainType.MOUNTAIN]: 0.20,
  [TerrainType.CITY]: 0.15,
};

const TERRAIN_TOLERANCE = 0.05;

// --- Terrain layout requirements per category ---

interface LayoutRequirement {
  width: number;
  height: number;
  allowedTerrains: TerrainType[];
  specialRule?: 'fishery';
}

const LAYOUT_REQUIREMENTS: Record<CommodityCategory, LayoutRequirement | null> = {
  [CommodityCategory.AGRICULTURE]: {
    width: 3,
    height: 3,
    allowedTerrains: [TerrainType.FERTILE_SOIL],
  },
  [CommodityCategory.ENERGY]: {
    width: 3,
    height: 2,
    allowedTerrains: [TerrainType.MOUNTAIN, TerrainType.FARMLAND],
  },
  [CommodityCategory.METAL]: {
    width: 2,
    height: 2,
    allowedTerrains: [TerrainType.MOUNTAIN],
  },
  [CommodityCategory.LIVESTOCK]: {
    width: 3,
    height: 2,
    allowedTerrains: [TerrainType.FARMLAND],
  },
  [CommodityCategory.FISHERY]: {
    width: 2,
    height: 2,
    allowedTerrains: [TerrainType.WATER_TERRAIN, TerrainType.FERTILE_SOIL, TerrainType.FARMLAND, TerrainType.MOUNTAIN],
    specialRule: 'fishery',
  },
  [CommodityCategory.FORESTRY]: {
    width: 3,
    height: 3,
    allowedTerrains: [TerrainType.FERTILE_SOIL, TerrainType.FARMLAND],
  },
  // L2 categories inherit from their input factories, no standalone placement
  [CommodityCategory.ELECTRONICS]: null,
  [CommodityCategory.AUTOMOTIVE]: null,
};

@Injectable()
export class MapService {
  private readonly logger = new Logger(MapService.name);

  constructor(
    @InjectRepository(MapTile)
    private readonly mapTileRepository: Repository<MapTile>,
    @InjectRepository(Season)
    private readonly seasonRepository: Repository<Season>,
  ) {}

  // --- Map Generation ---

  /**
   * Generates a complete map for a season using Perlin noise and the season's map seed.
   * Returns the generated tiles (not yet persisted if you need to batch-insert).
   */
  async generateMap(seasonId: string, config: MapConfig = {}): Promise<MapTile[]> {
    const season = await this.seasonRepository.findOneBy({ id: seasonId });
    if (!season) {
      throw new BadRequestException(`Season ${seasonId} not found`);
    }

    const width = config.width || 100;
    const height = config.height || 100;
    const seed = Number(season.mapSeed);

    this.logger.log(`Generating ${width}x${height} map for season ${seasonId} with seed ${seed}`);

    // Step 1: Generate raw elevation map
    const elevationGrid = this.generateElevationGrid(seed, width, height);

    // Step 2: Assign initial terrain from elevation thresholds
    let terrainGrid = this.assignTerrain(elevationGrid, width, height);

    // Step 3: Apply smoothing pass for contiguous patches
    terrainGrid = this.applySmoothingPass(terrainGrid, width, height);

    // Step 4: Validate and adjust distribution
    terrainGrid = this.adjustDistribution(terrainGrid, width, height, seed);

    // Step 5: Create tile entities
    const tiles = this.createTileEntities(seasonId, terrainGrid, width, height);

    // Step 6: Persist tiles in batches
    await this.persistTilesInBatches(tiles);

    this.logger.log(`Map generation complete: ${tiles.length} tiles created`);
    return tiles;
  }

  /**
   * Generates an elevation grid using multi-octave noise.
   */
  generateElevationGrid(seed: number, width: number, height: number): number[][] {
    const noise = createSeededNoise({ seed, octaves: 4, persistence: 0.5, lacunarity: 2.0, scale: 0.05 });
    const grid: number[][] = [];

    for (let y = 0; y < height; y++) {
      grid[y] = [];
      for (let x = 0; x < width; x++) {
        grid[y][x] = noise.get(x, y);
      }
    }

    return grid;
  }

  /**
   * Assigns terrain type based on elevation thresholds.
   * Thresholds are calibrated to match target distributions.
   */
  assignTerrain(elevationGrid: number[][], width: number, height: number): TerrainType[][] {
    const grid: TerrainType[][] = [];

    for (let y = 0; y < height; y++) {
      grid[y] = [];
      for (let x = 0; x < width; x++) {
        grid[y][x] = this.elevationToTerrain(elevationGrid[y][x]);
      }
    }

    return grid;
  }

  /**
   * Maps elevation value [0, 1] to terrain type.
   */
  private elevationToTerrain(elevation: number): TerrainType {
    if (elevation < 0.15) return TerrainType.WATER_TERRAIN;
    if (elevation < 0.40) return TerrainType.FERTILE_SOIL;
    if (elevation < 0.65) return TerrainType.FARMLAND;
    if (elevation < 0.85) return TerrainType.MOUNTAIN;
    return TerrainType.CITY;
  }

  /**
   * Applies a smoothing pass to make terrain patches more contiguous.
   * Uses majority-rule cellular automata: each cell adopts the most common
   * terrain in its 3x3 neighborhood.
   */
  applySmoothingPass(terrainGrid: TerrainType[][], width: number, height: number): TerrainType[][] {
    const smoothed: TerrainType[][] = [];

    for (let y = 0; y < height; y++) {
      smoothed[y] = [];
      for (let x = 0; x < width; x++) {
        smoothed[y][x] = this.getMajorityTerrain(terrainGrid, x, y, width, height);
      }
    }

    return smoothed;
  }

  /**
   * Returns the most common terrain type in the 3x3 neighborhood of (x, y).
   */
  private getMajorityTerrain(
    grid: TerrainType[][],
    x: number,
    y: number,
    width: number,
    height: number,
  ): TerrainType {
    const counts: Record<string, number> = {};

    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
          const terrain = grid[ny][nx];
          counts[terrain] = (counts[terrain] || 0) + 1;
        }
      }
    }

    let maxCount = 0;
    let majorityTerrain = grid[y][x]; // default to current

    for (const [terrain, count] of Object.entries(counts)) {
      if (count > maxCount) {
        maxCount = count;
        majorityTerrain = terrain as TerrainType;
      }
    }

    return majorityTerrain;
  }

  /**
   * Adjusts terrain distribution to meet target percentages within tolerance.
   * Iteratively reassigns tiles that are over-represented to under-represented types.
   */
  adjustDistribution(
    terrainGrid: TerrainType[][],
    width: number,
    height: number,
    seed: number,
  ): TerrainType[][] {
    const totalTiles = width * height;
    const distribution = this.calculateDistribution(terrainGrid, width, height);

    // Check if already within tolerance
    let needsAdjustment = false;
    for (const terrain of Object.values(TerrainType)) {
      const actual = distribution[terrain] / totalTiles;
      const target = TERRAIN_TARGETS[terrain];
      if (Math.abs(actual - target) > TERRAIN_TOLERANCE) {
        needsAdjustment = true;
        break;
      }
    }

    if (!needsAdjustment) {
      return terrainGrid;
    }

    this.logger.debug('Adjusting terrain distribution to meet targets');

    // Create a deterministic shuffle order using the seed
    const rng = this.createSimpleRng(seed + 12345);
    const positions: Array<{ x: number; y: number }> = [];
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        positions.push({ x, y });
      }
    }
    // Fisher-Yates shuffle
    for (let i = positions.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [positions[i], positions[j]] = [positions[j], positions[i]];
    }

    // Calculate how many tiles each terrain needs
    const targetCounts: Record<TerrainType, number> = {} as Record<TerrainType, number>;
    let remaining = totalTiles;
    const terrains = Object.values(TerrainType);
    for (let i = 0; i < terrains.length - 1; i++) {
      targetCounts[terrains[i]] = Math.round(TERRAIN_TARGETS[terrains[i]] * totalTiles);
      remaining -= targetCounts[terrains[i]];
    }
    targetCounts[terrains[terrains.length - 1]] = remaining;

    // Sort positions by priority: reassign over-represented first
    const currentCounts = { ...distribution };
    for (const pos of positions) {
      const currentTerrain = terrainGrid[pos.y][pos.x];
      const overBy = currentCounts[currentTerrain] - targetCounts[currentTerrain];

      if (overBy > 0) {
        // Find the most under-represented terrain
        let bestTerrain = currentTerrain;
        let bestDeficit = 0;
        for (const t of terrains) {
          const deficit = targetCounts[t] - currentCounts[t];
          if (deficit > bestDeficit) {
            bestDeficit = deficit;
            bestTerrain = t;
          }
        }

        if (bestTerrain !== currentTerrain) {
          terrainGrid[pos.y][pos.x] = bestTerrain;
          currentCounts[currentTerrain]--;
          currentCounts[bestTerrain]++;
        }
      }
    }

    return terrainGrid;
  }

  /**
   * Calculates the terrain type distribution counts.
   */
  calculateDistribution(
    terrainGrid: TerrainType[][],
    width: number,
    height: number,
  ): Record<TerrainType, number> {
    const counts: Record<TerrainType, number> = {
      [TerrainType.WATER_TERRAIN]: 0,
      [TerrainType.FERTILE_SOIL]: 0,
      [TerrainType.FARMLAND]: 0,
      [TerrainType.MOUNTAIN]: 0,
      [TerrainType.CITY]: 0,
    };

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        counts[terrainGrid[y][x]]++;
      }
    }

    return counts;
  }

  /**
   * Creates MapTile entities from the terrain grid.
   */
  private createTileEntities(
    seasonId: string,
    terrainGrid: TerrainType[][],
    width: number,
    height: number,
  ): MapTile[] {
    const tiles: MapTile[] = [];

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const tile = new MapTile();
        tile.seasonId = seasonId;
        tile.x = x;
        tile.y = y;
        tile.terrainType = terrainGrid[y][x];
        tile.ownerPlayerId = null;
        tile.factoryId = null;
        tile.purchasedAt = null;
        tile.purchasePrice = null;
        tiles.push(tile);
      }
    }

    return tiles;
  }

  /**
   * Persists tiles in batches to avoid overwhelming the database.
   */
  private async persistTilesInBatches(tiles: MapTile[], batchSize = 500): Promise<void> {
    for (let i = 0; i < tiles.length; i += batchSize) {
      const batch = tiles.slice(i, i + batchSize);
      await this.mapTileRepository.save(batch);
    }
  }

  // --- Tile Fetching ---

  /**
   * Fetches tiles within a bounding box for viewport-based rendering.
   */
  async getTiles(seasonId: string, bounds: BoundingBox): Promise<MapTile[]> {
    return this.mapTileRepository
      .createQueryBuilder('tile')
      .where('tile.season_id = :seasonId', { seasonId })
      .andWhere('tile.x >= :minX AND tile.x <= :maxX', { minX: bounds.minX, maxX: bounds.maxX })
      .andWhere('tile.y >= :minY AND tile.y <= :maxY', { minY: bounds.minY, maxY: bounds.maxY })
      .getMany();
  }

  // --- Terrain Validation ---

  /**
   * Validates that a set of tiles meets the terrain layout requirements for a commodity category.
   * Returns validation result with errors if invalid.
   */
  async validateTerrain(tileIds: string[], category: CommodityCategory, level?: number): Promise<TerrainValidationResult> {
    const errors: string[] = [];

    // Check if category has layout requirements
    const requirement = LAYOUT_REQUIREMENTS[category];
    if (!requirement) {
      errors.push(`Category ${category} does not have standalone terrain requirements`);
      return { valid: false, errors };
    }

    // Fetch the tiles
    const tiles = await this.mapTileRepository.findBy({ id: In(tileIds) });

    if (tiles.length === 0) {
      errors.push('No tiles found for the provided IDs');
      return { valid: false, errors };
    }

    // Check required tile count
    const requiredCount = requirement.width * requirement.height;
    if (tiles.length !== requiredCount) {
      errors.push(
        `Category ${category} requires exactly ${requiredCount} tiles (${requirement.width}×${requirement.height}), got ${tiles.length}`,
      );
      return { valid: false, errors };
    }

    // Check all tiles belong to the same season
    const seasonIds = new Set(tiles.map((t) => t.seasonId));
    if (seasonIds.size > 1) {
      errors.push('All tiles must belong to the same season');
      return { valid: false, errors };
    }

    // Reject CITY terrain for all factory categories
    const cityTiles = tiles.filter((t) => t.terrainType === TerrainType.CITY);
    if (cityTiles.length > 0) {
      errors.push('Factory construction is not allowed on CITY terrain');
      return { valid: false, errors };
    }

    // Validate terrain types for the category
    if (requirement.specialRule === 'fishery' && (!level || level === 0)) {
      // Fishery: 2×2 with exactly 2 Water + 2 adjacent land tiles
      const waterTiles = tiles.filter((t) => t.terrainType === TerrainType.WATER_TERRAIN);
      const landTiles = tiles.filter((t) => t.terrainType !== TerrainType.WATER_TERRAIN);

      if (waterTiles.length !== 2) {
        errors.push('Fishery requires exactly 2 Water terrain tiles');
      }
      if (landTiles.length !== 2) {
        errors.push('Fishery requires exactly 2 adjacent land tiles');
      }

      // Verify land tiles are actual land (not CITY)
      const invalidLand = landTiles.filter(
        (t) => t.terrainType === TerrainType.CITY,
      );
      if (invalidLand.length > 0) {
        errors.push('Fishery land tiles cannot be CITY terrain');
      }
    } else {
      // Standard validation: all tiles must be of allowed terrain types
      const invalidTiles = tiles.filter(
        (t) => !requirement.allowedTerrains.includes(t.terrainType as TerrainType),
      );
      if (invalidTiles.length > 0) {
        const allowedStr = requirement.allowedTerrains.join(', ');
        errors.push(
          `Category ${category} requires all tiles to be: ${allowedStr}. Found invalid terrain at tiles: ${invalidTiles.map((t) => `(${t.x},${t.y}):${t.terrainType}`).join(', ')}`,
        );
      }
    }

    // Validate contiguous rectangular arrangement
    if (errors.length === 0) {
      const contiguousError = this.validateContiguousRectangle(tiles, requirement.width, requirement.height);
      if (contiguousError) {
        errors.push(contiguousError);
      }
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Validates that tiles form a contiguous rectangle of the expected dimensions.
   */
  private validateContiguousRectangle(tiles: MapTile[], expectedWidth: number, expectedHeight: number): string | null {
    const xs = tiles.map((t) => t.x);
    const ys = tiles.map((t) => t.y);

    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);

    const actualWidth = maxX - minX + 1;
    const actualHeight = maxY - minY + 1;

    // Allow either orientation (WxH or HxW)
    const validOrientation1 = actualWidth === expectedWidth && actualHeight === expectedHeight;
    const validOrientation2 = actualWidth === expectedHeight && actualHeight === expectedWidth;

    if (!validOrientation1 && !validOrientation2) {
      return `Tiles must form a ${expectedWidth}×${expectedHeight} contiguous rectangle, but span ${actualWidth}×${actualHeight}`;
    }

    // Verify all positions within the bounding box are present
    const tileSet = new Set(tiles.map((t) => `${t.x},${t.y}`));
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        if (!tileSet.has(`${x},${y}`)) {
          return `Tiles must form a contiguous rectangle. Missing tile at (${x}, ${y})`;
        }
      }
    }

    return null;
  }

  // --- Season Helpers ---

  /**
   * Gets the currently active season.
   */
  async getActiveSeason(): Promise<Season | null> {
    return this.seasonRepository.findOne({
      where: { status: SeasonStatus.ACTIVE },
      order: { startsAt: 'DESC' },
    });
  }

  // --- Utility ---

  private createSimpleRng(seed: number): () => number {
    let s = seed | 0;
    return () => {
      s = (s + 0x6d2b79f5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
}
