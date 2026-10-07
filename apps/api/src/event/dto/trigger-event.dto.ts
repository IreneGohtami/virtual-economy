import { IsEnum, IsString, IsOptional, IsNumber, IsArray, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { EventType, CommodityCategory } from '@sea-commodity-tycoon/shared-types';

export class TriggerEventDto {
  @ApiProperty({
    description: 'Type of the event',
    enum: EventType,
    example: EventType.FLOOD,
  })
  @IsEnum(EventType)
  eventType!: EventType;

  @ApiProperty({
    description: 'Display name of the event',
    example: 'Monsoon Flooding',
  })
  @IsString()
  name!: string;

  @ApiPropertyOptional({
    description: 'Optional event description',
    example: 'Heavy monsoon rains have caused flooding across agricultural regions',
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({
    description: 'Duration of the event in minutes',
    example: 1440,
    minimum: 1,
  })
  @IsNumber()
  @Min(1, { message: 'Duration must be at least 1 minute' })
  durationMinutes!: number;

  @ApiProperty({
    description: 'Commodity categories affected by this event',
    enum: CommodityCategory,
    isArray: true,
    example: [CommodityCategory.AGRICULTURE],
  })
  @IsArray()
  @IsEnum(CommodityCategory, { each: true })
  affectedCategories!: CommodityCategory[];

  @ApiPropertyOptional({
    description: 'Production modifier (e.g. -0.30 for -30% production)',
    example: -0.30,
  })
  @IsOptional()
  @IsNumber()
  productionModifier?: number;

  @ApiPropertyOptional({
    description: 'Demand modifier (e.g. 0.30 for +30% demand)',
    example: 0,
  })
  @IsOptional()
  @IsNumber()
  demandModifier?: number;

  @ApiPropertyOptional({
    description: 'Price modifier (e.g. 0.20 for +20% price impact)',
    example: 0,
  })
  @IsOptional()
  @IsNumber()
  priceModifier?: number;
}
