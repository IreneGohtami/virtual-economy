import { IsEnum, IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { ShopType } from '@sea-commodity-tycoon/shared-types';

export class ConstructShopDto {
  @ApiProperty({ description: 'UUID of the CITY tile to place the shop on' })
  @IsUUID()
  tileId!: string;

  @ApiProperty({ enum: ShopType, description: 'Type of shop to construct' })
  @IsEnum(ShopType)
  shopType!: ShopType;
}
