import { IsString, IsNotEmpty, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * Valid L0 commodity slugs that can be selected as a specialty.
 * Each gives a 10% production bonus to factories of that commodity type.
 */
export const L0_COMMODITY_SLUGS = [
  'rice',
  'palm-fruit',
  'cocoa',
  'coffee',
  'crude-oil',
  'natural-gas',
  'iron-ore',
  'nickel-ore',
  'poultry',
  'cattle',
  'fish',
  'timber',
  'rubber',
] as const;

export type L0CommoditySlug = (typeof L0_COMMODITY_SLUGS)[number];

export class SelectSpecialtyDto {
  @ApiProperty({
    description: 'L0 commodity slug to specialize in for the current season',
    example: 'rice',
    type: String,
  })
  @IsString()
  @IsNotEmpty({ message: 'Commodity must not be empty' })
  @MaxLength(50)
  commodity!: string;
}
