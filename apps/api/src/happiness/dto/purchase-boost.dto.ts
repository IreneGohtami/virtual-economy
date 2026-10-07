import { IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class PurchaseBoostDto {
  @ApiProperty({
    description: 'Slug of the happiness boost to purchase (e.g. "bonus", "company-trip", "salary-raise")',
    example: 'bonus',
  })
  @IsString()
  @IsNotEmpty()
  boostSlug!: string;
}
