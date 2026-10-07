import { Module, Global, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

export const REDIS_CLIENT = 'REDIS_CLIENT';

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      useFactory: (configService: ConfigService): Redis => {
        const redis = new Redis({
          host: configService.get<string>('redis.host'),
          port: configService.get<number>('redis.port'),
          password: configService.get<string>('redis.password'),
          db: configService.get<number>('redis.db'),
          maxRetriesPerRequest: null, // Required for BullMQ compatibility
          enableReadyCheck: true,
          retryStrategy: (times: number) => {
            if (times > 10) {
              return null; // Stop retrying after 10 attempts
            }
            return Math.min(times * 200, 5000);
          },
        });

        redis.on('error', (err) => {
          console.error('Redis connection error:', err.message);
        });

        redis.on('connect', () => {
          console.log('Redis connected successfully');
        });

        return redis;
      },
      inject: [ConfigService],
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule implements OnModuleDestroy {
  constructor(private readonly configService: ConfigService) {}

  async onModuleDestroy(): Promise<void> {
    // Redis client cleanup is handled by NestJS DI container
  }
}
