import {
  Controller,
  Get,
  INestApplication,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PassportModule } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import type { Request } from 'express';
import type { Repository } from 'typeorm';
import request = require('supertest');

import { User, UserStatus } from '../src/identity/entities/user.entity';
import { AuthSession } from '../src/auth/auth-session.entity';
import { JwtAuthGuard } from '../src/auth/guards/jwt-auth.guard';
import { JwtStrategy } from '../src/auth/strategies/jwt.strategy';

const JWT_SECRET = 'integration-test-secret-that-is-at-least-64-characters-long';
const JWT_ISSUER = 'assetpass-api';
const JWT_AUDIENCE = 'assetpass-app';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const SESSION_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const TOKEN_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const activeUser = {
  id: USER_ID,
  fullName: 'JWT Integration User',
  email: 'jwt-integration@example.com',
  status: UserStatus.ACTIVE,
  deactivatedAt: null,
};

@Controller('auth-test')
class JwtProtectedTestController {
  @Get('protected')
  @UseGuards(JwtAuthGuard)
  getProtectedResource(
    @Req() request: Request & { user: Record<string, unknown> },
  ) {
    return request.user;
  }
}

describe('Real JWT authentication HTTP integration (e2e)', () => {
  let app: INestApplication;
  let jwtService: JwtService;

  const usersRepository = {
    findOne: jest.fn(),
  };

  const sessionsRepository = {
    findOne: jest.fn(),
  };

  const validSession = {
    id: SESSION_ID,
    userId: USER_ID,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    revokedAt: null,
  };

  beforeAll(async () => {
    const configService = {
      getOrThrow: jest.fn((key: string) => {
        const values: Record<string, string> = {
          JWT_ACCESS_SECRET: JWT_SECRET,
          JWT_ACCESS_ISSUER: JWT_ISSUER,
          JWT_ACCESS_AUDIENCE: JWT_AUDIENCE,
        };

        const value = values[key];

        if (!value) {
          throw new Error(`Missing test configuration: ${key}`);
        }

        return value;
      }),
    };

    const moduleRef = await Test.createTestingModule({
      imports: [
        PassportModule.register({ defaultStrategy: 'jwt' }),
        JwtModule.register({
          secret: JWT_SECRET,
          signOptions: {
            algorithm: 'HS256',
            issuer: JWT_ISSUER,
            audience: JWT_AUDIENCE,
            expiresIn: 900,
          },
        }),
      ],
      controllers: [JwtProtectedTestController],
      providers: [
        JwtStrategy,
        JwtAuthGuard,
        { provide: ConfigService, useValue: configService },
        {
          provide: getRepositoryToken(User),
          useValue: usersRepository,
        },
        {
          provide: getRepositoryToken(AuthSession),
          useValue: sessionsRepository,
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    jwtService = moduleRef.get(JwtService);

    await app.init();
  });

  beforeEach(() => {
    jest.clearAllMocks();

    usersRepository.findOne.mockResolvedValue(activeUser);
    sessionsRepository.findOne.mockResolvedValue({
      ...validSession,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });
  });

  afterAll(async () => {
    await app.close();
  });

  async function createAccessToken(
    overrides: {
      issuer?: string;
      audience?: string;
      expiresIn?: number;
    } = {},
  ): Promise<string> {
    return jwtService.signAsync(
      {
        sub: USER_ID,
        sid: SESSION_ID,
        jti: TOKEN_ID,
      },
      {
        ...(overrides.issuer
          ? { issuer: overrides.issuer }
          : {}),
        ...(overrides.audience
          ? { audience: overrides.audience }
          : {}),
        ...(overrides.expiresIn !== undefined
          ? { expiresIn: overrides.expiresIn }
          : {}),
      },
    );
  }

  function requestProtectedResource(token: string) {
    return request(app.getHttpServer())
      .get('/auth-test/protected')
      .set('Authorization', `Bearer ${token}`);
  }

  it('accepts a valid signed JWT with an active user and session', async () => {
    const token = await createAccessToken();

    const response = await requestProtectedResource(token).expect(200);

    expect(response.body).toEqual({
      id: USER_ID,
      fullName: activeUser.fullName,
      email: activeUser.email,
      status: UserStatus.ACTIVE,
    });

    expect(usersRepository.findOne).toHaveBeenCalledTimes(1);
    expect(sessionsRepository.findOne).toHaveBeenCalledTimes(1);
  });

  it('rejects a token signed with an untrusted secret', async () => {
    const untrustedSigner = new JwtService({
      secret: 'different-untrusted-secret-that-is-also-long-enough',
    });

    const token = await untrustedSigner.signAsync(
      {
        sub: USER_ID,
        sid: SESSION_ID,
        jti: TOKEN_ID,
      },
      {
        algorithm: 'HS256',
        issuer: JWT_ISSUER,
        audience: JWT_AUDIENCE,
        expiresIn: 900,
      },
    );

    await requestProtectedResource(token).expect(401);

    expect(usersRepository.findOne).not.toHaveBeenCalled();
    expect(sessionsRepository.findOne).not.toHaveBeenCalled();
  });

  it('rejects a token with the wrong issuer', async () => {
    const token = await createAccessToken({
      issuer: 'untrusted-issuer',
    });

    await requestProtectedResource(token).expect(401);

    expect(usersRepository.findOne).not.toHaveBeenCalled();
  });

  it('rejects a token with the wrong audience', async () => {
    const token = await createAccessToken({
      audience: 'untrusted-audience',
    });

    await requestProtectedResource(token).expect(401);

    expect(usersRepository.findOne).not.toHaveBeenCalled();
  });

  it('rejects an expired JWT', async () => {
    const token = await createAccessToken({
      expiresIn: -10,
    });

    await requestProtectedResource(token).expect(401);

    expect(usersRepository.findOne).not.toHaveBeenCalled();
  });

  it('rejects a JWT after its session has been revoked', async () => {
    const token = await createAccessToken();

    sessionsRepository.findOne.mockResolvedValue(null);

    await requestProtectedResource(token).expect(401);

    expect(sessionsRepository.findOne).toHaveBeenCalledTimes(1);
  });

  it('rejects a JWT when its database session has expired', async () => {
    const token = await createAccessToken();

    sessionsRepository.findOne.mockResolvedValue({
      ...validSession,
      expiresAt: new Date(Date.now() - 1000),
    });

    await requestProtectedResource(token).expect(401);
  });

  it('rejects a JWT whose session belongs to another user', async () => {
    const token = await createAccessToken();

    sessionsRepository.findOne.mockResolvedValue(null);

    await requestProtectedResource(token).expect(401);

    expect(sessionsRepository.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: SESSION_ID,
          userId: USER_ID,
        }),
      }),
    );
  });

  it('rejects a JWT when the account is no longer active', async () => {
    const token = await createAccessToken();

    usersRepository.findOne.mockResolvedValue({
      ...activeUser,
      status: UserStatus.SUSPENDED,
    });

    await requestProtectedResource(token).expect(401);

    expect(sessionsRepository.findOne).not.toHaveBeenCalled();
  });
});
