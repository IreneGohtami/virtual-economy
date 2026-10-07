import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { AdminController } from './admin.controller';
import { SimulationService } from './simulation.service';
import { AdvancedSimulationService } from './advanced-simulation.service';
import { AdminConfigService } from './config.service';
import { AdminGuard } from './admin.guard';
import { SimulationRun } from '../entities/simulation-run.entity';
import { GameConfig } from '../entities/game-config.entity';
import { Commodity } from '../entities/commodity.entity';
import { Recipe } from '../entities/recipe.entity';
import { RecipeInput } from '../entities/recipe-input.entity';

@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forFeature([
      SimulationRun,
      GameConfig,
      Commodity,
      Recipe,
      RecipeInput,
    ]),
  ],
  controllers: [AdminController],
  providers: [SimulationService, AdvancedSimulationService, AdminConfigService, AdminGuard],
  exports: [SimulationService, AdvancedSimulationService, AdminConfigService],
})
export class AdminModule {}
