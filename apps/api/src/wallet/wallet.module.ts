import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PlayerSeason } from '../entities/player-season.entity';
import { WalletTransaction } from '../entities/wallet-transaction.entity';
import { WalletService } from './wallet.service';

@Module({
  imports: [TypeOrmModule.forFeature([PlayerSeason, WalletTransaction])],
  providers: [WalletService],
  exports: [WalletService],
})
export class WalletModule {}
