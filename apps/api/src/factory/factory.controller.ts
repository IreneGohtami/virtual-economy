import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  Req,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { Request } from 'express';
import { Player } from '../entities/player.entity';
import { FactoryService } from './factory.service';
import { ConstructFactoryDto, SwitchOutputDto, RenameFactoryDto } from './dto';

@ApiTags('Factory')
@ApiBearerAuth()
@Controller('factories')
export class FactoryController {
  constructor(private readonly factoryService: FactoryService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Construct a new factory on owned land' })
  @ApiResponse({ status: 201, description: 'Factory constructed successfully' })
  @ApiResponse({ status: 400, description: 'Invalid tiles, terrain, or level' })
  @ApiResponse({ status: 403, description: 'Tiles not owned by the player' })
  @ApiResponse({ status: 402, description: 'Insufficient funds' })
  async construct(@Req() req: Request, @Body() dto: ConstructFactoryDto) {
    const player = req.user as Player;
    const factory = await this.factoryService.construct(player.id, dto);

    return {
      id: factory.id,
      name: factory.name,
      playerId: factory.playerId,
      seasonId: factory.seasonId,
      category: factory.category,
      factoryLevel: factory.factoryLevel,
      isShop: factory.isShop ?? false,
      status: factory.status,
      efficiency: Math.round(parseFloat(factory.efficiency)),
      maintenanceCount: factory.maintenanceCount,
      setupCost: Math.round(parseFloat(factory.setupCost)),
      commodityId: factory.commodityId,
      recipeId: factory.recipeId,
      exclusiveOutputSlug: factory.exclusiveOutputSlug,
      constructedAt: factory.constructedAt,
    };
  }

  @Get()
  @ApiOperation({ summary: "List all player's factories in the current season" })
  @ApiResponse({ status: 200, description: 'List of factories' })
  async findAll(@Req() req: Request) {
    const player = req.user as Player;
    const factories = await this.factoryService.findAllByPlayer(player.id);

    return factories.map((factory) => ({
      id: factory.id,
      name: factory.name,
      playerId: factory.playerId,
      seasonId: factory.seasonId,
      category: factory.category,
      factoryLevel: factory.factoryLevel,
      isShop: factory.isShop ?? false,
      status: factory.status,
      efficiency: Math.round(parseFloat(factory.efficiency)),
      maintenanceCount: factory.maintenanceCount,
      setupCost: Math.round(parseFloat(factory.setupCost)),
      commodityId: factory.commodityId,
      recipeId: factory.recipeId,
      exclusiveOutputSlug: factory.exclusiveOutputSlug,
      outputSwitchCooldownUntil: factory.outputSwitchCooldownUntil,
      fertilizerBoostActive: factory.fertilizerBoostActive,
      fertilizerBoostExpiresAt: factory.fertilizerBoostExpiresAt,
      constructedAt: factory.constructedAt,
      commoditySlug: factory.commodity?.slug ?? null,
      commodityName: factory.commodity?.name ?? null,
      workerCount: factory.workerAssignments?.length ?? 0,
    }));
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get factory details by ID' })
  @ApiParam({ name: 'id', description: 'Factory UUID' })
  @ApiResponse({ status: 200, description: 'Factory details' })
  @ApiResponse({ status: 404, description: 'Factory not found' })
  async findOne(@Req() req: Request, @Param('id') id: string) {
    const player = req.user as Player;
    const factory = await this.factoryService.findOneByPlayer(player.id, id);

    return {
      id: factory.id,
      name: factory.name,
      playerId: factory.playerId,
      seasonId: factory.seasonId,
      category: factory.category,
      factoryLevel: factory.factoryLevel,
      isShop: factory.isShop ?? false,
      status: factory.status,
      efficiency: Math.round(parseFloat(factory.efficiency)),
      maintenanceCount: factory.maintenanceCount,
      setupCost: Math.round(parseFloat(factory.setupCost)),
      commodityId: factory.commodityId,
      recipeId: factory.recipeId,
      exclusiveOutputSlug: factory.exclusiveOutputSlug,
      outputSwitchCooldownUntil: factory.outputSwitchCooldownUntil,
      fertilizerBoostActive: factory.fertilizerBoostActive,
      fertilizerBoostExpiresAt: factory.fertilizerBoostExpiresAt,
      lastDepreciationAt: factory.lastDepreciationAt,
      constructedAt: factory.constructedAt,
      workerAssignments: factory.workerAssignments?.map((wa) => ({
        id: wa.id,
        workerId: wa.workerId,
        status: wa.status,
        name: wa.workerProfile?.name ?? null,
        specialty: wa.workerProfile?.specialty ?? null,
      })) ?? [],
      commodity: factory.commodity
        ? { id: factory.commodity.id, name: factory.commodity.name, slug: factory.commodity.slug }
        : null,
      recipe: factory.recipe
        ? { id: factory.recipe.id, name: factory.recipe.name }
        : null,
      recipeInputs: await this.factoryService.getRecipeInputsWithInventory(player.id, factory),
      shopAcceptedGoods: factory.isShop
        ? await this.factoryService.getShopAcceptedGoods(player.id, factory)
        : [],
    };
  }

  @Put(':id/name')
  @ApiOperation({ summary: 'Rename a factory' })
  @ApiParam({ name: 'id', description: 'Factory UUID' })
  @ApiResponse({ status: 200, description: 'Factory renamed' })
  @ApiResponse({ status: 404, description: 'Factory not found' })
  async rename(@Req() req: Request, @Param('id') id: string, @Body() dto: RenameFactoryDto) {
    const player = req.user as Player;
    const factory = await this.factoryService.renameFactory(player.id, id, dto.name);
    return { id: factory.id, name: factory.name };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Deconstruct a factory (must be IDLE)' })
  @ApiParam({ name: 'id', description: 'Factory UUID' })
  @ApiResponse({ status: 200, description: 'Factory deconstructed, fee charged' })
  @ApiResponse({ status: 400, description: 'Factory not IDLE' })
  @ApiResponse({ status: 402, description: 'Insufficient funds for deconstruction fee' })
  @ApiResponse({ status: 404, description: 'Factory not found' })
  async deconstruct(@Req() req: Request, @Param('id') id: string) {
    const player = req.user as Player;
    const result = await this.factoryService.deconstruct(player.id, id);

    return {
      message: 'Factory deconstructed successfully',
      fee: result.fee,
    };
  }

  @Post(':id/maintenance')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Perform maintenance to restore factory efficiency' })
  @ApiParam({ name: 'id', description: 'Factory UUID' })
  @ApiResponse({ status: 200, description: 'Maintenance performed successfully' })
  @ApiResponse({ status: 400, description: 'Factory already at max efficiency' })
  @ApiResponse({ status: 402, description: 'Insufficient funds for maintenance' })
  @ApiResponse({ status: 404, description: 'Factory not found' })
  async performMaintenance(@Req() req: Request, @Param('id') id: string) {
    const player = req.user as Player;
    const result = await this.factoryService.performMaintenance(player.id, id);

    return {
      message: 'Maintenance performed successfully',
      newEfficiency: result.newEfficiency,
      maintenanceCount: result.maintenanceCount,
      cost: result.cost,
    };
  }

  @Post(':id/switch-output')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Switch exclusive output for Livestock/Fishery factories' })
  @ApiParam({ name: 'id', description: 'Factory UUID' })
  @ApiResponse({ status: 200, description: 'Output switched successfully' })
  @ApiResponse({ status: 400, description: 'Invalid output slug or unsupported category' })
  @ApiResponse({ status: 404, description: 'Factory not found' })
  @ApiResponse({ status: 409, description: 'Factory not IDLE or cooldown active' })
  async switchOutput(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: SwitchOutputDto,
  ) {
    const player = req.user as Player;
    const result = await this.factoryService.switchOutput(player.id, id, dto.outputSlug);

    return {
      message: 'Output switched successfully',
      factoryId: result.factoryId,
      oldOutput: result.oldOutput,
      newOutput: result.newOutput,
      cooldownUntil: result.cooldownUntil.toISOString(),
    };
  }

  @Post(':id/fertilizer')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Apply fertilizer boost to an Agriculture or Forestry factory' })
  @ApiParam({ name: 'id', description: 'Factory UUID' })
  @ApiResponse({ status: 200, description: 'Fertilizer applied successfully' })
  @ApiResponse({ status: 400, description: 'Invalid category, already boosted, or insufficient fertilizer' })
  @ApiResponse({ status: 404, description: 'Factory not found' })
  async applyFertilizer(@Req() req: Request, @Param('id') id: string) {
    const player = req.user as Player;
    const result = await this.factoryService.applyFertilizer(player.id, id);

    return {
      message: 'Fertilizer applied successfully',
      factoryId: result.factoryId,
      expiresAt: result.expiresAt.toISOString(),
      quantityConsumed: result.quantityConsumed,
      bonus: result.bonus,
    };
  }
}
