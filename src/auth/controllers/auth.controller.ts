import {
  BadRequestException,
  Body,
  Controller,
  Get,
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
import { RegistrationService } from '../registration.service';
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
  ) {}

  private getSessionMetadata(request: Request) {
    return {
      sourceIp: request.ip ?? null,
      userAgent: request.headers['user-agent'] ?? null,
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
  register(@Body() body: { fullName: string; email: string; password: string }) {
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
      this.getSessionMetadata(request),
    );
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
      user: {
        id: user.id,
        fullName: user.fullName,
        email: user.email,
        status: user.status,
      },
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
        this.getSessionMetadata(request),
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

  @Get('me')
  @UseGuards(JwtAuthGuard)
  getCurrentUser(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader('Cache-Control', 'no-store');
    return {
      id: request.user.id,
      fullName: request.user.fullName,
      email: request.user.email,
      status: request.user.status,
    };
  }
}
