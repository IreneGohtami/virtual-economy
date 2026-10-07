import {
  Controller,
  Get,
  Post,
  Body,
  Req,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { Request } from 'express';
import { Player } from '../entities/player.entity';
import { HappinessService } from './happiness.service';
import { PurchaseBoostDto } from './dto';

@ApiTags('Happiness')
@ApiBearerAuth()
@Controller('happiness')
export class HappinessController {
  constructor(private readonly happinessService: HappinessService) {}

  @Get()
  @ApiOperation({ summary: 'Get current workforce happiness state for the player' })
  @ApiResponse({ status: 200, description: 'Current happiness state' })
  async getHappiness(@Req() req: Request) {
    const player = req.user as Player;
    const state = await this.happinessService.getHappiness(player.id);

    return {
      currentHappiness: state.currentHappiness,
      warningThreshold: state.warningThreshold,
      criticalThreshold: state.criticalThreshold,
      isWarning: state.isWarning,
      isCritical: state.isCritical,
      lastDecayAt: state.lastDecayAt,
    };
  }

  @Post('boost')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Purchase a happiness boost for the workforce' })
  @ApiResponse({ status: 200, description: 'Boost applied successfully' })
  @ApiResponse({ status: 400, description: 'Invalid boost slug or insufficient funds' })
  async purchaseBoost(@Req() req: Request, @Body() dto: PurchaseBoostDto) {
    const player = req.user as Player;
    const result = await this.happinessService.purchaseBoost(player.id, dto.boostSlug);

    return {
      previousHappiness: result.previousHappiness,
      newHappiness: result.newHappiness,
      boostApplied: result.boostApplied,
      boostAmount: result.boostAmount,
      coinsCost: result.coinsCost,
    };
  }

  @Get('boosts')
  @ApiOperation({ summary: 'List all available happiness boosts with per-worker cost and cooldowns' })
  @ApiResponse({ status: 200, description: 'List of available boosts with cooldown status' })
  async getAvailableBoosts(@Req() req: Request) {
    const player = req.user as Player;
    const boosts = await this.happinessService.getAvailableBoostsFromConfig();
    const cooldowns = await this.happinessService.getPlayerBoostCooldowns(player.id);

    return boosts.map((boost) => ({
      slug: boost.slug,
      name: boost.name,
      icon: boost.icon || '🎁',
      costPerWorker: boost.costPerWorker,
      happinessIncrease: boost.happinessIncrease,
      cooldownDays: boost.cooldownDays || 5,
      onCooldown: cooldowns[boost.slug] ? true : false,
      cooldownEndsAt: cooldowns[boost.slug] || null,
    }));
  }
}
