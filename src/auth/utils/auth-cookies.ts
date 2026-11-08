import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'node:crypto';
import { CookieOptions, Response } from 'express';

@Injectable()
export class AuthCookies {
  private readonly secure: boolean;
  private readonly ttlMilliseconds: number;

  constructor(private readonly config: ConfigService) {
    this.secure =
      this.config.get<string>('NODE_ENV') === 'production';

    const ttlDays =
      this.config.getOrThrow<number>('REFRESH_TOKEN_TTL_DAYS');

    this.ttlMilliseconds =
      ttlDays * 24 * 60 * 60 * 1000;
  }

  get refreshCookieName(): string {
    return this.secure
      ? '__Secure-assetpass_refresh'
      : 'assetpass_refresh';
  }

  get csrfCookieName(): string {
    return 'assetpass_csrf';
  }

  get refreshCookieOptions(): CookieOptions {
    return {
      httpOnly: true,
      secure: this.secure,
      sameSite: 'lax',
      path: '/api/v1/auth',
      maxAge: this.ttlMilliseconds,
    };
  }

  get csrfCookieOptions(): CookieOptions {
    return {
      httpOnly: false,
      secure: this.secure,
      sameSite: 'lax',
      path: '/api/v1/auth',
      maxAge: this.ttlMilliseconds,
    };
  }

  createCsrfToken(): string {
    return randomBytes(32).toString('base64url');
  }

  isValidCsrfToken(token: unknown): token is string {
    return (
      typeof token === 'string' &&
      /^[A-Za-z0-9_-]{43}$/.test(token)
    );
  }

  setCsrfCookie(response: Response, csrfToken: string): void {
    response.cookie(
      this.csrfCookieName,
      csrfToken,
      this.csrfCookieOptions,
    );
  }

  setAuthCookies(
    response: Response,
    refreshToken: string,
    csrfToken: string,
  ): void {
    response.cookie(
      this.refreshCookieName,
      refreshToken,
      this.refreshCookieOptions,
    );

    this.setCsrfCookie(response, csrfToken);
  }

  clearAuthCookies(response: Response): void {
    response.clearCookie(
      this.refreshCookieName,
      this.refreshCookieOptions,
    );

    response.clearCookie(
      this.csrfCookieName,
      this.csrfCookieOptions,
    );
  }

  getAccessTokenTtlSeconds(): number {
    return this.config.getOrThrow<number>(
      'JWT_ACCESS_TTL_SECONDS',
    );
  }
}
