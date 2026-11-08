import {
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'node:crypto';

import { CookieCsrfGuard } from './cookie-csrf.guard';

describe('CookieCsrfGuard', () => {
  let guard: CookieCsrfGuard;

  const trustedOrigin = 'http://localhost:3000';

  const validToken = randomBytes(32).toString('base64url');

  const createContext = (
    options: {
      origin?: string;
      cookieToken?: string;
      headerToken?: string;
    } = {},
  ) => {
    const request = {
      headers: {
        ...(options.origin === undefined
          ? {}
          : { origin: options.origin }),
        ...(options.headerToken === undefined
          ? {}
          : { 'x-csrf-token': options.headerToken }),
      },
      cookies:
        options.cookieToken === undefined
          ? {}
          : { assetpass_csrf: options.cookieToken },
    };

    return {
      switchToHttp: () => ({
        getRequest: () => request,
      }),
    } as unknown as ExecutionContext;
  };

  beforeEach(() => {
    const config = {
      get: jest.fn((key: string) =>
        key === 'TRUSTED_ORIGINS'
          ? trustedOrigin
          : undefined,
      ),
      getOrThrow: jest.fn().mockReturnValue(trustedOrigin),
    } as unknown as ConfigService;

    guard = new CookieCsrfGuard(config);
  });

  it('allows a trusted origin with matching CSRF tokens', () => {
    expect(
      guard.canActivate(
        createContext({
          origin: trustedOrigin,
          cookieToken: validToken,
          headerToken: validToken,
        }),
      ),
    ).toBe(true);
  });

  it('rejects a missing Origin header', () => {
    expect(() =>
      guard.canActivate(
        createContext({
          cookieToken: validToken,
          headerToken: validToken,
        }),
      ),
    ).toThrow(ForbiddenException);
  });

  it('rejects an untrusted Origin header', () => {
    expect(() =>
      guard.canActivate(
        createContext({
          origin: 'https://attacker.example',
          cookieToken: validToken,
          headerToken: validToken,
        }),
      ),
    ).toThrow(ForbiddenException);
  });

  it('rejects a missing CSRF cookie', () => {
    expect(() =>
      guard.canActivate(
        createContext({
          origin: trustedOrigin,
          headerToken: validToken,
        }),
      ),
    ).toThrow(ForbiddenException);
  });

  it('rejects a missing CSRF header', () => {
    expect(() =>
      guard.canActivate(
        createContext({
          origin: trustedOrigin,
          cookieToken: validToken,
        }),
      ),
    ).toThrow(ForbiddenException);
  });

  it('rejects mismatched CSRF tokens', () => {
    expect(() =>
      guard.canActivate(
        createContext({
          origin: trustedOrigin,
          cookieToken: validToken,
          headerToken: randomBytes(32).toString('base64url'),
        }),
      ),
    ).toThrow(ForbiddenException);
  });

  it.each([
    '',
    'short',
    'a'.repeat(42),
    'a'.repeat(44),
    '!'.repeat(43),
  ])('rejects malformed CSRF token: %s', (token) => {
    expect(() =>
      guard.canActivate(
        createContext({
          origin: trustedOrigin,
          cookieToken: token,
          headerToken: token,
        }),
      ),
    ).toThrow(ForbiddenException);
  });
});
