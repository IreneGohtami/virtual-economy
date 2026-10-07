import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { Inventory } from '../entities/inventory.entity';
import { Commodity } from '../entities/commodity.entity';
import { PlayerSeason } from '../entities/player-season.entity';
import { Season } from '../entities/season.entity';
import { QUEUE_NAMES } from '../queue/queue.module';
import { WalletModule } from '../wallet';
import { InventoryService } from './inventory.service';
import { InventoryController } from './inventory.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([Inventory, Commodity, PlayerSeason, Season]),
    BullModule.registerQueue({ name: QUEUE_NAMES.PRODUCTION }),
    WalletModule,
  ],
  controllers: [InventoryController],
  providers: [InventoryService],
  exports: [InventoryService],
})
export class InventoryModule {}
