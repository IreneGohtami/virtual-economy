import { IsUUID, IsInt, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ListItemDto {
  @ApiProperty({ description: 'Commodity ID to list for sale' })
  @IsUUID()
  commodityId!: string;

  @ApiProperty({ description: 'Quantity to list', minimum: 1 })
  @IsInt()
  @Min(1)
  quantity!: number;
}
