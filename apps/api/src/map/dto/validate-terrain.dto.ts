import { IsArray, IsUUID, IsEnum, ArrayMinSize } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { CommodityCategory } from '@sea-commodity-tycoon/shared-types';

export class ValidateTerrainDto {
  @ApiProperty({
    description: 'Array of tile UUIDs to validate',
    example: ['uuid-1', 'uuid-2'],
    type: [String],
  })
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  tileIds!: string[];

  @ApiProperty({
    description: 'Commodity category to validate terrain for',
    enum: CommodityCategory,
    example: CommodityCategory.AGRICULTURE,
  })
  @IsEnum(CommodityCategory)
  category!: CommodityCategory;
}
