import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';

import { User, UserStatus } from '../../identity/entities/user.entity';
import { AuthSession } from '../auth-session.entity';
import { JwtAccessPayload } from '../interfaces/jwt-access-payload.interface';
import { JwtStrategy } from './jwt.strategy';

describe('JwtStrategy', () => {
  let strategy: JwtStrategy;

  let usersRepository: jest.Mocked<Pick<Repository<User>, 'findOne'>>;
  let sessionsRepository: jest.Mocked<Pick<Repository<AuthSession>, 'findOne'>>;

  const activeUser = {
    id: '9fed3a07-5a17-4b94-8437-552edeebf5a6',
    fullName: 'Platform Owner',
    email: 'owner@example.com',
    status: UserStatus.ACTIVE,
    deactivatedAt: null,
  };

  const sessionId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

  const validSession = {
    id: sessionId,
    userId: activeUser.id,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    revokedAt: null,
  };

  const validPayload: JwtAccessPayload = {
    sub: activeUser.id,
    sid: sessionId,
    jti: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    iat: Math.floor(Date.now() / 1000) - 30,
    exp: Math.floor(Date.now() / 1000) + 900,
    iss: 'assetpass-api',
    aud: 'assetpass-app',
  };

  beforeEach(() => {
    usersRepository = {
      findOne: jest.fn(),
    };

    sessionsRepository = {
      findOne: jest.fn(),
    };

    const configService = {
      getOrThrow: jest.fn((key: string) => {
        const values: Record<string, string> = {
          JWT_ACCESS_SECRET: 'a'.repeat(64),
          JWT_ACCESS_ISSUER: 'assetpass-api',
          JWT_ACCESS_AUDIENCE: 'assetpass-app',
        };

        return values[key];
      }),
    };

    strategy = new JwtStrategy(
      configService as unknown as ConfigService,
      usersRepository as unknown as Repository<User>,
      sessionsRepository as unknown as Repository<AuthSession>,
    );
  });

  it('loads and returns the current identity of an active user with a valid session', async () => {
    usersRepository.findOne.mockResolvedValue(activeUser as User);
    sessionsRepository.findOne.mockResolvedValue(validSession as AuthSession);

    const result = await strategy.validate(validPayload);

    expect(usersRepository.findOne).toHaveBeenCalledWith({
      where: { id: activeUser.id },
      select: {
        id: true,
        fullName: true,
        email: true,
        status: true,
        deactivatedAt: true,
      },
    });

    expect(sessionsRepository.findOne).toHaveBeenCalledWith({
      where: {
        id: sessionId,
        userId: activeUser.id,
        revokedAt: expect.anything(),
      },
      select: {
        id: true,
        userId: true,
        expiresAt: true,
        revokedAt: true,
      },
    });

    expect(result).toEqual({
      id: activeUser.id,
      fullName: activeUser.fullName,
      email: activeUser.email,
      status: UserStatus.ACTIVE,
    });

    expect(result).not.toHaveProperty('passwordHash');
  });

  it('rejects a missing user', async () => {
    usersRepository.findOne.mockResolvedValue(null);

    await expect(strategy.validate(validPayload)).rejects.toThrow(
      UnauthorizedException,
    );

    expect(sessionsRepository.findOne).not.toHaveBeenCalled();
  });

  it('rejects an inactive user', async () => {
    usersRepository.findOne.mockResolvedValue({
      ...activeUser,
      status: UserStatus.INACTIVE,
    } as User);

    await expect(strategy.validate(validPayload)).rejects.toThrow(
      UnauthorizedException,
    );

    expect(sessionsRepository.findOne).not.toHaveBeenCalled();
  });

  it('rejects a suspended user', async () => {
    usersRepository.findOne.mockResolvedValue({
      ...activeUser,
      status: UserStatus.SUSPENDED,
    } as User);

    await expect(strategy.validate(validPayload)).rejects.toThrow(
      UnauthorizedException,
    );

    expect(sessionsRepository.findOne).not.toHaveBeenCalled();
  });

  it('rejects a deactivated user', async () => {
    usersRepository.findOne.mockResolvedValue({
      ...activeUser,
      deactivatedAt: new Date(),
    } as User);

    await expect(strategy.validate(validPayload)).rejects.toThrow(
      UnauthorizedException,
    );

    expect(sessionsRepository.findOne).not.toHaveBeenCalled();
  });

  it('rejects an invalid subject identifier', async () => {
    const payload = {
      ...validPayload,
      sub: 'not-a-uuid',
    };

    await expect(strategy.validate(payload)).rejects.toThrow(
      UnauthorizedException,
    );

    expect(usersRepository.findOne).not.toHaveBeenCalled();
    expect(sessionsRepository.findOne).not.toHaveBeenCalled();
  });

  it('rejects an invalid session identifier', async () => {
    const payload = {
      ...validPayload,
      sid: 'not-a-uuid',
    };

    await expect(strategy.validate(payload)).rejects.toThrow(
      UnauthorizedException,
    );

    expect(usersRepository.findOne).not.toHaveBeenCalled();
    expect(sessionsRepository.findOne).not.toHaveBeenCalled();
  });

  it('rejects a missing session identifier', async () => {
    const payload = {
      ...validPayload,
      sid: undefined,
    } as unknown as JwtAccessPayload;

    await expect(strategy.validate(payload)).rejects.toThrow(
      UnauthorizedException,
    );

    expect(usersRepository.findOne).not.toHaveBeenCalled();
  });

  it('rejects an invalid token identifier', async () => {
    const payload = {
      ...validPayload,
      jti: 'invalid-token-id',
    };

    await expect(strategy.validate(payload)).rejects.toThrow(
      UnauthorizedException,
    );

    expect(usersRepository.findOne).not.toHaveBeenCalled();
  });

  it.each([
    ['NaN issued-at timestamp', { iat: Number.NaN }],
    ['infinite issued-at timestamp', { iat: Number.POSITIVE_INFINITY }],
    ['fractional issued-at timestamp', { iat: 1.5 }],
    ['negative issued-at timestamp', { iat: -1 }],
    ['NaN expiration timestamp', { exp: Number.NaN }],
    ['infinite expiration timestamp', { exp: Number.POSITIVE_INFINITY }],
    ['fractional expiration timestamp', { exp: 1.5 }],
    ['negative expiration timestamp', { exp: -1 }],
    ['expiration before issuance', { exp: validPayload.iat }],
    ['already expired token', { exp: Math.floor(Date.now() / 1000) - 1 }],
    [
      'issued-at timestamp too far in the future',
      { iat: Math.floor(Date.now() / 1000) + 61 },
    ],
  ])('rejects a token with %s', async (_description, overrides) => {
    const payload = {
      ...validPayload,
      ...overrides,
    } as JwtAccessPayload;

    await expect(strategy.validate(payload)).rejects.toThrow(
      UnauthorizedException,
    );

    expect(usersRepository.findOne).not.toHaveBeenCalled();
    expect(sessionsRepository.findOne).not.toHaveBeenCalled();
  });

  it('rejects missing timestamp claims', async () => {
    const payload = {
      ...validPayload,
      iat: undefined,
    } as unknown as JwtAccessPayload;

    await expect(strategy.validate(payload)).rejects.toThrow(
      UnauthorizedException,
    );

    expect(usersRepository.findOne).not.toHaveBeenCalled();
  });

  it('rejects a revoked or nonexistent session', async () => {
    usersRepository.findOne.mockResolvedValue(activeUser as User);
    sessionsRepository.findOne.mockResolvedValue(null);

    await expect(strategy.validate(validPayload)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rejects an expired session', async () => {
    usersRepository.findOne.mockResolvedValue(activeUser as User);
    sessionsRepository.findOne.mockResolvedValue({
      ...validSession,
      expiresAt: new Date(Date.now() - 1000),
    } as AuthSession);

    await expect(strategy.validate(validPayload)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rejects a session belonging to a different user', async () => {
    usersRepository.findOne.mockResolvedValue(activeUser as User);

    // A session lookup that includes both sid and sub must not find
    // a session belonging to a different user.
    sessionsRepository.findOne.mockResolvedValue(null);

    await expect(strategy.validate(validPayload)).rejects.toThrow(
      UnauthorizedException,
    );

    expect(sessionsRepository.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: sessionId,
          userId: activeUser.id,
        }),
      }),
    );
  });
});
