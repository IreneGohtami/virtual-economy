import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiBody,
} from '@nestjs/swagger';
import { SeasonService, StartSeasonConfig } from './season.service';
import { SummaryService } from './summary.service';

@ApiTags('Season')
@ApiBearerAuth()
@Controller()
export class SeasonController {
  constructor(
    private readonly seasonService: SeasonService,
    private readonly summaryService: SummaryService,
  ) {}

  @Get('season/current')
  @ApiOperation({ summary: 'Get the current active season' })
  @ApiResponse({ status: 200, description: 'The currently active season' })
  @ApiResponse({ status: 404, description: 'No active season found' })
  async getCurrentSeason() {
    const season = await this.seasonService.getCurrentSeason();
    return {
      id: season.id,
      startsAt: season.startsAt,
      endsAt: season.endsAt,
      status: season.status,
      configuration: season.configuration,
      createdAt: season.createdAt,
    };
  }

  @Get('season/summary/:id')
  @ApiOperation({ summary: 'Get season summary data' })
  @ApiParam({ name: 'id', description: 'Season UUID' })
  @ApiResponse({ status: 200, description: 'Season summary including leaderboard, highlights, and tagline' })
  @ApiResponse({ status: 404, description: 'Season not found' })
  async getSeasonSummary(@Param('id') id: string) {
    return this.seasonService.getSeasonSummary(id);
  }

  @Get('season/history')
  @ApiOperation({ summary: 'List past and current seasons' })
  @ApiResponse({ status: 200, description: 'List of all seasons ordered by start date descending' })
  async getSeasonHistory() {
    const history = await this.seasonService.getSeasonHistory();
    return { seasons: history };
  }

  @Post('admin/season/start')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Start a new season (admin only)' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        durationDays: { type: 'number', description: 'Season duration in days (default: 30)' },
        mapWidth: { type: 'number', description: 'Map width in tiles (default: 100)' },
        mapHeight: { type: 'number', description: 'Map height in tiles (default: 100)' },
        configuration: { type: 'object', description: 'Optional season configuration overrides' },
      },
    },
  })
  @ApiResponse({ status: 201, description: 'Season started successfully' })
  @ApiResponse({ status: 409, description: 'A season is already active' })
  async startSeason(@Body() config?: StartSeasonConfig) {
    const season = await this.seasonService.startSeason(config);
    return {
      id: season.id,
      startsAt: season.startsAt,
      endsAt: season.endsAt,
      status: season.status,
      configuration: season.configuration,
    };
  }

  @Post('admin/season/end')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'End the current active season (admin only)' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        seasonId: { type: 'string', description: 'Season UUID to end' },
      },
      required: ['seasonId'],
    },
  })
  @ApiResponse({ status: 200, description: 'Season ended successfully with final standings' })
  @ApiResponse({ status: 400, description: 'Season is not active' })
  @ApiResponse({ status: 404, description: 'Season not found' })
  async endSeason(@Body() body: { seasonId: string }) {
    const season = await this.seasonService.endSeason(body.seasonId);
    return {
      id: season.id,
      status: season.status,
      summary: season.summary,
    };
  }

  @Post('admin/season/:id/generate-summary')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Generate full season summary with tagline and highlights (admin only)' })
  @ApiParam({ name: 'id', description: 'Season UUID' })
  @ApiResponse({ status: 200, description: 'Full season summary generated and persisted' })
  @ApiResponse({ status: 404, description: 'Season not found' })
  async generateSummary(@Param('id') id: string) {
    return this.summaryService.generateFullSummary(id);
  }

  @Post('admin/season/:id/update-end-date')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update the end date of an active season (admin only)' })
  @ApiParam({ name: 'id', description: 'Season UUID' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        endsAt: { type: 'string', description: 'New end date (ISO string)', example: '2026-09-30T00:00:00.000Z' },
      },
      required: ['endsAt'],
    },
  })
  @ApiResponse({ status: 200, description: 'Season end date updated' })
  @ApiResponse({ status: 404, description: 'Season not found' })
  async updateEndDate(@Param('id') id: string, @Body() body: { endsAt: string }) {
    const season = await this.seasonService.updateEndDate(id, new Date(body.endsAt));
    return {
      id: season.id,
      startsAt: season.startsAt,
      endsAt: season.endsAt,
      status: season.status,
    };
  }

}
