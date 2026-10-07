import {
  Controller,
  Get,
  Post,
  Req,
  HttpCode,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { Request } from 'express';
import { Player } from '../entities/player.entity';
import { InventoryService } from './inventory.service';

@ApiTags('Inventory')
@ApiBearerAuth()
@Controller('inventory')
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  @Get()
  @ApiOperation({ summary: "Get player's inventory for the current season" })
  @ApiResponse({ status: 200, description: 'Inventory items with commodity details and storage usage' })
  @ApiResponse({ status: 404, description: 'No active season found' })
  async getInventory(@Req() req: Request) {
    const player = req.user as Player;
    const seasonId = await this.inventoryService.getActiveSeasonId();
    const items = await this.inventoryService.getInventory(player.id, seasonId);
    const storage = await this.inventoryService.getStorageUsage(player.id, seasonId);
    const tiers = await this.inventoryService.getStorageTiers(player.id, seasonId);

    return {
      items,
      storage,
      tiers,
    };
  }

  @Post('storage/upgrade')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Upgrade storage capacity to the next tier' })
  @ApiResponse({ status: 200, description: 'Storage upgraded successfully' })
  @ApiResponse({ status: 400, description: 'Already at max tier' })
  @ApiResponse({ status: 402, description: 'Insufficient funds for upgrade' })
  @ApiResponse({ status: 404, description: 'No active season found' })
  async upgradeStorage(@Req() req: Request) {
    const player = req.user as Player;
    const seasonId = await this.inventoryService.getActiveSeasonId();
    const result = await this.inventoryService.upgradeStorage(player.id, seasonId);

    return {
      message: 'Storage upgraded successfully',
      previousCapacity: result.previousCapacity,
      newCapacity: result.newCapacity,
      cost: result.cost,
    };
  }
}
