import { IsString, IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ReassignWorkerDto {
  @ApiProperty({
    description: 'The new factory ID to reassign the worker to',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @IsString()
  @IsUUID()
  newFactoryId!: string;
}
