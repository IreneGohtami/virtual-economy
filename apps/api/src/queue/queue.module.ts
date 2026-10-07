import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';

// Queue names used across the application
export const QUEUE_NAMES = {
  PRODUCTION: 'production',
  ECONOMY: 'economy',
  DEPRECIATION: 'depreciation',
  HAPPINESS: 'happiness',
  WORKER: 'worker',
  BANK: 'bank',
  SHOP: 'shop',
  SEASON: 'season',
  EVENTS: 'events',
  FERTILIZER: 'fertilizer',
  INACTIVITY: 'inactivity',
} as const;

@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        connection: {
          host: configService.get<string>('redis.host'),
          port: configService.get<number>('redis.port'),
          password: configService.get<string>('redis.password'),
          db: configService.get<number>('redis.db'),
          maxRetriesPerRequest: null,
        },
        defaultJobOptions: {
          removeOnComplete: 1000,
          removeOnFail: 5000,
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 1000,
          },
        },
      }),
    }),
    // Register individual queues
    BullModule.registerQueue(
      { name: QUEUE_NAMES.PRODUCTION },
      { name: QUEUE_NAMES.ECONOMY },
      { name: QUEUE_NAMES.DEPRECIATION },
      { name: QUEUE_NAMES.HAPPINESS },
      { name: QUEUE_NAMES.WORKER },
      { name: QUEUE_NAMES.BANK },
      { name: QUEUE_NAMES.SHOP },
      { name: QUEUE_NAMES.SEASON },
      { name: QUEUE_NAMES.EVENTS },
      { name: QUEUE_NAMES.FERTILIZER },
      { name: QUEUE_NAMES.INACTIVITY },
    ),
  ],
  exports: [BullModule],
})
export class QueueModule {}
