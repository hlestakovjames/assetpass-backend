import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { IsNull, Repository } from 'typeorm';

import { User, UserStatus } from '../../identity/entities/user.entity';
import { AuthenticatedIdentity } from '../auth.service';
import { AuthSession } from '../auth-session.entity';
import { JwtAccessPayload } from '../interfaces/jwt-access-payload.interface';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MAX_FUTURE_IAT_SKEW_SECONDS = 60;

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService,
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    @InjectRepository(AuthSession)
    private readonly sessionsRepository: Repository<AuthSession>,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.getOrThrow<string>('JWT_ACCESS_SECRET'),
      algorithms: ['HS256'],
      issuer: configService.getOrThrow<string>('JWT_ACCESS_ISSUER'),
      audience: configService.getOrThrow<string>('JWT_ACCESS_AUDIENCE'),
    });
  }

  async validate(payload: JwtAccessPayload): Promise<AuthenticatedIdentity> {
    const now = Math.floor(Date.now() / 1000);

    if (
      !payload ||
      typeof payload.sub !== 'string' ||
      !UUID_PATTERN.test(payload.sub) ||
      typeof payload.sid !== 'string' ||
      !UUID_PATTERN.test(payload.sid) ||
      typeof payload.jti !== 'string' ||
      !UUID_PATTERN.test(payload.jti) ||
      !Number.isSafeInteger(payload.iat) ||
      payload.iat <= 0 ||
      !Number.isSafeInteger(payload.exp) ||
      payload.exp <= 0 ||
      payload.exp <= payload.iat ||
      payload.exp <= now ||
      payload.iat > now + MAX_FUTURE_IAT_SKEW_SECONDS
    ) {
      throw new UnauthorizedException('Invalid access token.');
    }

    const user = await this.usersRepository.findOne({
      where: { id: payload.sub },
      select: {
        id: true,
        fullName: true,
        email: true,
        status: true,
        deactivatedAt: true,
      },
    });

    if (
      !user ||
      user.status !== UserStatus.ACTIVE ||
      user.deactivatedAt !== null
    ) {
      throw new UnauthorizedException('Authentication is no longer valid.');
    }

    const session = await this.sessionsRepository.findOne({
      where: {
        id: payload.sid,
        userId: payload.sub,
        revokedAt: IsNull(),
      },
      select: {
        id: true,
        userId: true,
        expiresAt: true,
        revokedAt: true,
      },
    });

    if (
      !session ||
      session.expiresAt <= new Date() ||
      session.revokedAt !== null
    ) {
      throw new UnauthorizedException('Authentication is no longer valid.');
    }

    return {
      id: user.id,
      fullName: user.fullName,
      email: user.email,
      status: user.status,
    };
  }
}
