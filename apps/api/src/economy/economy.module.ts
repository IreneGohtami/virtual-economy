import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Commodity } from '../entities/commodity.entity';
import { CommodityPrice } from '../entities/commodity-price.entity';
import { CurrentPrice } from '../entities/current-price.entity';
import { Season } from '../entities/season.entity';
import { MarketTrade } from '../entities/market-trade.entity';
import { ProductionJob } from '../entities/production-job.entity';
import { Inventory } from '../entities/inventory.entity';
import { MarketListing } from '../entities/market-listing.entity';
import { PlayerSeason } from '../entities/player-season.entity';
import { EconomyService } from './economy.service';
import { EconomyController } from './economy.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Commodity,
      CommodityPrice,
      CurrentPrice,
      Season,
      MarketTrade,
      ProductionJob,
      Inventory,
      MarketListing,
      PlayerSeason,
    ]),
  ],
  controllers: [EconomyController],
  providers: [EconomyService],
  exports: [EconomyService],
})
export class EconomyModule {}
