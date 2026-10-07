import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
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
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { Player } from '../entities/player.entity';
import { MarketplaceService } from './marketplace.service';
import { ListItemDto } from './dto/list-item.dto';
import { PurchaseDto } from './dto/purchase.dto';
import { InstantSellDto } from './dto/instant-sell.dto';

@ApiTags('Marketplace')
@ApiBearerAuth()
@Throttle({ default: { ttl: 60_000, limit: 30 } }) // 30 req/min for marketplace (stricter)
@Controller('marketplace')
export class MarketplaceController {
  constructor(private readonly marketplaceService: MarketplaceService) {}

  @Get('prices')
  @ApiOperation({ summary: 'Get all current commodity prices' })
  @ApiResponse({ status: 200, description: 'All current prices for the active season' })
  @ApiResponse({ status: 404, description: 'No active season found' })
  async getAllPrices() {
    const seasonId = await this.marketplaceService.getActiveSeasonId();
    const prices = await this.marketplaceService.getAllPrices(seasonId);
    return { prices };
  }

  @Get('my-listings')
  @ApiOperation({ summary: "Get player's active marketplace listings" })
  @ApiResponse({ status: 200, description: 'Player active listings with queue position' })
  async getMyListings(@Req() req: Request) {
    const player = req.user as Player;
    const seasonId = await this.marketplaceService.getActiveSeasonId();
    const listings = await this.marketplaceService.getPlayerListings(player.id, seasonId);
    return { listings };
  }

  @Get('all-listings')
  @ApiOperation({ summary: 'Get all active marketplace listings grouped by commodity' })
  @ApiResponse({ status: 200, description: 'All active listings grouped by commodity' })
  async getAllListings(@Req() req: Request) {
    const seasonId = await this.marketplaceService.getActiveSeasonId();
    const listings = await this.marketplaceService.getAllActiveListings(seasonId);
    return { listings };
  }

  @Get(':commodityId')
  @ApiOperation({ summary: 'Get marketplace queue info for a commodity' })
  @ApiParam({ name: 'commodityId', description: 'Commodity UUID' })
  @ApiResponse({ status: 200, description: 'Queue depth, total quantity, and current price' })
  @ApiResponse({ status: 404, description: 'No active season found' })
  async getQueueInfo(@Param('commodityId') commodityId: string) {
    const seasonId = await this.marketplaceService.getActiveSeasonId();
    return this.marketplaceService.getQueueInfo(commodityId, seasonId);
  }

  @Post('list')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'List inventory for sale on the marketplace' })
  @ApiResponse({ status: 201, description: 'Listing created successfully' })
  @ApiResponse({ status: 400, description: 'Insufficient inventory or invalid quantity' })
  @ApiResponse({ status: 404, description: 'No active season found' })
  async listForSale(@Req() req: Request, @Body() dto: ListItemDto) {
    const player = req.user as Player;
    const seasonId = await this.marketplaceService.getActiveSeasonId();
    const listing = await this.marketplaceService.listForSale(
      player.id,
      seasonId,
      dto.commodityId,
      dto.quantity,
    );
    return { message: 'Item listed successfully', listing };
  }

  @Post('buy')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Purchase a commodity from the marketplace (FIFO)' })
  @ApiResponse({ status: 200, description: 'Purchase completed successfully' })
  @ApiResponse({ status: 400, description: 'Insufficient funds, supply, or storage' })
  @ApiResponse({ status: 404, description: 'No active season or price found' })
  async purchase(@Req() req: Request, @Body() dto: PurchaseDto) {
    const player = req.user as Player;
    const seasonId = await this.marketplaceService.getActiveSeasonId();
    const result = await this.marketplaceService.purchase(
      player.id,
      seasonId,
      dto.commodityId,
      dto.quantity,
    );
    return { message: 'Purchase completed', ...result };
  }

  @Delete('listings/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancel an active marketplace listing' })
  @ApiParam({ name: 'id', description: 'Listing UUID' })
  @ApiResponse({ status: 200, description: 'Listing cancelled, quantity returned to inventory' })
  @ApiResponse({ status: 400, description: 'Listing is not active' })
  @ApiResponse({ status: 403, description: 'Not the owner of this listing' })
  @ApiResponse({ status: 404, description: 'Listing not found or no active season' })
  async cancelListing(@Req() req: Request, @Param('id') listingId: string) {
    const player = req.user as Player;
    const seasonId = await this.marketplaceService.getActiveSeasonId();
    const result = await this.marketplaceService.cancelListing(
      player.id,
      seasonId,
      listingId,
    );
    return { message: 'Listing cancelled', ...result };
  }

  @Post('instant-sell')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Instantly sell commodities at 90% of market price' })
  @ApiResponse({ status: 200, description: 'Instant sell completed successfully' })
  @ApiResponse({ status: 400, description: 'Insufficient inventory or invalid quantity' })
  @ApiResponse({ status: 404, description: 'No active season or market price found' })
  async instantSell(@Req() req: Request, @Body() dto: InstantSellDto) {
    const player = req.user as Player;
    const seasonId = await this.marketplaceService.getActiveSeasonId();
    const result = await this.marketplaceService.instantSell(
      player.id,
      seasonId,
      dto.commodityId,
      dto.quantity,
    );
    return { message: 'Instant sell completed', ...result };
  }

}
