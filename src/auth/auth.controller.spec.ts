import {
  BadRequestException,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request, Response } from 'express';

import { AuthController } from './controllers/auth.controller';
import { AuthService, AuthenticatedIdentity } from './auth.service';
import { AccessTokenService } from './access-token.service';
import { RefreshTokenService } from './refresh-token.service';
import { AuthCookies } from './utils/auth-cookies';
import { UserStatus } from '../identity/entities/user.entity';

describe('AuthController', () => {
  let controller: AuthController;

  let authService: {
    validateCredentials: jest.Mock;
  };

  let accessTokenService: {
    issueAccessToken: jest.Mock;
  };

  let refreshTokenService: {
    createSession: jest.Mock;
    rotate: jest.Mock;
    revoke: jest.Mock;
    revokeAllForUser: jest.Mock;
  };

  let authCookies: {
    refreshCookieName: string;
    csrfCookieName: string;
    createCsrfToken: jest.Mock;
    isValidCsrfToken: jest.Mock;
    setCsrfCookie: jest.Mock;
    setAuthCookies: jest.Mock;
    clearAuthCookies: jest.Mock;
    getAccessTokenTtlSeconds: jest.Mock;
  };

  let response: {
    setHeader: jest.Mock;
    cookie: jest.Mock;
    clearCookie: jest.Mock;
  };

  const identity = {
    id: '9fed3a07-5a17-4b94-8437-552edeebf5a6',
    fullName: 'Test User',
    email: 'test@example.com',
    status: UserStatus.ACTIVE,
  } as AuthenticatedIdentity;

  const csrfToken = 'a'.repeat(43);

  const makeRequest = (
    overrides: Record<string, unknown> = {},
  ) =>
    ({
      ip: '127.0.0.1',
      headers: {
        'user-agent': 'AssetPass test client',
      },
      cookies: {},
      ...overrides,
    }) as unknown as Request & {
      user: AuthenticatedIdentity;
      cookies?: Record<string, string>;
    };

  const makeResponse = () =>
    ({
      setHeader: jest.fn(),
      cookie: jest.fn(),
      clearCookie: jest.fn(),
    }) as unknown as Response;

  beforeEach(() => {
    authService = {
      validateCredentials: jest.fn().mockResolvedValue(identity),
    };

    accessTokenService = {
      issueAccessToken: jest.fn().mockResolvedValue('access-token'),
    };

    refreshTokenService = {
      createSession: jest.fn().mockResolvedValue({
        refreshToken: 'refresh-token',
        sessionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      }),
      rotate: jest.fn().mockResolvedValue({
        refreshToken: 'rotated-refresh-token',
        sessionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        user: identity,
      }),
      revoke: jest.fn().mockResolvedValue(undefined),
      revokeAllForUser: jest.fn().mockResolvedValue(2),
    };

    authCookies = {
      refreshCookieName: 'assetpass_refresh',
      csrfCookieName: 'assetpass_csrf',
      createCsrfToken: jest.fn().mockReturnValue(csrfToken),
      isValidCsrfToken: jest.fn(
        (token: unknown) =>
          typeof token === 'string' &&
          /^[A-Za-z0-9_-]{43}$/.test(token),
      ),
      setCsrfCookie: jest.fn(),
      setAuthCookies: jest.fn(),
      clearAuthCookies: jest.fn(),
      getAccessTokenTtlSeconds: jest.fn().mockReturnValue(900),
    };

    response = {
      setHeader: jest.fn(),
      cookie: jest.fn(),
      clearCookie: jest.fn(),
    };

    controller = new AuthController(
      authService as unknown as AuthService,
      accessTokenService as unknown as AccessTokenService,
      refreshTokenService as unknown as RefreshTokenService,
      authCookies as unknown as AuthCookies,
      {} as never,
    );
  });

  describe('csrf bootstrap', () => {
    it('reuses a valid CSRF cookie without resetting it', () => {
      const request = makeRequest({
        cookies: {
          assetpass_csrf: csrfToken,
        },
      });

      const result = controller.getCsrfToken(
        request,
        response as unknown as Response,
      );

      expect(result).toEqual({ csrfToken });
      expect(authCookies.isValidCsrfToken).toHaveBeenCalledWith(
        csrfToken,
      );
      expect(authCookies.createCsrfToken).not.toHaveBeenCalled();
      expect(authCookies.setCsrfCookie).not.toHaveBeenCalled();
      expect(response.setHeader).toHaveBeenCalledWith(
        'Cache-Control',
        'no-store',
      );
    });

    it('creates and sets a CSRF cookie when one is missing', () => {
      const result = controller.getCsrfToken(
        makeRequest(),
        response as unknown as Response,
      );

      expect(result).toEqual({ csrfToken });
      expect(authCookies.createCsrfToken).toHaveBeenCalledTimes(1);
      expect(authCookies.setCsrfCookie).toHaveBeenCalledWith(
        response,
        csrfToken,
      );
      expect(response.setHeader).toHaveBeenCalledWith(
        'Cache-Control',
        'no-store',
      );
    });

    it('replaces a malformed CSRF cookie', () => {
      const result = controller.getCsrfToken(
        makeRequest({
          cookies: {
            assetpass_csrf: 'malformed-token',
          },
        }),
        response as unknown as Response,
      );

      expect(result).toEqual({ csrfToken });
      expect(authCookies.createCsrfToken).toHaveBeenCalledTimes(1);
      expect(authCookies.setCsrfCookie).toHaveBeenCalledWith(
        response,
        csrfToken,
      );
    });
  });

  describe('login', () => {
    it('authenticates a user and creates browser authentication cookies', async () => {
      const request = makeRequest();

      const result = await controller.login(
        {
          email: 'test@example.com',
          password: 'correct-password',
        },
        request,
        response as unknown as Response,
      );

      expect(authService.validateCredentials).toHaveBeenCalledWith(
        'test@example.com',
        'correct-password',
      );

      expect(refreshTokenService.createSession).toHaveBeenCalledWith(
        identity.id,
        {
          sourceIp: '127.0.0.1',
          userAgent: 'AssetPass test client',
        },
      );

      expect(accessTokenService.issueAccessToken).toHaveBeenCalledWith(
        identity.id,
        'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      );

      expect(authCookies.setAuthCookies).toHaveBeenCalledWith(
        response,
        'refresh-token',
        csrfToken,
      );

      expect(response.setHeader).toHaveBeenCalledWith(
        'Cache-Control',
        'no-store',
      );

      expect(result).toEqual({
        accessToken: 'access-token',
        tokenType: 'Bearer',
        expiresIn: 900,
        user: {
          id: identity.id,
          fullName: identity.fullName,
          email: identity.email,
          status: identity.status,
        },
      });

      expect(result).not.toHaveProperty('refreshToken');
    });

    it.each([
      [undefined, 'missing body'],
      [{ email: 'test@example.com' }, 'missing password'],
      [{ email: 123, password: 'password' }, 'invalid email type'],
      [{ email: 'test@example.com', password: '' }, 'empty password'],
      [
        { email: 'a'.repeat(321), password: 'password' },
        'oversized email',
      ],
      [
        { email: 'test@example.com', password: 'p'.repeat(1025) },
        'oversized password',
      ],
    ])('rejects malformed login input: %s', async (body) => {
      await expect(
        controller.login(
          body as never,
          makeRequest(),
          response as unknown as Response,
        ),
      ).rejects.toThrow(BadRequestException);

      expect(authService.validateCredentials).not.toHaveBeenCalled();
      expect(refreshTokenService.createSession).not.toHaveBeenCalled();
    });

    it('does not create a session when credentials are invalid', async () => {
      authService.validateCredentials.mockRejectedValue(
        new UnauthorizedException('Invalid email or password.'),
      );

      await expect(
        controller.login(
          {
            email: 'test@example.com',
            password: 'wrong-password',
          },
          makeRequest(),
          response as unknown as Response,
        ),
      ).rejects.toThrow(UnauthorizedException);

      expect(refreshTokenService.createSession).not.toHaveBeenCalled();
      expect(authCookies.setAuthCookies).not.toHaveBeenCalled();
    });
  });

  describe('refresh', () => {
    it('rotates the refresh token and returns a new access token', async () => {
      const request = makeRequest({
        cookies: {
          assetpass_refresh: 'old-refresh-token',
          assetpass_csrf: csrfToken,
        },
      });

      const result = await controller.refresh(
        request,
        response as unknown as Response,
      );

      expect(refreshTokenService.rotate).toHaveBeenCalledWith(
        'old-refresh-token',
        {
          sourceIp: '127.0.0.1',
          userAgent: 'AssetPass test client',
        },
      );

      expect(accessTokenService.issueAccessToken).toHaveBeenCalledWith(
        identity.id,
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      );

      expect(authCookies.setAuthCookies).toHaveBeenCalledWith(
        response,
        'rotated-refresh-token',
        csrfToken,
      );

      expect(response.setHeader).toHaveBeenCalledWith(
        'Cache-Control',
        'no-store',
      );

      expect(result).toEqual({
        accessToken: 'access-token',
        tokenType: 'Bearer',
        expiresIn: 900,
      });

      expect(result).not.toHaveProperty('refreshToken');
    });

    it('rejects a missing refresh cookie', async () => {
      await expect(
        controller.refresh(
          makeRequest(),
          response as unknown as Response,
        ),
      ).rejects.toThrow(UnauthorizedException);

      expect(refreshTokenService.rotate).not.toHaveBeenCalled();
    });

    it('clears authentication cookies when rotation fails', async () => {
      refreshTokenService.rotate.mockRejectedValue(
        new UnauthorizedException('Invalid or expired refresh token.'),
      );

      await expect(
        controller.refresh(
          makeRequest({
            cookies: {
              assetpass_refresh: 'invalid-refresh-token',
              assetpass_csrf: csrfToken,
            },
          }),
          response as unknown as Response,
        ),
      ).rejects.toThrow(UnauthorizedException);

      expect(authCookies.clearAuthCookies).toHaveBeenCalledWith(response);
    });
  });

  describe('logout', () => {
    it('revokes the current refresh session and clears cookies', async () => {
      await controller.logout(
        makeRequest({
          cookies: {
            assetpass_refresh: 'current-refresh-token',
          },
        }),
        response as unknown as Response,
      );

      expect(refreshTokenService.revoke).toHaveBeenCalledWith(
        'current-refresh-token',
      );

      expect(authCookies.clearAuthCookies).toHaveBeenCalledWith(response);
    });

    it('clears cookies even when no refresh cookie is present', async () => {
      await controller.logout(
        makeRequest(),
        response as unknown as Response,
      );

      expect(refreshTokenService.revoke).not.toHaveBeenCalled();
      expect(authCookies.clearAuthCookies).toHaveBeenCalledWith(response);
    });
  });

  describe('logoutAll', () => {
    it('revokes all sessions belonging to the authenticated user', async () => {
      await controller.logoutAll(
        makeRequest({
          user: identity,
        }),
        response as unknown as Response,
      );

      expect(refreshTokenService.revokeAllForUser).toHaveBeenCalledWith(
        identity.id,
      );

      expect(authCookies.clearAuthCookies).toHaveBeenCalledWith(response);
    });
  });

  describe('getCurrentUser', () => {
    it('returns the authenticated identity without sensitive fields', () => {
      const result = controller.getCurrentUser(
        makeRequest({
          user: identity,
        }),
        response as unknown as Response,
      );

      expect(result).toEqual({
        id: identity.id,
        fullName: identity.fullName,
        email: identity.email,
        status: identity.status,
      });

      expect(response.setHeader).toHaveBeenCalledWith(
        'Cache-Control',
        'no-store',
      );

      expect(result).not.toHaveProperty('passwordHash');
    });
  });
});
