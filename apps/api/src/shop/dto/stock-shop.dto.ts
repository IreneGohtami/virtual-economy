import { IsUUID, IsInt, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class StockShopDto {
  @ApiProperty({ description: 'UUID of the commodity to stock' })
  @IsUUID()
  commodityId!: string;

  @ApiProperty({ description: 'Quantity to transfer from player inventory to shop', minimum: 1 })
  @IsInt()
  @Min(1)
  quantity!: number;
}
