import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { ProductionJob } from '../entities/production-job.entity';
import { Factory } from '../entities/factory.entity';
import { Commodity } from '../entities/commodity.entity';
import { Recipe } from '../entities/recipe.entity';
import { RecipeInput } from '../entities/recipe-input.entity';
import { Inventory } from '../entities/inventory.entity';
import { WorkerAssignment } from '../entities/worker-assignment.entity';
import { PlayerSeason } from '../entities/player-season.entity';
import { Season } from '../entities/season.entity';
import { QUEUE_NAMES } from '../queue/queue.module';
import { InventoryModule } from '../inventory/inventory.module';
import { ProductionService } from './production.service';
import { ProductionController } from './production.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ProductionJob,
      Factory,
      Commodity,
      Recipe,
      RecipeInput,
      Inventory,
      WorkerAssignment,
      PlayerSeason,
      Season,
    ]),
    BullModule.registerQueue({ name: QUEUE_NAMES.PRODUCTION }),
    InventoryModule,
  ],
  controllers: [ProductionController],
  providers: [ProductionService],
  exports: [ProductionService],
})
export class ProductionModule {}
