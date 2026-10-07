import { IsUUID, IsInt, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class InstantSellDto {
  @ApiProperty({ description: 'Commodity ID to instant sell' })
  @IsUUID()
  commodityId!: string;

  @ApiProperty({ description: 'Quantity to sell', minimum: 1 })
  @IsInt()
  @Min(1)
  quantity!: number;
}
