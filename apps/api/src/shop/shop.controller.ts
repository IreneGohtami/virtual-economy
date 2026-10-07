import {
  Controller,
  Get,
  Post,
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
import { ShopService } from './shop.service';
import { ConstructShopDto, StockShopDto } from './dto';

@ApiTags('Shop')
@ApiBearerAuth()
@Controller('shops')
export class ShopController {
  constructor(private readonly shopService: ShopService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Construct a new shop on a CITY tile' })
  @ApiResponse({ status: 201, description: 'Shop constructed successfully' })
  @ApiResponse({ status: 400, description: 'Invalid tile terrain or tile occupied' })
  @ApiResponse({ status: 402, description: 'Insufficient funds' })
  @ApiResponse({ status: 403, description: 'Tile not owned by the player' })
  @ApiResponse({ status: 404, description: 'Tile not found' })
  async construct(@Req() req: Request, @Body() dto: ConstructShopDto) {
    const player = req.user as Player;
    const shop = await this.shopService.construct(player.id, dto);

    return {
      id: shop.id,
      playerId: shop.playerId,
      seasonId: shop.seasonId,
      tileId: shop.tileId,
      shopType: shop.shopType,
      level: shop.level,
      storageCapacity: shop.storageCapacity,
      demandRate: parseFloat(shop.demandRate),
      constructedAt: shop.constructedAt,
    };
  }

  @Get()
  @ApiOperation({ summary: "List all player's shops in the current season" })
  @ApiResponse({ status: 200, description: 'List of shops' })
  async findAll(@Req() req: Request) {
    const player = req.user as Player;
    const shops = await this.shopService.getShops(player.id);

    return shops.map((shop) => ({
      id: shop.id,
      playerId: shop.playerId,
      seasonId: shop.seasonId,
      tileId: shop.tileId,
      shopType: shop.shopType,
      level: shop.level,
      storageCapacity: shop.storageCapacity,
      demandRate: parseFloat(shop.demandRate),
      constructedAt: shop.constructedAt,
      inventory: shop.shopInventories?.map((si) => ({
        commodityId: si.commodityId,
        quantity: si.quantity,
      })) ?? [],
    }));
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Deconstruct a shop (25% fee of setup cost)' })
  @ApiParam({ name: 'id', description: 'Shop UUID' })
  @ApiResponse({ status: 200, description: 'Shop deconstructed, fee charged' })
  @ApiResponse({ status: 402, description: 'Insufficient funds for deconstruction fee' })
  @ApiResponse({ status: 404, description: 'Shop not found' })
  async deconstruct(@Req() req: Request, @Param('id') id: string) {
    const player = req.user as Player;
    const result = await this.shopService.deconstruct(player.id, id);

    return {
      message: 'Shop deconstructed successfully',
      fee: result.fee,
    };
  }

  @Post(':id/stock')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Stock a shop with commodities from player inventory' })
  @ApiParam({ name: 'id', description: 'Shop UUID' })
  @ApiResponse({ status: 200, description: 'Shop stocked successfully' })
  @ApiResponse({ status: 400, description: 'Commodity not accepted or shop full' })
  @ApiResponse({ status: 404, description: 'Shop not found' })
  async stock(@Req() req: Request, @Param('id') id: string, @Body() dto: StockShopDto) {
    const player = req.user as Player;
    const shopInventory = await this.shopService.stockShop(
      player.id,
      id,
      dto.commodityId,
      dto.quantity,
    );

    return {
      shopId: id,
      commodityId: shopInventory.commodityId,
      quantity: shopInventory.quantity,
    };
  }

  @Get(':id/revenue')
  @ApiOperation({ summary: 'Get shop revenue information and projections' })
  @ApiParam({ name: 'id', description: 'Shop UUID' })
  @ApiResponse({ status: 200, description: 'Shop revenue details' })
  @ApiResponse({ status: 404, description: 'Shop not found' })
  async getRevenue(@Req() req: Request, @Param('id') id: string) {
    const player = req.user as Player;
    return this.shopService.getRevenue(player.id, id);
  }
}
