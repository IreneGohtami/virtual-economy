import { IsUUID, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class StartProductionDto {
  @ApiProperty({ description: 'Factory ID to start production at' })
  @IsUUID()
  factoryId!: string;

  @ApiPropertyOptional({ description: 'Recipe ID for L1/L2 processing (optional for L0)' })
  @IsOptional()
  @IsUUID()
  recipeId?: string;
}
