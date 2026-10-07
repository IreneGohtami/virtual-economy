import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Season } from '../entities/season.entity';
import { Player } from '../entities/player.entity';
import { PlayerSeason } from '../entities/player-season.entity';
import { Factory } from '../entities/factory.entity';
import { MarketListing } from '../entities/market-listing.entity';
import { ProductionJob } from '../entities/production-job.entity';
import { Inventory } from '../entities/inventory.entity';
import { MarketTrade } from '../entities/market-trade.entity';
import { GameEvent } from '../entities/game-event.entity';
import { Commodity } from '../entities/commodity.entity';
import { CurrentPrice } from '../entities/current-price.entity';
import { MapModule } from '../map';
import { EconomyModule } from '../economy';
import { WorkerModule } from '../worker';
import { SeasonService } from './season.service';
import { SummaryService } from './summary.service';
import { SeasonController } from './season.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Season,
      Player,
      PlayerSeason,
      Factory,
      MarketListing,
      ProductionJob,
      Inventory,
      MarketTrade,
      GameEvent,
      Commodity,
      CurrentPrice,
    ]),
    MapModule,
    EconomyModule,
    WorkerModule,
  ],
  controllers: [SeasonController],
  providers: [SeasonService, SummaryService],
  exports: [SeasonService, SummaryService],
})
export class SeasonModule {}
