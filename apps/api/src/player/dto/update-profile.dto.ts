import { IsString, IsOptional, MinLength, MaxLength, Matches, IsObject } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateProfileDto {
  @ApiPropertyOptional({
    description: 'Unique display name (3-50 chars, alphanumeric + underscores/hyphens)',
    example: 'CommodityKing',
  })
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(50)
  @Matches(/^[a-zA-Z0-9_-]+$/, {
    message: 'Display name can only contain letters, numbers, underscores, and hyphens',
  })
  displayName?: string;

  @ApiPropertyOptional({
    description: 'Avatar configuration object (skin, hair, accessories, etc.)',
    example: { skin: 'light', hair: 'brown', accessory: 'glasses' },
  })
  @IsOptional()
  @IsObject()
  avatarConfig?: Record<string, unknown>;
}
