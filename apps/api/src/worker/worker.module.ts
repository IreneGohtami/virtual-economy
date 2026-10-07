import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WorkerProfile } from '../entities/worker-profile.entity';
import { WorkerAssignment } from '../entities/worker-assignment.entity';
import { Factory } from '../entities/factory.entity';
import { Season } from '../entities/season.entity';
import { PlayerSeason } from '../entities/player-season.entity';
import { WalletModule } from '../wallet';
import { ProductionModule } from '../production/production.module';
import { WorkerService } from './worker.service';
import { WorkerController } from './worker.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      WorkerProfile,
      WorkerAssignment,
      Factory,
      Season,
      PlayerSeason,
    ]),
    WalletModule,
    forwardRef(() => ProductionModule),
  ],
  controllers: [WorkerController],
  providers: [WorkerService],
  exports: [WorkerService],
})
export class WorkerModule {}
