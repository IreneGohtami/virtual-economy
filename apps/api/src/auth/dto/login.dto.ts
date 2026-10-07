import { IsEmail, IsString, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class LoginDto {
  @ApiProperty({ description: 'Player email address', example: 'player@example.com' })
  @IsEmail()
  email!: string;

  @ApiPropertyOptional({ description: 'Password (required for email login)' })
  @IsOptional()
  @IsString()
  password?: string;

  @ApiPropertyOptional({ description: 'Auth provider', enum: ['email', 'google'], default: 'email' })
  @IsOptional()
  @IsString()
  provider?: 'email' | 'google';

  @ApiPropertyOptional({ description: 'Google OAuth token (required when provider is google)' })
  @IsOptional()
  @IsString()
  googleToken?: string;
}
