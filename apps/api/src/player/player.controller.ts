import {
  Controller,
  Get,
  Put,
  Post,
  Body,
  Query,
  Req,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { Request } from 'express';
import { Player } from '../entities/player.entity';
import { PlayerService } from './player.service';
import { WalletService } from '../wallet/wallet.service';
import { UpdateProfileDto, SelectSpecialtyDto } from './dto';

@ApiTags('Player')
@ApiBearerAuth()
@Controller('players')
export class PlayerController {
  constructor(
    private readonly playerService: PlayerService,
    private readonly walletService: WalletService,
  ) {}

  @Get('me')
  @ApiOperation({ summary: 'Get current player state including season data' })
  @ApiResponse({ status: 200, description: 'Player state retrieved' })
  async getPlayerState(@Req() req: Request) {
    const player = req.user as Player;
    await this.playerService.updateLastActiveAt(player.id);

    const state = await this.playerService.getPlayerState(player.id);

    return {
      player: {
        id: state.player.id,
        email: state.player.email,
        displayName: state.player.displayName,
        avatarConfig: state.player.avatarConfig,
        role: state.player.role,
        createdAt: state.player.createdAt,
        lastActiveAt: state.player.lastActiveAt,
      },
      season: state.playerSeason
        ? {
            id: state.playerSeason.seasonId,
            specialty: state.playerSeason.specialty,
            coins: Math.round(parseFloat(state.playerSeason.coins)),
            storageCapacity: state.playerSeason.storageCapacity,
            workforceHappiness: Math.round(parseFloat(state.playerSeason.workforceHappiness)),
          }
        : null,
      activeSeason: state.season
        ? {
            id: state.season.id,
            startsAt: state.season.startsAt,
            endsAt: state.season.endsAt,
            status: state.season.status,
          }
        : null,
    };
  }

  @Put('me/profile')
  @ApiOperation({ summary: 'Update player avatar and/or display name' })
  @ApiResponse({ status: 200, description: 'Profile updated' })
  @ApiResponse({ status: 409, description: 'Display name already taken' })
  async updateProfile(@Req() req: Request, @Body() dto: UpdateProfileDto) {
    const player = req.user as Player;
    await this.playerService.updateLastActiveAt(player.id);

    const updated = await this.playerService.updateProfile(player.id, dto);

    return {
      id: updated.id,
      displayName: updated.displayName,
      avatarConfig: updated.avatarConfig,
    };
  }

  @Post('me/specialty')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Select commodity specialty for the current season' })
  @ApiResponse({ status: 200, description: 'Specialty selected' })
  @ApiResponse({ status: 400, description: 'Specialty already selected or invalid category' })
  @ApiResponse({ status: 404, description: 'No active season' })
  async selectSpecialty(@Req() req: Request, @Body() dto: SelectSpecialtyDto) {
    const player = req.user as Player;
    await this.playerService.updateLastActiveAt(player.id);

    const playerSeason = await this.playerService.selectSpecialty(player.id, dto);

    return {
      seasonId: playerSeason.seasonId,
      specialty: playerSeason.specialty,
    };
  }

  @Get('me/net-worth')
  @ApiOperation({ summary: 'Get net worth breakdown for current season' })
  @ApiResponse({ status: 200, description: 'Net worth calculated' })
  @ApiResponse({ status: 404, description: 'No active season or player season record' })
  async getNetWorth(@Req() req: Request) {
    const player = req.user as Player;
    await this.playerService.updateLastActiveAt(player.id);

    return this.playerService.getNetWorth(player.id);
  }

  @Get('me/dashboard')
  @ApiOperation({ summary: 'Get full dashboard stats including net worth' })
  @ApiResponse({ status: 200, description: 'Dashboard data retrieved' })
  async getDashboard(@Req() req: Request) {
    const player = req.user as Player;
    await this.playerService.updateLastActiveAt(player.id);

    return this.playerService.getDashboard(player.id);
  }

  @Get('me/transactions')
  @ApiOperation({ summary: 'Get transaction activity log for current season' })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'offset', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'Transaction history retrieved' })
  async getTransactions(
    @Req() req: Request,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const player = req.user as Player;
    const state = await this.playerService.getPlayerState(player.id);
    if (!state.season) {
      return { transactions: [], total: 0 };
    }

    const transactions = await this.walletService.getTransactionHistory(
      player.id,
      state.season.id,
      {
        limit: limit ? parseInt(limit, 10) : 50,
        offset: offset ? parseInt(offset, 10) : 0,
      },
    );

    return {
      transactions: transactions.map((t) => ({
        id: t.id,
        type: t.transactionType,
        amount: Math.round(parseFloat(t.amount)),
        balanceAfter: Math.round(parseFloat(t.balanceAfter)),
        description: t.description,
        referenceType: t.referenceType,
        createdAt: t.createdAt,
      })),
    };
  }
}
