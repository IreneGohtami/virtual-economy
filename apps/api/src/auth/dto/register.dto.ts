import { IsEmail, IsString, IsOptional, MinLength, MaxLength, Matches } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RegisterDto {
  @ApiProperty({ description: 'Player email address', example: 'player@example.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({ description: 'Password (min 8 chars)', example: 'securePass123' })
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  password!: string;

  @ApiProperty({
    description: 'Unique display name (3-50 chars, alphanumeric + underscores/hyphens)',
    example: 'CommodityKing',
  })
  @IsString()
  @MinLength(3)
  @MaxLength(50)
  @Matches(/^[a-zA-Z0-9_-]+$/, {
    message: 'Display name can only contain letters, numbers, underscores, and hyphens',
  })
  displayName!: string;

  @ApiPropertyOptional({ description: 'Auth provider', enum: ['email', 'google'], default: 'email' })
  @IsOptional()
  @IsString()
  provider?: 'email' | 'google';

  @ApiPropertyOptional({ description: 'Google OAuth token (required when provider is google)' })
  @IsOptional()
  @IsString()
  googleToken?: string;
}
