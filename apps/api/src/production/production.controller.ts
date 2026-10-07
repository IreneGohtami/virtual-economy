import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Req,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
} from '@nestjs/swagger';
import { Request } from 'express';
import { Player } from '../entities/player.entity';
import { ProductionService } from './production.service';
import { StartProductionDto } from './dto';

@ApiTags('Production')
@ApiBearerAuth()
@Controller('production')
export class ProductionController {
  constructor(private readonly productionService: ProductionService) {}

  @Post('start')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Start a production job at a factory' })
  @ApiResponse({ status: 201, description: 'Production started successfully' })
  @ApiResponse({ status: 400, description: 'Validation failed (no workers, not IDLE, no output selected, insufficient inputs)' })
  @ApiResponse({ status: 404, description: 'Factory or commodity not found' })
  async startProduction(@Req() req: Request, @Body() dto: StartProductionDto) {
    const player = req.user as Player;
    const job = await this.productionService.startProduction(player.id, dto);

    return {
      id: job.id,
      factoryId: job.factoryId,
      commodityId: job.commodityId,
      recipeId: job.recipeId,
      status: job.status,
      baseYield: job.baseYield,
      finalYield: job.finalYield,
      unitsProduced: job.unitsProduced,
      incrementIntervalMinutes: job.incrementIntervalMinutes,
      effectiveProductionTimeMinutes: job.effectiveProductionTimeMinutes,
      startedAt: job.startedAt,
      completesAt: job.completesAt,
      yieldModifiers: job.yieldModifiers,
      inputSnapshot: job.inputSnapshot,
    };
  }

  @Get('jobs')
  @ApiOperation({ summary: "List player's production jobs in the current season" })
  @ApiResponse({ status: 200, description: 'List of production jobs' })
  async getJobs(@Req() req: Request) {
    const player = req.user as Player;
    const jobs = await this.productionService.getPlayerJobs(player.id);

    return jobs.map((job) => ({
      id: job.id,
      factoryId: job.factoryId,
      commodityId: job.commodityId,
      recipeId: job.recipeId,
      status: job.status,
      baseYield: job.baseYield,
      finalYield: job.finalYield,
      unitsProduced: job.unitsProduced,
      incrementIntervalMinutes: job.incrementIntervalMinutes,
      effectiveProductionTimeMinutes: job.effectiveProductionTimeMinutes,
      startedAt: job.startedAt,
      completesAt: job.completesAt,
      pausedAt: job.pausedAt,
      completedAt: job.completedAt,
      pauseReason: job.pauseReason,
      yieldModifiers: job.yieldModifiers,
      commodity: job.commodity
        ? { id: job.commodity.id, name: job.commodity.name, slug: job.commodity.slug }
        : null,
      factory: job.factory
        ? { id: job.factory.id, category: job.factory.category, factoryLevel: job.factory.factoryLevel }
        : null,
    }));
  }

  @Get('jobs/:id')
  @ApiParam({ name: 'id', description: 'Production job UUID' })
  @ApiOperation({ summary: 'Get a specific production job by ID' })
  @ApiResponse({ status: 200, description: 'Production job details' })
  @ApiResponse({ status: 404, description: 'Production job not found' })
  async getJobById(@Req() req: Request, @Param('id') id: string) {
    const player = req.user as Player;
    const job = await this.productionService.getJobById(player.id, id);

    return {
      id: job.id,
      factoryId: job.factoryId,
      commodityId: job.commodityId,
      recipeId: job.recipeId,
      seasonId: job.seasonId,
      status: job.status,
      baseYield: job.baseYield,
      finalYield: job.finalYield,
      unitsProduced: job.unitsProduced,
      incrementIntervalMinutes: job.incrementIntervalMinutes,
      effectiveProductionTimeMinutes: job.effectiveProductionTimeMinutes,
      startedAt: job.startedAt,
      completesAt: job.completesAt,
      pausedAt: job.pausedAt,
      completedAt: job.completedAt,
      pauseReason: job.pauseReason,
      yieldModifiers: job.yieldModifiers,
      inputSnapshot: job.inputSnapshot,
      commodity: job.commodity
        ? { id: job.commodity.id, name: job.commodity.name, slug: job.commodity.slug, category: job.commodity.category }
        : null,
      factory: job.factory
        ? { id: job.factory.id, category: job.factory.category, factoryLevel: job.factory.factoryLevel, status: job.factory.status }
        : null,
      recipe: job.recipe
        ? { id: job.recipe.id, name: job.recipe.name, slug: job.recipe.slug }
        : null,
    };
  }

  @Post('auto-start')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Auto-start production on all idle factories that have workers assigned' })
  @ApiResponse({ status: 200, description: 'Production started on eligible factories' })
  async autoStart(@Req() req: Request) {
    const player = req.user as Player;
    const results = await this.productionService.autoStartAllIdle(player.id);
    return { started: results.length, factories: results };
  }

}
