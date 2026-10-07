import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { Factory } from '../entities/factory.entity';
import { ProductionJob } from '../entities/production-job.entity';
import { MapTile } from '../entities/map-tile.entity';
import { Season } from '../entities/season.entity';
import { Commodity } from '../entities/commodity.entity';
import { MapModule } from '../map';
import { WalletModule } from '../wallet';
import { InventoryModule } from '../inventory';
import { QUEUE_NAMES } from '../queue/queue.module';
import { FactoryService } from './factory.service';
import { FactoryController } from './factory.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([Factory, ProductionJob, MapTile, Season, Commodity]),
    BullModule.registerQueue({ name: QUEUE_NAMES.FERTILIZER }),
    MapModule,
    WalletModule,
    InventoryModule,
  ],
  controllers: [FactoryController],
  providers: [FactoryService],
  exports: [FactoryService],
})
export class FactoryModule {}
