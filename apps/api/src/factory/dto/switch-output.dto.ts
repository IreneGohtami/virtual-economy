import { IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SwitchOutputDto {
  @ApiProperty({
    description: 'The recipe output slug to switch to (e.g., "chicken-meat", "eggs", "beef", "milk", "fish", "frozen-fish")',
    example: 'chicken-meat',
  })
  @IsString()
  @IsNotEmpty()
  outputSlug!: string;
}
