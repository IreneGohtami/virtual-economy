import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { InitialSchema1700000000000 } from '../migrations/1700000000000-InitialSchema';
import { SeedCommoditiesAndRecipes1700000000001 } from '../migrations/1700000000001-SeedCommoditiesAndRecipes';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        type: 'postgres',
        host: configService.get<string>('database.host'),
        port: configService.get<number>('database.port'),
        username: configService.get<string>('database.username'),
        password: configService.get<string>('database.password'),
        database: configService.get<string>('database.database'),
        synchronize: configService.get<boolean>('database.synchronize'),
        logging: configService.get<boolean>('database.logging'),
        autoLoadEntities: true,
        migrations: [
          InitialSchema1700000000000,
          SeedCommoditiesAndRecipes1700000000001,
        ],
        migrationsRun: configService.get<boolean>('database.migrationsRun') ?? false,
        // Connection pool settings
        extra: {
          max: 20,
          idleTimeoutMillis: 30000,
          connectionTimeoutMillis: 5000,
        },
      }),
    }),
  ],
})
export class DatabaseModule {}
