import { IsArray, IsEnum, IsOptional, IsString, IsInt, IsBoolean, Min, Max, ArrayMinSize } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CommodityCategory } from '@sea-commodity-tycoon/shared-types';

export class ConstructFactoryDto {
  @ApiPropertyOptional({
    description: 'Custom name for the factory',
  })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiProperty({
    description: 'IDs of owned tiles to place the factory on',
    type: [String],
  })
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  tileIds!: string[];

  @ApiProperty({
    description: 'Commodity category for the factory',
    enum: CommodityCategory,
  })
  @IsEnum(CommodityCategory)
  category!: CommodityCategory;

  @ApiPropertyOptional({
    description: 'Optional commodity ID to associate with the factory',
  })
  @IsOptional()
  @IsString()
  commodityId?: string;

  @ApiPropertyOptional({
    description: 'Optional recipe ID to associate with the factory',
  })
  @IsOptional()
  @IsString()
  recipeId?: string;

  @ApiPropertyOptional({
    description: 'Factory level (0 for L0, 1 for L1, 2 for L2). Defaults to 0.',
    default: 0,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(2)
  level?: number;

  @ApiPropertyOptional({
    description: 'Whether this is a shop (skips factory terrain validation, requires 1 CITY tile)',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  isShop?: boolean;
}
