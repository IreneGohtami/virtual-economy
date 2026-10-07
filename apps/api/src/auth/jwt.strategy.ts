import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Player } from '../entities/player.entity';
import { JwtPayload } from './auth.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService,
    @InjectRepository(Player)
    private readonly playerRepository: Repository<Player>,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('jwt.secret'),
    });
  }

  /**
   * Called by Passport after the JWT is verified.
   * Attaches the full player record to the request.
   */
  async validate(payload: JwtPayload): Promise<Player> {
    const player = await this.playerRepository.findOne({
      where: { id: payload.sub },
    });

    if (!player) {
      throw new UnauthorizedException('Player not found');
    }

    return player;
  }
}
