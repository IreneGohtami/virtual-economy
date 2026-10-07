import {
  Controller,
  Get,
  Param,
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
import { EconomyService } from './economy.service';

@ApiTags('Economy')
@ApiBearerAuth()
@Controller('economy')
export class EconomyController {
  constructor(private readonly economyService: EconomyService) {}

  @Get('prices/:commodityId/history')
  @ApiOperation({ summary: 'Get price history for a commodity in the current season' })
  @ApiParam({ name: 'commodityId', description: 'Commodity UUID' })
  @ApiResponse({ status: 200, description: 'Price history records ordered chronologically' })
  @ApiResponse({ status: 404, description: 'No active season found' })
  async getPriceHistory(@Param('commodityId') commodityId: string) {
    const seasonId = await this.economyService.getActiveSeasonId();
    const history = await this.economyService.getPriceHistory(commodityId, seasonId);
    return { commodityId, seasonId, history };
  }

  @Get('leaderboard')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get player leaderboard ranked by net worth' })
  @ApiResponse({ status: 200, description: 'Leaderboard entries sorted by net worth descending' })
  @ApiResponse({ status: 404, description: 'No active season found' })
  async getLeaderboard() {
    const seasonId = await this.economyService.getActiveSeasonId();
    const leaderboard = await this.economyService.getLeaderboard(seasonId);
    return { seasonId, leaderboard };
  }
}
