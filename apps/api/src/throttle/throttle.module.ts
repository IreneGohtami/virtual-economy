import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { PlayerThrottlerGuard } from '../common';

/**
 * Rate limiting module using @nestjs/throttler.
 *
 * Global configuration: 60 requests per 60 seconds (1 minute) per player.
 * Marketplace endpoints apply a tighter 30 req/min via @Throttle() decorator.
 * Admin endpoints skip throttling via @SkipThrottle() decorator.
 *
 * The custom PlayerThrottlerGuard keys on JWT player ID rather than IP,
 * ensuring fair per-player limiting regardless of network topology.
 */
@Module({
  imports: [
    ThrottlerModule.forRoot([
      {
        name: 'default',
        ttl: 60_000, // 60 seconds
        limit: 60, // 60 requests per minute
      },
    ]),
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: PlayerThrottlerGuard,
    },
  ],
})
export class ThrottleModule {}
