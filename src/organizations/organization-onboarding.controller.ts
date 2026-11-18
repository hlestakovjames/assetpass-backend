import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthenticatedIdentity } from '../auth/auth.service';
import { BrowserOriginGuard } from '../auth/guards/browser-origin.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OrganizationOnboardingSessionGuard } from './guards/organization-onboarding-session.guard';
import { OrganizationOnboardingService } from './organization-onboarding.service';
import type { OrganizationFirstApplicationInput } from './organization-onboarding.service';

type AuthenticatedRequest = Request & { user: AuthenticatedIdentity };
type OnboardingSessionRequest = Request & { organizationOnboarding: { sessionId: string; applicationId: string; scopes: string[] } };

@Controller('organizations/onboarding')
export class OrganizationOnboardingController {
  constructor(private readonly service: OrganizationOnboardingService) {}

  @Post('applications')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseGuards(BrowserOriginGuard)
  submit(@Body() body: OrganizationFirstApplicationInput) {
    return this.service.submit(body);
  }

  @Post('resend-verification')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseGuards(BrowserOriginGuard)
  resend(@Body() body: { representativeEmail: string }) {
    return this.service.resendVerification(body?.representativeEmail);
  }

  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  @UseGuards(BrowserOriginGuard)
  verify(@Body() body: { token: string }) {
    return this.service.verify(body?.token);
  }

  @Post('claim')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, BrowserOriginGuard)
  claim(@Req() request: AuthenticatedRequest, @Body() body: { claimToken: string }) {
    return this.service.claimWithToken(request.user.id, body?.claimToken);
  }

  @Get('session')
  @UseGuards(OrganizationOnboardingSessionGuard)
  session(@Req() request: OnboardingSessionRequest) {
    return this.service.getOnboardingSession(request.organizationOnboarding.applicationId);
  }

  @Post('session/close')
  @HttpCode(HttpStatus.OK)
  @UseGuards(BrowserOriginGuard, OrganizationOnboardingSessionGuard)
  closeSession(@Req() request: OnboardingSessionRequest) {
    return this.service.closeOnboardingSession(request.organizationOnboarding.sessionId);
  }
}
