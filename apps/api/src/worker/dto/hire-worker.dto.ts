import { IsString, IsUUID, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class HireWorkerDto {
  @ApiPropertyOptional({
    description: 'The factory ID to assign the worker to (optional — leave empty to hire unassigned)',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @IsOptional()
  @IsString()
  @IsUUID()
  factoryId?: string;
}
