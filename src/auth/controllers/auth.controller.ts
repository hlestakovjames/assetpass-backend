import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';

import { AuthenticatedIdentity, AuthService } from '../auth.service';
import { IdentityResolutionService } from '../identity-resolution.service';
import { RegistrationService } from '../registration.service';
import { PasswordRecoveryService } from '../password-recovery.service';
import { ApplicationEntitlementsService } from '../application-entitlements.service';
import { AccessTokenService } from '../access-token.service';
import { RefreshTokenService } from '../refresh-token.service';
import { LoginDto } from '../dto/login.dto';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { BrowserOriginGuard } from '../guards/browser-origin.guard';
import { CookieCsrfGuard } from '../guards/cookie-csrf.guard';
import { AuthCookies } from '../utils/auth-cookies';

type AuthenticatedRequest = Request & {
  user: AuthenticatedIdentity;
  cookies?: Record<string, string>;
};

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly accessTokenService: AccessTokenService,
    private readonly refreshTokenService: RefreshTokenService,
    private readonly authCookies: AuthCookies,
    private readonly config: ConfigService,
    private readonly registrationService: RegistrationService,
    private readonly passwordRecovery: PasswordRecoveryService,
    private readonly applicationEntitlements: ApplicationEntitlementsService,
    private readonly identityResolution: IdentityResolutionService,
  ) {}

  private getSessionMetadata(request: Request) {
    return {
      sourceIp: request.ip ?? null,
      userAgent: request.headers['user-agent'] ?? null,
    };
  }

  private getPasswordRecoveryMetadata(request: Request) {
    const metadata = this.getSessionMetadata(request);
    // Do not treat a hosting-proxy address as the real client IP. Enable IP
    // throttling only when a trusted proxy chain is explicitly configured.
    return {
      ...metadata,
      sourceIp:
        process.env.NODE_ENV !== 'production' ||
        Number(process.env.TRUST_PROXY_HOPS ?? 0) > 0
          ? metadata.sourceIp
          : null,
      clientOrigin: request.headers.origin ?? null,
    };
  }

  private getRefreshToken(request: AuthenticatedRequest): string {
    const token = request.cookies?.[this.authCookies.refreshCookieName];
    if (typeof token !== 'string' || token.length === 0) {
      throw new UnauthorizedException('Invalid or expired refresh token.');
    }
    return token;
  }

  @Get('csrf')
  @UseGuards(BrowserOriginGuard)
  getCsrfToken(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    let csrfToken = request.cookies?.[this.authCookies.csrfCookieName];
    if (!this.authCookies.isValidCsrfToken(csrfToken)) {
      csrfToken = this.authCookies.createCsrfToken();
      this.authCookies.setCsrfCookie(response, csrfToken);
    }
    response.setHeader('Cache-Control', 'no-store');
    return { csrfToken };
  }

  @Post('register')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseGuards(BrowserOriginGuard)
  register(@Body() body: Parameters<RegistrationService['register']>[0]) {
    return this.registrationService.register(body);
  }

  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  @UseGuards(BrowserOriginGuard)
  verifyEmail(@Body() body: { token: string }) {
    return this.registrationService.verify(body?.token);
  }

  @Post('resend-verification')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseGuards(BrowserOriginGuard)
  resendVerification(@Body() body: { email: string }) {
    return this.registrationService.resend(body?.email);
  }

  @Post('password-reset/request')
  @Header('Cache-Control', 'no-store')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseGuards(BrowserOriginGuard)
  requestPasswordReset(
    @Body() body: { email?: unknown },
    @Req() request: Request,
  ) {
    return this.passwordRecovery.requestPasswordReset(
      body?.email,
      this.getPasswordRecoveryMetadata(request),
    );
  }

  @Post('password-reset/confirm')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(BrowserOriginGuard)
  async confirmPasswordReset(
    @Body() body: { token?: unknown; newPassword?: unknown },
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.passwordRecovery.resetPassword(
      body?.token,
      body?.newPassword,
      this.getPasswordRecoveryMetadata(request),
    );
    this.authCookies.clearAuthCookies(response);
    response.setHeader('Cache-Control', 'no-store');
  }

  @Post('change-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard, CookieCsrfGuard)
  async changePassword(
    @Body() body: { currentPassword?: unknown; newPassword?: unknown },
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.passwordRecovery.changePassword(
      request.user.id,
      body?.currentPassword,
      body?.newPassword,
      this.getPasswordRecoveryMetadata(request),
    );
    this.authCookies.clearAuthCookies(response);
    response.setHeader('Cache-Control', 'no-store');
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @UseGuards(BrowserOriginGuard)
  async login(
    @Body() body: LoginDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    if (
      !body ||
      typeof body.email !== 'string' ||
      typeof body.password !== 'string' ||
      body.email.length > 320 ||
      body.password.length === 0 ||
      body.password.length > 1024
    ) {
      throw new BadRequestException('Invalid login request.');
    }

    const user = await this.authService.validateCredentials(body.email, body.password);
    const session = await this.refreshTokenService.createSession(
      user.id,
      this.getPasswordRecoveryMetadata(request),
    );
    const identity = await this.identityResolution.resolve(user, session.sessionId);
    const accessToken = await this.accessTokenService.issueAccessToken(
      user.id,
      session.sessionId,
    );
    const csrfToken = this.authCookies.createCsrfToken();
    this.authCookies.setAuthCookies(response, session.refreshToken, csrfToken);
    response.setHeader('Cache-Control', 'no-store');

    return {
      accessToken,
      tokenType: 'Bearer',
      expiresIn: this.authCookies.getAccessTokenTtlSeconds(),
      user: identity,
    };
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CookieCsrfGuard)
  async refresh(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    const refreshToken = this.getRefreshToken(request);
    try {
      const rotated = await this.refreshTokenService.rotate(
        refreshToken,
        this.getPasswordRecoveryMetadata(request),
      );
      const accessToken = await this.accessTokenService.issueAccessToken(
        rotated.user.id,
        rotated.sessionId,
      );
      this.authCookies.setAuthCookies(
        response,
        rotated.refreshToken,
        request.cookies?.[this.authCookies.csrfCookieName] ?? '',
      );
      response.setHeader('Cache-Control', 'no-store');
      return { accessToken, tokenType: 'Bearer', expiresIn: this.authCookies.getAccessTokenTtlSeconds() };
    } catch (error) {
      this.authCookies.clearAuthCookies(response);
      throw error;
    }
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(CookieCsrfGuard)
  async logout(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    const refreshToken = request.cookies?.[this.authCookies.refreshCookieName];
    if (typeof refreshToken === 'string') await this.refreshTokenService.revoke(refreshToken);
    this.authCookies.clearAuthCookies(response);
  }

  @Post('logout-all')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard, BrowserOriginGuard)
  async logoutAll(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.refreshTokenService.revokeAllForUser(request.user.id);
    this.authCookies.clearAuthCookies(response);
  }


  @Get('application-entitlements')
  @UseGuards(JwtAuthGuard)
  getApplicationEntitlements(@Req() request: AuthenticatedRequest) {
    return this.applicationEntitlements.getUserEntitlements(request.user.id);
  }

  @Post('application-entitlements/marketplace/opt-in')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, CookieCsrfGuard)
  optInMarketplace(
    @Req() request: AuthenticatedRequest,
    @Body() body: { acknowledgementAccepted?: unknown },
  ) {
    return this.applicationEntitlements.optInIndividualMarketplace(
      request.user.id,
      body?.acknowledgementAccepted,
    );
  }

  @Post('application-entitlements/marketplace/revoke')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, CookieCsrfGuard)
  revokeMarketplace(
    @Req() request: AuthenticatedRequest,
    @Body() body: { reason?: unknown },
  ) {
    return this.applicationEntitlements.revokeIndividualMarketplace(
      request.user.id,
      body?.reason,
    );
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  getCurrentUser(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader('Cache-Control', 'no-store');
    return this.identityResolution.resolve(request.user, request.user.sessionId);
  }
}
