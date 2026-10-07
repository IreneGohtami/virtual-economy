import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GameEvent } from '../entities/game-event.entity';
import { Season } from '../entities/season.entity';
import { EventService } from './event.service';
import { EventController } from './event.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([GameEvent, Season]),
  ],
  controllers: [EventController],
  providers: [EventService],
  exports: [EventService],
})
export class EventModule {}
