import {
  Injectable,
  ConflictException,
  UnauthorizedException,
  Inject,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import Redis from 'ioredis';
import { Player } from '../entities/player.entity';
import { REDIS_CLIENT } from '../redis/redis.module';
import { RegisterDto, LoginDto } from './dto';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export interface JwtPayload {
  sub: string;
  email: string;
  displayName: string;
  role: string;
}

const SALT_ROUNDS = 12;
const REFRESH_TOKEN_PREFIX = 'refresh_token:';

@Injectable()
export class AuthService {
  private readonly refreshExpiresInSeconds: number;

  constructor(
    @InjectRepository(Player)
    private readonly playerRepository: Repository<Player>,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    @Inject(REDIS_CLIENT)
    private readonly redis: Redis,
  ) {
    // Parse refreshExpiresIn (e.g. "7d") to seconds for Redis TTL
    const refreshExpiry = this.configService.get<string>('jwt.refreshExpiresIn') || '7d';
    this.refreshExpiresInSeconds = this.parseDurationToSeconds(refreshExpiry);
  }

  /**
   * Register a new player with email/password or Google OAuth.
   */
  async register(dto: RegisterDto): Promise<{ player: Player; tokens: TokenPair }> {
    const provider = dto.provider || 'email';

    // Check email uniqueness
    const existingByEmail = await this.playerRepository.findOne({
      where: { email: dto.email },
    });
    if (existingByEmail) {
      throw new ConflictException('Email is already registered');
    }

    // Check display name uniqueness
    const existingByName = await this.playerRepository.findOne({
      where: { displayName: dto.displayName },
    });
    if (existingByName) {
      throw new ConflictException('Display name is already taken');
    }

    let authProviderId: string | null = null;

    if (provider === 'email') {
      // Hash password and store as auth_provider_id
      const hashedPassword = await bcrypt.hash(dto.password, SALT_ROUNDS);
      authProviderId = hashedPassword;
    } else if (provider === 'google') {
      // In production, validate the Google token and extract the sub claim
      // For now, store the token reference as provider ID
      authProviderId = dto.googleToken || null;
    }

    const player = this.playerRepository.create({
      email: dto.email,
      authProvider: provider,
      authProviderId,
      displayName: dto.displayName,
      avatarConfig: {},
    });

    const savedPlayer = await this.playerRepository.save(player);

    const tokens = await this.generateTokenPair(savedPlayer);

    return { player: savedPlayer, tokens };
  }

  /**
   * Login with email/password or Google OAuth.
   */
  async login(dto: LoginDto): Promise<{ player: Player; tokens: TokenPair }> {
    const provider = dto.provider || 'email';

    const player = await this.playerRepository.findOne({
      where: { email: dto.email },
    });

    if (!player) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (provider === 'email') {
      if (!dto.password) {
        throw new UnauthorizedException('Password is required for email login');
      }

      if (player.authProvider !== 'email') {
        throw new UnauthorizedException(
          'This account uses a different login method',
        );
      }

      const isPasswordValid = await bcrypt.compare(
        dto.password,
        player.authProviderId || '',
      );

      if (!isPasswordValid) {
        throw new UnauthorizedException('Invalid credentials');
      }
    } else if (provider === 'google') {
      if (player.authProvider !== 'google') {
        throw new UnauthorizedException(
          'This account uses a different login method',
        );
      }
      // In production, verify the Google token matches
      // For now, accept if provider matches
    }

    // Update last active timestamp
    player.lastActiveAt = new Date();
    await this.playerRepository.save(player);

    const tokens = await this.generateTokenPair(player);

    return { player, tokens };
  }

  /**
   * Refresh the access token using a valid refresh token.
   * Implements refresh token rotation: old token is invalidated, new pair is issued.
   */
  async refresh(refreshToken: string): Promise<TokenPair> {
    // Verify the refresh token signature
    let payload: JwtPayload;
    try {
      payload = this.jwtService.verify<JwtPayload>(refreshToken, {
        secret: this.configService.get<string>('jwt.secret'),
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    // Check if the refresh token exists in Redis (not revoked)
    const storedHash = await this.redis.get(
      `${REFRESH_TOKEN_PREFIX}${payload.sub}`,
    );

    if (!storedHash) {
      throw new UnauthorizedException('Refresh token has been revoked');
    }

    // Verify the token matches the stored hash
    const isValid = await bcrypt.compare(refreshToken, storedHash);
    if (!isValid) {
      // Possible token reuse attack - revoke all tokens for this user
      await this.revokeRefreshToken(payload.sub);
      throw new UnauthorizedException('Refresh token has been revoked');
    }

    // Fetch fresh player data
    const player = await this.playerRepository.findOne({
      where: { id: payload.sub },
    });

    if (!player) {
      throw new UnauthorizedException('Player not found');
    }

    // Rotate: issue new token pair, invalidate old refresh token
    const tokens = await this.generateTokenPair(player);

    return tokens;
  }

  /**
   * Revoke the refresh token for a player (logout).
   */
  async revokeRefreshToken(playerId: string): Promise<void> {
    await this.redis.del(`${REFRESH_TOKEN_PREFIX}${playerId}`);
  }

  /**
   * Generate an access + refresh token pair and store refresh token hash in Redis.
   */
  private async generateTokenPair(player: Player): Promise<TokenPair> {
    const payload: JwtPayload = {
      sub: player.id,
      email: player.email,
      displayName: player.displayName,
      role: (player as any).role || 'player',
    };

    const accessToken = this.jwtService.sign(payload);

    const refreshToken = this.jwtService.sign(payload, {
      expiresIn: this.configService.get<string>('jwt.refreshExpiresIn') || '7d',
    });

    // Store hashed refresh token in Redis with TTL
    const hashedRefreshToken = await bcrypt.hash(refreshToken, SALT_ROUNDS);
    await this.redis.setex(
      `${REFRESH_TOKEN_PREFIX}${player.id}`,
      this.refreshExpiresInSeconds,
      hashedRefreshToken,
    );

    return { accessToken, refreshToken };
  }

  /**
   * Parse a duration string like "7d", "1h", "30m" to seconds.
   */
  private parseDurationToSeconds(duration: string): number {
    const match = duration.match(/^(\d+)([smhd])$/);
    if (!match) {
      return 7 * 24 * 3600; // default 7 days
    }
    const value = parseInt(match[1], 10);
    const unit = match[2];
    switch (unit) {
      case 's': return value;
      case 'm': return value * 60;
      case 'h': return value * 3600;
      case 'd': return value * 86400;
      default: return 7 * 86400;
    }
  }
}
