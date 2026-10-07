import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MarketListing } from '../entities/market-listing.entity';
import { MarketTrade } from '../entities/market-trade.entity';
import { CurrentPrice } from '../entities/current-price.entity';
import { Season } from '../entities/season.entity';
import { WalletModule } from '../wallet';
import { InventoryModule } from '../inventory';
import { ProductionModule } from '../production';
import { MarketplaceService } from './marketplace.service';
import { MarketplaceController } from './marketplace.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([MarketListing, MarketTrade, CurrentPrice, Season]),
    WalletModule,
    InventoryModule,
    ProductionModule,
  ],
  controllers: [MarketplaceController],
  providers: [MarketplaceService],
  exports: [MarketplaceService],
})
export class MarketplaceModule {}
