import {
  CanActivate,
  ExecutionContext,
  INestApplication,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import cookieParser = require('cookie-parser');
import type { Request } from 'express';
import request = require('supertest');

import { AuthController } from '../src/auth/controllers/auth.controller';
import { AuthService, AuthenticatedIdentity } from '../src/auth/auth.service';
import { AccessTokenService } from '../src/auth/access-token.service';
import { RefreshTokenService } from '../src/auth/refresh-token.service';
import { BrowserOriginGuard } from '../src/auth/guards/browser-origin.guard';
import { CookieCsrfGuard } from '../src/auth/guards/cookie-csrf.guard';
import { JwtAuthGuard } from '../src/auth/guards/jwt-auth.guard';
import { AuthCookies } from '../src/auth/utils/auth-cookies';
import { getTrustedOrigins } from '../src/auth/utils/trusted-origins';

const TRUSTED_ORIGIN = 'http://localhost:3000';
const UNTRUSTED_ORIGIN = 'https://attacker.example';
const CSRF_TOKEN = 'a'.repeat(43);

const identity: AuthenticatedIdentity = {
  id: '11111111-1111-4111-8111-111111111111',
  fullName: 'Integration Test User',
  email: 'integration@example.com',
  status: 'ACTIVE' as AuthenticatedIdentity['status'],
};

@Injectable()
class TestJwtAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: AuthenticatedIdentity }>();

    if (
      request.headers.authorization !==
      'Bearer integration-access-token'
    ) {
      throw new UnauthorizedException();
    }

    request.user = identity;
    return true;
  }
}

describe('Authentication HTTP integration (e2e)', () => {
  let app: INestApplication;

  const authService = {
    validateCredentials: jest.fn(),
  };

  const accessTokenService = {
    issueAccessToken: jest.fn(),
  };

  const refreshTokenService = {
    createSession: jest.fn(),
    rotate: jest.fn(),
    revoke: jest.fn(),
    revokeAllForUser: jest.fn(),
  };

  const configValues: Record<string, string | number | boolean> = {
    NODE_ENV: 'test',
    APP_ORIGIN: TRUSTED_ORIGIN,
    REFRESH_TOKEN_TTL_DAYS: 30,
    JWT_ACCESS_TTL_SECONDS: 900,
  };

  const configService = {
    get: jest.fn((key: string) => configValues[key]),
    getOrThrow: jest.fn((key: string) => {
      const value = configValues[key];

      if (value === undefined) {
        throw new Error(`Missing test configuration: ${key}`);
      }

      return value;
    }),
  };

  const refreshCookie = 'assetpass_refresh';
  const csrfCookie = 'assetpass_csrf';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: ConfigService, useValue: configService },
        { provide: AuthService, useValue: authService },
        { provide: AccessTokenService, useValue: accessTokenService },
        { provide: RefreshTokenService, useValue: refreshTokenService },
        AuthCookies,
        BrowserOriginGuard,
        CookieCsrfGuard,
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useClass(TestJwtAuthGuard)
      .compile();

    app = moduleRef.createNestApplication();

    const trustedOrigins = getTrustedOrigins(
      configService as unknown as ConfigService,
    );

    app.setGlobalPrefix('api/v1');
    app.use(cookieParser());

    app.enableCors({
      origin: trustedOrigins,
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: [
        'Content-Type',
        'Authorization',
        'X-CSRF-Token',
      ],
      maxAge: 600,
    });

    await app.init();
  });

  beforeEach(() => {
    jest.clearAllMocks();

    authService.validateCredentials.mockResolvedValue(identity);
    accessTokenService.issueAccessToken.mockResolvedValue(
      'integration-access-token',
    );
    refreshTokenService.createSession.mockResolvedValue({
      refreshToken: 'integration-refresh-token',
      sessionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    });
    refreshTokenService.rotate.mockResolvedValue({
      refreshToken: 'rotated-refresh-token',
      sessionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      user: identity,
    });
    refreshTokenService.revoke.mockResolvedValue(undefined);
    refreshTokenService.revokeAllForUser.mockResolvedValue(undefined);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /api/v1/auth/login', () => {
    it('authenticates and sets the expected browser cookies', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .set('Origin', TRUSTED_ORIGIN)
        .set('User-Agent', 'AssetPass-Integration-Test/1.0')
        .send({
          email: identity.email,
          password: 'correct-password',
        })
        .expect(200);

      expect(response.body).toEqual({
        accessToken: 'integration-access-token',
        tokenType: 'Bearer',
        expiresIn: 900,
        user: identity,
      });

      expect(response.body.refreshToken).toBeUndefined();
      expect(response.headers['cache-control']).toBe('no-store');

      const cookies = response.headers['set-cookie'] as string[];

      expect(cookies).toHaveLength(2);
      expect(cookies.join(';')).toContain(
        `${refreshCookie}=integration-refresh-token`,
      );
      expect(cookies.join(';')).toContain(`${csrfCookie}=`);

      const refresh = cookies.find((cookie) =>
        cookie.startsWith(`${refreshCookie}=`),
      );
      const csrf = cookies.find((cookie) =>
        cookie.startsWith(`${csrfCookie}=`),
      );

      expect(refresh).toContain('HttpOnly');
      expect(refresh).toContain('Path=/api/v1/auth');
      expect(refresh).toContain('SameSite=Lax');

      expect(csrf).not.toContain('HttpOnly');
      expect(csrf).toContain('Path=/api/v1/auth');
      expect(csrf).toContain('SameSite=Lax');

      expect(authService.validateCredentials).toHaveBeenCalledWith(
        identity.email,
        'correct-password',
      );
      expect(refreshTokenService.createSession).toHaveBeenCalledWith(
        identity.id,
        expect.objectContaining({
          userAgent: 'AssetPass-Integration-Test/1.0',
        }),
      );
    });

    it('rejects an untrusted origin', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .set('Origin', UNTRUSTED_ORIGIN)
        .send({
          email: identity.email,
          password: 'correct-password',
        })
        .expect(403);

      expect(authService.validateCredentials).not.toHaveBeenCalled();
    });

    it('rejects a missing origin', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({
          email: identity.email,
          password: 'correct-password',
        })
        .expect(403);

      expect(authService.validateCredentials).not.toHaveBeenCalled();
    });

    it('returns 401 for invalid credentials', async () => {
      authService.validateCredentials.mockRejectedValue(
        new UnauthorizedException('Invalid email or password.'),
      );

      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .set('Origin', TRUSTED_ORIGIN)
        .send({
          email: identity.email,
          password: 'wrong-password',
        })
        .expect(401);

      expect(refreshTokenService.createSession).not.toHaveBeenCalled();
    });

    it('rejects malformed login input', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .set('Origin', TRUSTED_ORIGIN)
        .send({
          email: identity.email,
          password: '',
        })
        .expect(400);

      expect(authService.validateCredentials).not.toHaveBeenCalled();
    });
  });

  describe('POST /api/v1/auth/refresh', () => {
    it('rotates the refresh cookie when Origin and CSRF checks pass', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .set('Origin', TRUSTED_ORIGIN)
        .set(
          'Cookie',
          [
            `${refreshCookie}=old-refresh-token`,
            `${csrfCookie}=${CSRF_TOKEN}`,
          ].join('; '),
        )
        .set('X-CSRF-Token', CSRF_TOKEN)
        .expect(200);

      expect(response.body).toEqual({
        accessToken: 'integration-access-token',
        tokenType: 'Bearer',
        expiresIn: 900,
      });

      expect(response.body.refreshToken).toBeUndefined();
      expect(response.headers['cache-control']).toBe('no-store');

      expect(refreshTokenService.rotate).toHaveBeenCalledWith(
        'old-refresh-token',
        expect.any(Object),
      );

      const cookies = response.headers['set-cookie'] as string[];

      expect(cookies.join(';')).toContain(
        `${refreshCookie}=rotated-refresh-token`,
      );
      expect(cookies.join(';')).toContain(`${csrfCookie}=${CSRF_TOKEN}`);
    });

    it('rejects a request without a CSRF token', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .set('Origin', TRUSTED_ORIGIN)
        .set('Cookie', `${refreshCookie}=old-refresh-token`)
        .expect(403);

      expect(refreshTokenService.rotate).not.toHaveBeenCalled();
    });

    it('rejects mismatched CSRF tokens', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .set('Origin', TRUSTED_ORIGIN)
        .set(
          'Cookie',
          `${refreshCookie}=old-refresh-token; ${csrfCookie}=${CSRF_TOKEN}`,
        )
        .set('X-CSRF-Token', 'b'.repeat(43))
        .expect(403);

      expect(refreshTokenService.rotate).not.toHaveBeenCalled();
    });

    it('rejects an untrusted origin', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .set('Origin', UNTRUSTED_ORIGIN)
        .set(
          'Cookie',
          `${refreshCookie}=old-refresh-token; ${csrfCookie}=${CSRF_TOKEN}`,
        )
        .set('X-CSRF-Token', CSRF_TOKEN)
        .expect(403);

      expect(refreshTokenService.rotate).not.toHaveBeenCalled();
    });

    it('rejects a missing refresh cookie', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .set('Origin', TRUSTED_ORIGIN)
        .set('Cookie', `${csrfCookie}=${CSRF_TOKEN}`)
        .set('X-CSRF-Token', CSRF_TOKEN)
        .expect(401);
    });
  });

  describe('POST /api/v1/auth/logout', () => {
    it('revokes the current session and clears authentication cookies', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/logout')
        .set('Origin', TRUSTED_ORIGIN)
        .set(
          'Cookie',
          [
            `${refreshCookie}=current-refresh-token`,
            `${csrfCookie}=${CSRF_TOKEN}`,
          ].join('; '),
        )
        .set('X-CSRF-Token', CSRF_TOKEN)
        .expect(204);

      expect(refreshTokenService.revoke).toHaveBeenCalledWith(
        'current-refresh-token',
      );

      const cookies = response.headers['set-cookie'] as string[];

      expect(cookies.join(';')).toContain(`${refreshCookie}=;`);
      expect(cookies.join(';')).toContain(`${csrfCookie}=;`);
    });

    it('rejects logout without valid CSRF protection', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/logout')
        .set('Origin', TRUSTED_ORIGIN)
        .set('Cookie', `${refreshCookie}=current-refresh-token`)
        .expect(403);

      expect(refreshTokenService.revoke).not.toHaveBeenCalled();
    });
  });

  describe('POST /api/v1/auth/logout-all', () => {
    it('revokes all sessions for the authenticated user', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/logout-all')
        .set('Origin', TRUSTED_ORIGIN)
        .set('Authorization', 'Bearer integration-access-token')
        .expect(204);

      expect(refreshTokenService.revokeAllForUser).toHaveBeenCalledWith(
        identity.id,
      );
    });

    it('rejects an unauthenticated request', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/logout-all')
        .set('Origin', TRUSTED_ORIGIN)
        .expect(401);

      expect(refreshTokenService.revokeAllForUser).not.toHaveBeenCalled();
    });

    it('rejects an untrusted origin', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/logout-all')
        .set('Origin', UNTRUSTED_ORIGIN)
        .set('Authorization', 'Bearer integration-access-token')
        .expect(403);

      expect(refreshTokenService.revokeAllForUser).not.toHaveBeenCalled();
    });
  });

  describe('GET /api/v1/auth/me', () => {
    it('returns the authenticated user without sensitive fields', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Authorization', 'Bearer integration-access-token')
        .expect(200);

      expect(response.body).toEqual(identity);
      expect(response.body.passwordHash).toBeUndefined();
      expect(response.headers['cache-control']).toBe('no-store');
    });

    it('rejects an unauthenticated request', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .expect(401);
    });
  });

  describe('CORS', () => {
    it('allows preflight requests from the configured frontend origin', async () => {
      const response = await request(app.getHttpServer())
        .options('/api/v1/auth/login')
        .set('Origin', TRUSTED_ORIGIN)
        .set('Access-Control-Request-Method', 'POST')
        .set(
          'Access-Control-Request-Headers',
          'content-type,x-csrf-token',
        )
        .expect(204);

      expect(response.headers['access-control-allow-origin']).toBe(
        TRUSTED_ORIGIN,
      );
      expect(response.headers['access-control-allow-credentials']).toBe(
        'true',
      );
      expect(response.headers['access-control-allow-methods']).toContain(
        'POST',
      );
      expect(
        response.headers['access-control-allow-headers'].toLowerCase(),
      ).toContain('x-csrf-token');
    });

    it('does not grant CORS access to an untrusted origin', async () => {
      const response = await request(app.getHttpServer())
        .options('/api/v1/auth/login')
        .set('Origin', UNTRUSTED_ORIGIN)
        .set('Access-Control-Request-Method', 'POST')
        .expect(204);

      // Browsers deny access because the allowed-origin header is absent.
      // The credentials header alone does not grant cross-origin access.
      expect(
        response.headers['access-control-allow-origin'],
      ).toBeUndefined();
    });
  });
});
