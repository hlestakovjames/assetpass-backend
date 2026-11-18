import { Body, Controller, HttpCode, HttpStatus, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthenticatedIdentity } from '../auth/auth.service';
import { BrowserOriginGuard } from '../auth/guards/browser-origin.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OrganizationFirstApplicationInput, OrganizationOnboardingService } from './organization-onboarding.service';

type AuthenticatedRequest = Request & { user: AuthenticatedIdentity };

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
  claimAvailable(@Req() request: AuthenticatedRequest) {
    return this.service.claimAvailable(request.user.id);
  }

  @Post(':organizationId/claim')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, BrowserOriginGuard)
  claim(@Param('organizationId') organizationId: string, @Req() request: AuthenticatedRequest) {
    return this.service.claim(organizationId, request.user.id);
  }
}
