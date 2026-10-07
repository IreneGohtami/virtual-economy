import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Shop } from '../entities/shop.entity';
import { ShopInventory } from '../entities/shop-inventory.entity';
import { ShopAcceptedCommodity } from '../entities/shop-accepted-commodity.entity';
import { MapTile } from '../entities/map-tile.entity';
import { CurrentPrice } from '../entities/current-price.entity';
import { Season } from '../entities/season.entity';
import { Commodity } from '../entities/commodity.entity';
import { WalletModule } from '../wallet';
import { InventoryModule } from '../inventory';
import { ShopService } from './shop.service';
import { ShopController } from './shop.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Shop,
      ShopInventory,
      ShopAcceptedCommodity,
      MapTile,
      CurrentPrice,
      Season,
      Commodity,
    ]),
    WalletModule,
    InventoryModule,
  ],
  controllers: [ShopController],
  providers: [ShopService],
  exports: [ShopService],
})
export class ShopModule {}
