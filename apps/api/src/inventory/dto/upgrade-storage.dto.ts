import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsInt, Min } from 'class-validator';

export class UpgradeStorageDto {
  @ApiPropertyOptional({
    description: 'Target storage capacity tier. If omitted, upgrades to the next available tier.',
    example: 750,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  targetCapacity?: number;
}
