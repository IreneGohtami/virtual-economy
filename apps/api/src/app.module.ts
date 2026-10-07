import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AppConfigModule } from './config';
import { DatabaseModule } from './database';
import { RedisModule } from './redis';
import { QueueModule } from './queue';
import { ThrottleModule } from './throttle';
import { HealthModule } from './health/health.module';
import { WalletModule } from './wallet';
import { AuthModule } from './auth';
import { PlayerModule } from './player';
import { MapModule } from './map';
import { FactoryModule } from './factory';
import { WorkerModule } from './worker';
import { InventoryModule } from './inventory';
import { ProductionModule } from './production';
import { MarketplaceModule } from './marketplace';
import { EconomyModule } from './economy';
import { BankModule } from './bank';
import { ShopModule } from './shop';
import { SeasonModule } from './season';
import { EventModule } from './event';
import { HappinessModule } from './happiness';
import { NotificationModule } from './notification';
import { AdminModule } from './admin';
import { AntiCheatInterceptor } from './common';

@Module({
  imports: [
    // Configuration (must be first - provides env vars to other modules)
    AppConfigModule,

    // Infrastructure
    DatabaseModule,
    RedisModule,
    QueueModule,

    // Rate limiting
    ThrottleModule,

    // Health check endpoint
    HealthModule,

    // Authentication
    AuthModule,

    // Game modules
    WalletModule,
    PlayerModule,
    MapModule,
    FactoryModule,
    WorkerModule,
    InventoryModule,
    ProductionModule,
    MarketplaceModule,
    EconomyModule,
    BankModule,
    ShopModule,
    SeasonModule,
    EventModule,
    HappinessModule,
    NotificationModule,

    // Admin & Simulation
    AdminModule,
  ],
  providers: [
    // Global anti-cheat logging interceptor
    {
      provide: APP_INTERCEPTOR,
      useClass: AntiCheatInterceptor,
    },
  ],
})
export class AppModule {}
