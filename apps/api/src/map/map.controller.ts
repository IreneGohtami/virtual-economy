import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  Req,
  HttpCode,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { Request } from 'express';
import { Player } from '../entities/player.entity';
import { PlayerService } from '../player/player.service';
import { MapService, BoundingBox } from './map.service';
import { LandService } from './land.service';
import { PurchaseTilesDto, ResellTilesDto, ValidateTerrainDto } from './dto';

@ApiTags('Map')
@ApiBearerAuth()
@Controller('map')
export class MapController {
  constructor(
    private readonly mapService: MapService,
    private readonly landService: LandService,
    private readonly playerService: PlayerService,
  ) {}

  @Get('tiles')
  @ApiOperation({ summary: 'Get tiles within viewport bounds' })
  @ApiQuery({ name: 'seasonId', type: 'string', required: true })
  @ApiQuery({ name: 'minX', type: 'number', required: true })
  @ApiQuery({ name: 'minY', type: 'number', required: true })
  @ApiQuery({ name: 'maxX', type: 'number', required: true })
  @ApiQuery({ name: 'maxY', type: 'number', required: true })
  async getTiles(
    @Query('seasonId') seasonId: string,
    @Query('minX') minX: number,
    @Query('minY') minY: number,
    @Query('maxX') maxX: number,
    @Query('maxY') maxY: number,
  ) {
    const bounds: BoundingBox = { minX, minY, maxX, maxY };
    return this.mapService.getTiles(seasonId, bounds);
  }

  @Post('tiles/purchase')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Purchase a group of tiles' })
  @ApiResponse({ status: 200, description: 'Tiles purchased successfully' })
  @ApiResponse({ status: 400, description: 'Invalid tile selection (not contiguous, already owned, etc.)' })
  @ApiResponse({ status: 403, description: 'CITY tiles locked or insufficient funds' })
  @ApiResponse({ status: 404, description: 'Tiles not found' })
  async purchaseTiles(@Req() req: Request, @Body() dto: PurchaseTilesDto) {
    const player = req.user as Player;
    await this.playerService.updateLastActiveAt(player.id);

    const seasonId = await this.getActiveSeasonId();
    const result = await this.landService.purchaseTiles(player.id, seasonId, dto.tileIds);

    return {
      purchasedTiles: result.purchasedTiles,
      totalCost: result.totalCost,
      newBalance: result.newBalance,
    };
  }

  @Post('tiles/resell')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Resell owned tiles at 50% of purchase price' })
  @ApiResponse({ status: 200, description: 'Tiles resold successfully' })
  @ApiResponse({ status: 400, description: 'Tiles have factories or invalid selection' })
  @ApiResponse({ status: 403, description: 'Player does not own tiles' })
  @ApiResponse({ status: 404, description: 'Tiles not found' })
  async resellTiles(@Req() req: Request, @Body() dto: ResellTilesDto) {
    const player = req.user as Player;
    await this.playerService.updateLastActiveAt(player.id);

    const seasonId = await this.getActiveSeasonId();
    const result = await this.landService.resellTiles(player.id, seasonId, dto.tileIds);

    return {
      resoldTiles: result.resoldTiles,
      totalRefund: result.totalRefund,
      newBalance: result.newBalance,
    };
  }

  @Get('tiles/validate')
  @ApiOperation({ summary: 'Validate terrain for a commodity category' })
  @ApiQuery({ name: 'tileIds', type: 'string', required: true, description: 'Comma-separated tile UUIDs' })
  @ApiQuery({ name: 'category', type: 'string', required: true, description: 'Commodity category' })
  @ApiResponse({ status: 200, description: 'Validation result' })
  async validateTerrain(
    @Query('tileIds') tileIdsStr: string,
    @Query('category') category: string,
    @Req() req: Request,
  ) {
    const player = req.user as Player;
    await this.playerService.updateLastActiveAt(player.id);

    const tileIds = tileIdsStr.split(',').map((id) => id.trim());
    return this.mapService.validateTerrain(tileIds, category as any);
  }

  /**
   * Helper to get the active season ID.
   * Fetches from the Season repository via MapService's season repo.
   */
  private async getActiveSeasonId(): Promise<string> {
    const season = await this.mapService.getActiveSeason();
    if (!season) {
      throw new NotFoundException('No active season found');
    }
    return season.id;
  }
}
