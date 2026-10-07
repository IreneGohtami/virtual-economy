import { IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RenameFactoryDto {
  @ApiProperty({ description: 'New name for the factory', example: 'My Rice Farm' })
  @IsString()
  @MaxLength(100)
  name!: string;
}
