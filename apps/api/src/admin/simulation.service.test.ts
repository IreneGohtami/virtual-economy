import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SimulationService, SimulationInputParameters } from './simulation.service';
import { Repository } from 'typeorm';
import { SimulationRun } from '../entities/simulation-run.entity';
import { Commodity } from '../entities/commodity.entity';
import { Recipe } from '../entities/recipe.entity';
import { RecipeInput } from '../entities/recipe-input.entity';
import { NotFoundException } from '@nestjs/common';

describe('SimulationService', () => {
  let service: SimulationService;
  let mockSimulationRunRepo: Partial<Repository<SimulationRun>>;
  let mockCommodityRepo: Partial<Repository<Commodity>>;
  let mockRecipeRepo: Partial<Repository<Recipe>>;
  let mockRecipeInputRepo: Partial<Repository<RecipeInput>>;

  const operatorId = '11111111-1111-1111-1111-111111111111';

  const mockCommodities: Partial<Commodity>[] = [
    {
      id: 'c1',
      slug: 'rice',
      name: 'Rice',
      category: 'AGRICULTURE',
      level: 0,
      basePrice: '10.00',
      baseYield: 8,
      baseProductionTimeMinutes: 120,
      storageSize: 1,
      maxWorkers: 2,
      terrainRequirement: 'FERTILE_SOIL',
      landLayout: '3x3',
      setupCost: '300.00',
      metadata: {},
      active: true,
    },
    {
      id: 'c2',
      slug: 'flour',
      name: 'Flour',
      category: 'AGRICULTURE',
      level: 1,
      basePrice: '25.00',
      baseYield: 4,
      baseProductionTimeMinutes: 90,
      storageSize: 1,
      maxWorkers: 2,
      terrainRequirement: null,
      landLayout: null,
      setupCost: '350.00',
      metadata: {},
      active: true,
    },
    {
      id: 'c3',
      slug: 'palm-oil',
      name: 'Palm Oil',
      category: 'AGRICULTURE',
      level: 0,
      basePrice: '15.00',
      baseYield: 6,
      baseProductionTimeMinutes: 180,
      storageSize: 1,
      maxWorkers: 2,
      terrainRequirement: 'FERTILE_SOIL',
      landLayout: '3x3',
      setupCost: '300.00',
      metadata: {},
      active: true,
    },
  ];

  const mockRecipes: Partial<Recipe>[] = [
    {
      id: 'r1',
      slug: 'rice-to-flour',
      name: 'Rice → Flour',
      processingTimeMinutes: 90,
      workerRequirement: 1,
      outputCommodityId: 'c2',
      outputQuantity: 4,
      factoryCategory: 'AGRICULTURE',
      metadata: {},
      active: true,
      outputCommodity: mockCommodities[1] as Commodity,
      inputs: [
        { id: 'ri1', recipeId: 'r1', commodityId: 'c1', quantity: 3 } as RecipeInput,
      ],
    },
  ];

  beforeEach(() => {
    mockSimulationRunRepo = {
      create: vi.fn().mockImplementation((data) => ({ ...data, id: 'sim-1' })),
      save: vi.fn().mockImplementation((entity) => Promise.resolve(entity)),
      findOne: vi.fn().mockResolvedValue(null),
      find: vi.fn().mockResolvedValue([]),
    };

    mockCommodityRepo = {
      find: vi.fn().mockResolvedValue(mockCommodities),
    };

    mockRecipeRepo = {
      find: vi.fn().mockResolvedValue(mockRecipes),
    };

    mockRecipeInputRepo = {
      find: vi.fn().mockResolvedValue([]),
    };

    service = new SimulationService(
      mockSimulationRunRepo as Repository<SimulationRun>,
      mockCommodityRepo as Repository<Commodity>,
      mockRecipeRepo as Repository<Recipe>,
      mockRecipeInputRepo as Repository<RecipeInput>,
    );
  });

  describe('executeSimulation', () => {
    it('should return results with correct structure for a basic simulation', async () => {
      const params: SimulationInputParameters = {
        simulatedDays: 10,
        factoryEfficiency: 100,
        productionCyclesPerDay: 1,
        playerCount: 5,
      };

      const results = await service.executeSimulation(params);

      expect(results).toBeDefined();
      expect(results.commodityProjections).toHaveLength(3);
      expect(results.chainEarnings).toBeDefined();
      expect(results.equilibriumPoints).toBeDefined();
      expect(results.flowRatios).toBeDefined();
      expect(results.summary).toBeDefined();
      expect(results.summary.totalDaysSimulated).toBe(10);
      expect(results.summary.totalCommoditiesModeled).toBe(3);
    });

    it('should hold prices at base values during stabilization period (first 7 days)', async () => {
      const params: SimulationInputParameters = {
        simulatedDays: 7,
        factoryEfficiency: 100,
        productionCyclesPerDay: 1,
        playerCount: 5,
      };

      const results = await service.executeSimulation(params);

      // During stabilization, prices should equal base prices
      const riceProjection = results.commodityProjections.find((c) => c.slug === 'rice');
      expect(riceProjection).toBeDefined();
      // All 7 days should be at base price (10.00)
      for (const price of riceProjection!.priceTrajectory) {
        expect(price).toBe(10.00);
      }
    });

    it('should apply dynamic pricing after stabilization period', async () => {
      const params: SimulationInputParameters = {
        simulatedDays: 14,
        factoryEfficiency: 100,
        productionCyclesPerDay: 1,
        playerCount: 5,
      };

      const results = await service.executeSimulation(params);

      const riceProjection = results.commodityProjections.find((c) => c.slug === 'rice');
      expect(riceProjection).toBeDefined();
      expect(riceProjection!.priceTrajectory.length).toBe(14);

      // First 7 days: base price
      for (let i = 0; i < 7; i++) {
        expect(riceProjection!.priceTrajectory[i]).toBe(10.00);
      }

      // After day 7: price should change (either up or down based on supply/demand)
      // With production and demand simulated, prices should differ from base
      const postStabilizationPrices = riceProjection!.priceTrajectory.slice(7);
      const allBasePrice = postStabilizationPrices.every((p) => p === 10.00);
      // At least some prices should differ (supply/demand imbalance)
      expect(allBasePrice).toBe(false);
    });

    it('should compute chain earnings for recipes', async () => {
      const params: SimulationInputParameters = {
        simulatedDays: 10,
        factoryEfficiency: 100,
        productionCyclesPerDay: 1,
        playerCount: 5,
      };

      const results = await service.executeSimulation(params);

      expect(results.chainEarnings.length).toBeGreaterThan(0);
      const firstChain = results.chainEarnings[0];
      expect(firstChain.chainName).toBeDefined();
      expect(firstChain.totalRevenue).toBeGreaterThanOrEqual(0);
      expect(firstChain.totalInputCost).toBeGreaterThanOrEqual(0);
      expect(firstChain.dailyProfit).toBeDefined();
    });

    it('should respect custom base price overrides', async () => {
      const params: SimulationInputParameters = {
        simulatedDays: 5,
        basePrices: { rice: 50.00 },
        factoryEfficiency: 100,
        productionCyclesPerDay: 1,
        playerCount: 5,
      };

      const results = await service.executeSimulation(params);

      const riceProjection = results.commodityProjections.find((c) => c.slug === 'rice');
      expect(riceProjection).toBeDefined();
      // During stabilization, price should equal the overridden base price
      expect(riceProjection!.priceTrajectory[0]).toBe(50.00);
    });

    it('should respect yield overrides', async () => {
      const defaultParams: SimulationInputParameters = {
        simulatedDays: 5,
        factoryEfficiency: 100,
        productionCyclesPerDay: 1,
        playerCount: 5,
      };

      const boostedParams: SimulationInputParameters = {
        simulatedDays: 5,
        yields: { rice: 20 }, // Much higher yield
        factoryEfficiency: 100,
        productionCyclesPerDay: 1,
        playerCount: 5,
      };

      const defaultResults = await service.executeSimulation(defaultParams);
      const boostedResults = await service.executeSimulation(boostedParams);

      const defaultRice = defaultResults.commodityProjections.find((c) => c.slug === 'rice')!;
      const boostedRice = boostedResults.commodityProjections.find((c) => c.slug === 'rice')!;

      // Higher yield should result in more daily production
      expect(boostedRice.dailyProduction).toBeGreaterThan(defaultRice.dailyProduction);
    });

    it('should compute flow ratios for all commodities', async () => {
      const params: SimulationInputParameters = {
        simulatedDays: 10,
        factoryEfficiency: 100,
        productionCyclesPerDay: 1,
        playerCount: 5,
      };

      const results = await service.executeSimulation(params);

      expect(results.flowRatios['rice']).toBeDefined();
      expect(results.flowRatios['flour']).toBeDefined();
      expect(results.flowRatios['palm-oil']).toBeDefined();
    });

    it('should detect equilibrium points when supply matches demand', async () => {
      const params: SimulationInputParameters = {
        simulatedDays: 30,
        factoryEfficiency: 100,
        productionCyclesPerDay: 1,
        playerCount: 10,
      };

      const results = await service.executeSimulation(params);

      // equilibriumPoints should be defined for all commodities (either a day number or null)
      expect(results.equilibriumPoints).toBeDefined();
      expect('rice' in results.equilibriumPoints).toBe(true);
      expect('flour' in results.equilibriumPoints).toBe(true);
    });

    it('should handle reduced factory efficiency', async () => {
      const normalParams: SimulationInputParameters = {
        simulatedDays: 5,
        factoryEfficiency: 100,
        productionCyclesPerDay: 1,
        playerCount: 5,
      };

      const reducedParams: SimulationInputParameters = {
        simulatedDays: 5,
        factoryEfficiency: 50, // Half efficiency
        productionCyclesPerDay: 1,
        playerCount: 5,
      };

      const normalResults = await service.executeSimulation(normalParams);
      const reducedResults = await service.executeSimulation(reducedParams);

      const normalRice = normalResults.commodityProjections.find((c) => c.slug === 'rice')!;
      const reducedRice = reducedResults.commodityProjections.find((c) => c.slug === 'rice')!;

      // Lower efficiency → longer production time → potentially fewer cycles → less daily production
      expect(reducedRice.dailyProduction).toBeLessThanOrEqual(normalRice.dailyProduction);
    });
  });

  describe('runSimulation', () => {
    it('should create a simulation run record and persist results', async () => {
      const params: SimulationInputParameters = {
        simulatedDays: 5,
        factoryEfficiency: 100,
        productionCyclesPerDay: 1,
        playerCount: 5,
      };

      const result = await service.runSimulation(operatorId, params);

      expect(mockSimulationRunRepo.create).toHaveBeenCalled();
      expect(mockSimulationRunRepo.save).toHaveBeenCalled();
      expect(result.status).toBe('COMPLETED');
      expect(result.outputResults).toBeDefined();
      expect(result.completedAt).toBeDefined();
    });

    it('should mark simulation as FAILED on error', async () => {
      // Force an error by making commodity repo throw
      (mockCommodityRepo.find as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('DB connection lost'),
      );

      const params: SimulationInputParameters = {
        simulatedDays: 5,
      };

      const result = await service.runSimulation(operatorId, params);

      expect(result.status).toBe('FAILED');
      expect(result.outputResults).toHaveProperty('error');
    });
  });

  describe('getSimulationResult', () => {
    it('should return a simulation run by id', async () => {
      const mockRun: Partial<SimulationRun> = {
        id: 'sim-1',
        status: 'COMPLETED',
        simulatedDays: 10,
        inputParameters: {},
        outputResults: { summary: {} },
        startedAt: new Date(),
        completedAt: new Date(),
      };
      (mockSimulationRunRepo.findOne as ReturnType<typeof vi.fn>).mockResolvedValue(mockRun);

      const result = await service.getSimulationResult('sim-1');
      expect(result.id).toBe('sim-1');
      expect(result.status).toBe('COMPLETED');
    });

    it('should throw NotFoundException for unknown id', async () => {
      (mockSimulationRunRepo.findOne as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      await expect(service.getSimulationResult('unknown')).rejects.toThrow(NotFoundException);
    });
  });

  describe('listSimulations', () => {
    it('should return list of simulation runs', async () => {
      const mockRuns: Partial<SimulationRun>[] = [
        { id: 'sim-1', status: 'COMPLETED', simulatedDays: 10 },
        { id: 'sim-2', status: 'RUNNING', simulatedDays: 30 },
      ];
      (mockSimulationRunRepo.find as ReturnType<typeof vi.fn>).mockResolvedValue(mockRuns);

      const result = await service.listSimulations();
      expect(result).toHaveLength(2);
    });
  });
});
