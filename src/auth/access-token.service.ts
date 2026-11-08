import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'node:crypto';

@Injectable()
export class AccessTokenService {
  constructor(private readonly jwtService: JwtService) {}

  async issueAccessToken(
    userId: string,
    sessionId: string,
  ): Promise<string> {
    return this.jwtService.signAsync({
      sub: userId,
      sid: sessionId,
      jti: randomUUID(),
    });
  }
}
