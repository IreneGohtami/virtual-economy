import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PlayerSeason } from '../entities/player-season.entity';
import { WorkerAssignment } from '../entities/worker-assignment.entity';
import { WorkerProfile } from '../entities/worker-profile.entity';
import { Season } from '../entities/season.entity';
import { Factory } from '../entities/factory.entity';
import { ProductionJob } from '../entities/production-job.entity';
import { Notification } from '../entities/notification.entity';
import { GameConfig } from '../entities/game-config.entity';
import { WalletModule } from '../wallet';
import { HappinessService } from './happiness.service';
import { HappinessController } from './happiness.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      PlayerSeason,
      WorkerAssignment,
      WorkerProfile,
      Season,
      Factory,
      ProductionJob,
      Notification,
      GameConfig,
    ]),
    WalletModule,
  ],
  controllers: [HappinessController],
  providers: [HappinessService],
  exports: [HappinessService],
})
export class HappinessModule {}
