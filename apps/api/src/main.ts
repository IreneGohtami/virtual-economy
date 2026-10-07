import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './common';

async function bootstrap(): Promise<void> {
  const logger = new Logger('Bootstrap');

  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'log', 'debug', 'verbose'],
  });

  const configService = app.get(ConfigService);
  const port = configService.get<number>('port') || 3000;
  const environment = configService.get<string>('environment');

  // Global prefix for all routes
  app.setGlobalPrefix('api');

  // CORS configuration
  const webOrigin = configService.get<string>('cors.webOrigin');
  const adminOrigin = configService.get<string>('cors.adminOrigin');

  app.enableCors({
    origin: [webOrigin!, adminOrigin!],
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    maxAge: 3600,
  });

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
      validateCustomDecorators: true,
    }),
  );

  // Global exception filter
  app.useGlobalFilters(new GlobalExceptionFilter());

  // Swagger/OpenAPI documentation
  const swaggerEnabled = configService.get<boolean>('swagger.enabled');
  const swaggerPath = configService.get<string>('swagger.path') || 'api/docs';

  if (swaggerEnabled) {
    const config = new DocumentBuilder()
      .setTitle('SEA Commodity Tycoon API')
      .setDescription(
        'Backend API for the SEA Commodity Tycoon multiplayer economic game. ' +
          'Manages production, marketplace, economy, and all game systems.',
      )
      .setVersion('0.1.0')
      .addBearerAuth(
        {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'Enter JWT access token',
        },
        'access-token',
      )
      .addTag('Health', 'Service health endpoints')
      .addTag('Auth', 'Authentication and authorization')
      .addTag('Player', 'Player profile and state management')
      .addTag('Map', 'Map and land management')
      .addTag('Factory', 'Factory construction and management')
      .addTag('Worker', 'Worker hiring and assignment')
      .addTag('Production', 'Production job management')
      .addTag('Inventory', 'Inventory and storage management')
      .addTag('Marketplace', 'Commodity trading marketplace')
      .addTag('Economy', 'Dynamic pricing and economy')
      .addTag('Bank', 'Loan management')
      .addTag('Shop', 'Shop construction and revenue')
      .addTag('Season', 'Season lifecycle management')
      .addTag('Event', 'Game events and modifiers')
      .addTag('Notification', 'Real-time notifications')
      .addTag('Admin', 'Administration and simulation')
      .build();

    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup(swaggerPath, app, document);

    logger.log(`Swagger documentation available at /${swaggerPath}`);
  }

  await app.listen(port);
  logger.log(
    `SEA Commodity Tycoon API running on port ${port} [${environment}]`,
  );
}

bootstrap();
