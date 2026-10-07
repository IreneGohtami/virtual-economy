import {
  Controller,
  Get,
  Post,
  Put,
  Param,
  Body,
  HttpCode,
  HttpStatus,
  UseGuards,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiBody,
} from '@nestjs/swagger';
import { AdminGuard } from './admin.guard';
import { SkipThrottle } from '../common';
import { SimulationService, SimulationInputParameters } from './simulation.service';
import { AdvancedSimulationService, AdvancedSimulationParams } from './advanced-simulation.service';
import { AdminConfigService } from './config.service';

@ApiTags('Admin')
@ApiBearerAuth()
@UseGuards(AdminGuard)
@SkipThrottle() // Admin endpoints are IP-whitelisted; no rate limiting needed
@Controller('admin')
export class AdminController {
  constructor(
    private readonly simulationService: SimulationService,
    private readonly advancedSimulationService: AdvancedSimulationService,
    private readonly configService: AdminConfigService,
  ) {}

  // ==================== Simulation Endpoints ====================

  @Post('simulation/run')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Run a recipe simulation with configurable parameters' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['simulatedDays'],
      properties: {
        simulatedDays: { type: 'number', description: 'Number of days to simulate', example: 30 },
        basePrices: { type: 'object', description: 'Override base prices keyed by commodity slug' },
        productionTimes: { type: 'object', description: 'Override production times (minutes) keyed by commodity slug' },
        yields: { type: 'object', description: 'Override base yields keyed by commodity slug' },
        recipeProcessingTimes: { type: 'object', description: 'Override recipe processing times keyed by recipe slug' },
        averageSalary: { type: 'number', description: 'Average worker salary for cost projection' },
        storageCosts: { type: 'array', items: { type: 'number' }, description: 'Storage tier costs' },
        demandRates: { type: 'object', description: 'Shop demand rates keyed by commodity slug' },
        factoryEfficiency: { type: 'number', description: 'Factory efficiency percentage (0-100)', example: 100 },
        productionCyclesPerDay: { type: 'number', description: 'Production cycles per day per factory', example: 1 },
        playerCount: { type: 'number', description: 'Number of simulated players', example: 10 },
        label: { type: 'string', description: 'Label for this simulation run' },
      },
    },
  })
  @ApiResponse({ status: 201, description: 'Simulation completed' })
  @ApiResponse({ status: 403, description: 'Admin access denied' })
  async runSimulation(
    @Req() req: Request,
    @Body() params: SimulationInputParameters,
  ) {
    const player = (req as any).user;
    const operatorId = player?.id || '00000000-0000-0000-0000-000000000000';
    const result = await this.simulationService.runSimulation(operatorId, params);
    return {
      id: result.id,
      status: result.status,
      simulatedDays: result.simulatedDays,
      startedAt: result.startedAt,
      completedAt: result.completedAt,
      results: result.outputResults,
    };
  }

  @Get('simulation/results/:id')
  @ApiOperation({ summary: 'Get simulation results by ID' })
  @ApiParam({ name: 'id', description: 'Simulation run UUID' })
  @ApiResponse({ status: 200, description: 'Simulation results' })
  @ApiResponse({ status: 404, description: 'Simulation run not found' })
  async getSimulationResults(@Param('id') id: string) {
    const run = await this.simulationService.getSimulationResult(id);
    return {
      id: run.id,
      status: run.status,
      simulatedDays: run.simulatedDays,
      inputParameters: run.inputParameters,
      results: run.outputResults,
      startedAt: run.startedAt,
      completedAt: run.completedAt,
    };
  }

  @Get('simulation/list')
  @ApiOperation({ summary: 'List all simulation runs' })
  @ApiResponse({ status: 200, description: 'List of simulation runs' })
  async listSimulations() {
    const runs = await this.simulationService.listSimulations();
    return {
      simulations: runs.map((r) => ({
        id: r.id,
        status: r.status,
        simulatedDays: r.simulatedDays,
        label: (r.inputParameters as Record<string, unknown>)?.label ?? null,
        startedAt: r.startedAt,
        completedAt: r.completedAt,
      })),
    };
  }

  @Post('simulation/advanced')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Run an advanced agent-based Monte Carlo simulation' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['playerCount', 'days'],
      properties: {
        playerCount: { type: 'number', description: 'Number of simulated players', example: 100 },
        days: { type: 'number', description: 'Number of days to simulate', example: 30 },
        mapWidth: { type: 'number', description: 'Map width in tiles (default: 100)', example: 100 },
        mapHeight: { type: 'number', description: 'Map height in tiles (default: 100)', example: 100 },
        eventFrequency: { type: 'string', enum: ['low', 'medium', 'high'], description: 'Random event frequency (default: medium)' },
      },
    },
  })
  @ApiResponse({ status: 201, description: 'Advanced simulation completed' })
  @ApiResponse({ status: 403, description: 'Admin access denied' })
  async runAdvancedSimulation(
    @Req() req: Request,
    @Body() params: AdvancedSimulationParams,
  ) {
    const player = (req as any).user;
    const operatorId = player?.id || '00000000-0000-0000-0000-000000000000';
    const result = await this.advancedSimulationService.runAdvancedSimulation(operatorId, params);
    return {
      id: result.id,
      status: result.status,
      simulatedDays: result.simulatedDays,
      startedAt: result.startedAt,
      completedAt: result.completedAt,
      results: result.outputResults,
    };
  }

  // ==================== Configuration Endpoints ====================

  @Put('config/commodities')
  @ApiOperation({ summary: 'Update commodity configuration (base prices, yields, production times)' })
  @ApiBody({
    schema: {
      type: 'object',
      description: 'Commodity configuration overrides as JSON',
    },
  })
  @ApiResponse({ status: 200, description: 'Commodity config updated' })
  async updateCommodityConfig(@Req() req: Request, @Body() body: Record<string, unknown>) {
    const operatorId = (req as any).user?.id;
    const config = await this.configService.updateCommodityConfig(body, operatorId);
    return {
      key: config.key,
      value: config.value,
      updatedAt: config.updatedAt,
    };
  }

  @Put('config/recipes')
  @ApiOperation({ summary: 'Update recipe configuration (processing times, inputs, outputs)' })
  @ApiBody({
    schema: {
      type: 'object',
      description: 'Recipe configuration overrides as JSON',
    },
  })
  @ApiResponse({ status: 200, description: 'Recipe config updated' })
  async updateRecipeConfig(@Req() req: Request, @Body() body: Record<string, unknown>) {
    const operatorId = (req as any).user?.id;
    const config = await this.configService.updateRecipeConfig(body, operatorId);
    return {
      key: config.key,
      value: config.value,
      updatedAt: config.updatedAt,
    };
  }

  @Get('config')
  @ApiOperation({ summary: 'Get all game configuration entries' })
  @ApiResponse({ status: 200, description: 'All config entries' })
  async getAllConfig() {
    const configs = await this.configService.getAll();
    return { configs };
  }

  @Get('config/:key')
  @ApiOperation({ summary: 'Get a specific configuration entry' })
  @ApiParam({ name: 'key', description: 'Configuration key' })
  @ApiResponse({ status: 200, description: 'Config entry' })
  @ApiResponse({ status: 404, description: 'Config key not found' })
  async getConfig(@Param('key') key: string) {
    return this.configService.getByKey(key);
  }

  @Get('data/commodities')
  @ApiOperation({ summary: 'Get all commodity definitions from the database' })
  @ApiResponse({ status: 200, description: 'All commodities grouped by level' })
  async getCommodities() {
    return this.simulationService.getCommoditiesFromDb();
  }

  @Get('data/recipes')
  @ApiOperation({ summary: 'Get all recipe definitions from the database' })
  @ApiResponse({ status: 200, description: 'All recipes with inputs grouped by level' })
  async getRecipes() {
    return this.simulationService.getRecipesFromDb();
  }


  @Get('data/combined')
  @ApiOperation({ summary: 'Get all commodities with recipe data merged into a single list' })
  @ApiResponse({ status: 200, description: 'Combined commodity + recipe data' })
  async getCombinedData() {
    const data = await this.simulationService.getCombinedCommodityData();
    return { commodities: data };
  }

  @Put('data/commodity/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update a single commodity fields (base price, prod time, yield, storage, setup cost)' })
  @ApiParam({ name: 'id', description: 'Commodity UUID' })
  @ApiResponse({ status: 200, description: 'Commodity updated' })
  async updateCommodityData(
    @Param('id') id: string,
    @Body() body: { base_price?: number; production_time_minutes?: number; base_yield?: number; storage_size?: number; setup_cost?: number; recipe_id?: string; recipe_inputs?: Array<{ commodity_slug: string; quantity: number }> },
  ) {
    await this.simulationService.updateCommodity(id, body);
    // If there's a recipe, update it too
    if (body.recipe_id && (body.production_time_minutes !== undefined || body.base_yield !== undefined)) {
      await this.simulationService.updateRecipe(body.recipe_id, {
        processing_time_minutes: body.production_time_minutes,
        output_quantity: body.base_yield,
      });
    }
    // Update recipe inputs if provided
    if (body.recipe_id && body.recipe_inputs) {
      await this.simulationService.updateRecipeInputs(body.recipe_id, body.recipe_inputs);
    }
    return { success: true };
  }


  @Get('data/happiness-boosts')
  @ApiOperation({ summary: 'Get happiness boost definitions' })
  @ApiResponse({ status: 200, description: 'Current happiness boost config' })
  async getHappinessBoosts() {
    const config = await this.configService.getByKey('happiness_boosts').catch(() => null);
    if (config) {
      return { boosts: config.value };
    }
    // Return defaults from happiness service
    return {
      boosts: [
        { slug: 'meals', name: 'Team Meals', costPerWorker: 20, happinessIncrease: 5 },
        { slug: 'company-trip', name: 'Company Trip', costPerWorker: 50, happinessIncrease: 10 },
        { slug: 'salary-raise', name: 'Salary Raise', costPerWorker: 80, happinessIncrease: 15 },
      ],
    };
  }

  @Put('data/happiness-boosts')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update happiness boost definitions' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        boosts: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              slug: { type: 'string' },
              name: { type: 'string' },
              cost: { type: 'number' },
              happinessIncrease: { type: 'number' },
            },
          },
        },
      },
    },
  })
  @ApiResponse({ status: 200, description: 'Boosts config saved' })
  async updateHappinessBoosts(
    @Req() req: Request,
    @Body() body: { boosts: Array<{ slug: string; name: string; icon?: string; costPerWorker: number; happinessIncrease: number; cooldownDays?: number }> },
  ) {
    const player = (req as any).user;
    const operatorId = player?.id;
    const config = await this.configService.upsert(
      'happiness_boosts',
      { value: body.boosts as unknown as Record<string, unknown>, description: 'Happiness boost definitions' },
      operatorId,
    );
    return { success: true, boosts: config.value };
  }


  @Get('data/salary-config')
  @ApiOperation({ summary: 'Get worker salary configuration by experience and specialty' })
  @ApiResponse({ status: 200, description: 'Salary rate config' })
  async getSalaryConfig() {
    const config = await this.configService.getByKey('salary_config').catch(() => null);
    if (config) {
      return config.value;
    }
    // Return defaults
    return {
      specialties: [
        { key: 'farmer', icon: '🌾', label: 'Farmer', covers: 'Agriculture (rice, palm, cocoa, coffee)', baseSalary: [10, 12, 15, 18, 22] },
        { key: 'driller', icon: '🛢️', label: 'Driller', covers: 'Energy (crude oil, natural gas)', baseSalary: [14, 17, 21, 25, 31] },
        { key: 'miner', icon: '⛏️', label: 'Miner', covers: 'Metals (iron ore, nickel ore)', baseSalary: [13, 16, 20, 24, 30] },
        { key: 'rancher', icon: '🐄', label: 'Rancher', covers: 'Livestock (poultry, cattle)', baseSalary: [11, 13, 16, 19, 24] },
        { key: 'fisherman', icon: '🐟', label: 'Fisherman', covers: 'Fishery (fish)', baseSalary: [10, 12, 15, 18, 22] },
        { key: 'lumberjack', icon: '🪵', label: 'Lumberjack', covers: 'Forestry (timber, rubber)', baseSalary: [11, 13, 16, 19, 24] },
        { key: 'shopkeeper', icon: '🏪', label: 'Shopkeeper', covers: 'All shop types', baseSalary: [12, 15, 18, 22, 28] },
        { key: 'engineer', icon: '🔧', label: 'Engineer', covers: 'All L1 processing factories', baseSalary: [20, 25, 32, 40, 50] },
        { key: 'technician', icon: '🔬', label: 'Technician', covers: 'All L2 assembly plants', baseSalary: [30, 38, 48, 60, 75] },
      ],
      experienceLevels: ['Novice', 'Apprentice', 'Skilled', 'Expert', 'Master'],
    };
  }

  @Put('data/salary-config')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update worker salary configuration' })
  @ApiResponse({ status: 200, description: 'Salary config saved' })
  async updateSalaryConfig(
    @Req() req: Request,
    @Body() body: Record<string, unknown>,
  ) {
    const operatorId = (req as any).user?.id;
    const config = await this.configService.upsert(
      'salary_config',
      { value: body as Record<string, unknown>, description: 'Worker salary rates by experience and specialty' },
      operatorId,
    );
    return { success: true, config: config.value };
  }

  @Post('workers/generate')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Generate additional random workers for the active season' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['count'],
      properties: {
        count: { type: 'number', description: 'Number of workers to generate', example: 100 },
      },
    },
  })
  @ApiResponse({ status: 201, description: 'Workers generated' })
  async generateWorkers(@Body() body: { count: number }) {
    const count = Math.min(body.count || 100, 5000);
    const result = await this.simulationService.generateExtraWorkers(count);
    return result;
  }

}
