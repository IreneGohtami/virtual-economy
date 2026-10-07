import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Player } from '../entities/player.entity';
import { PlayerSeason } from '../entities/player-season.entity';
import { Season } from '../entities/season.entity';
import { MapTile } from '../entities/map-tile.entity';
import { Factory } from '../entities/factory.entity';
import { Inventory } from '../entities/inventory.entity';
import { CurrentPrice } from '../entities/current-price.entity';
import { Loan } from '../entities/loan.entity';
import { WalletModule } from '../wallet/wallet.module';
import { PlayerService } from './player.service';
import { PlayerController } from './player.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Player,
      PlayerSeason,
      Season,
      MapTile,
      Factory,
      Inventory,
      CurrentPrice,
      Loan,
    ]),
    WalletModule,
  ],
  controllers: [PlayerController],
  providers: [PlayerService],
  exports: [PlayerService],
})
export class PlayerModule {}
