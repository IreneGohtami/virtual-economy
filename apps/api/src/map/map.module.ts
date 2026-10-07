import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MapTile } from '../entities/map-tile.entity';
import { Season } from '../entities/season.entity';
import { WalletModule } from '../wallet/wallet.module';
import { PlayerModule } from '../player/player.module';
import { MapService } from './map.service';
import { LandService } from './land.service';
import { MapController } from './map.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([MapTile, Season]),
    WalletModule,
    PlayerModule,
  ],
  controllers: [MapController],
  providers: [MapService, LandService],
  exports: [MapService, LandService],
})
export class MapModule {}
