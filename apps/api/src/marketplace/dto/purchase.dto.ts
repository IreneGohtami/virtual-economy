import { IsUUID, IsInt, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class PurchaseDto {
  @ApiProperty({ description: 'Commodity ID to purchase' })
  @IsUUID()
  commodityId!: string;

  @ApiProperty({ description: 'Quantity to purchase', minimum: 1 })
  @IsInt()
  @Min(1)
  quantity!: number;
}
