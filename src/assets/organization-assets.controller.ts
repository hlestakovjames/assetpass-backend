import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthenticatedIdentity } from '../auth/auth.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AssetsService, type CreateAssetRegistrationInput, type ReviewAssetRegistrationInput } from './assets.service';

type AuthenticatedRequest = Request & { user: AuthenticatedIdentity };

@Controller('organizations/:organizationId/assets')
@UseGuards(JwtAuthGuard)
export class OrganizationAssetsController {
  constructor(private readonly service: AssetsService) {}

  @Post('registrations')
  create(
    @Req() request: AuthenticatedRequest,
    @Param('organizationId') organizationId: string,
    @Body() body: CreateAssetRegistrationInput,
  ) {
    return this.service.createOrganizationRegistration(request.user.id, organizationId, body);
  }

  @Get('registrations')
  list(
    @Req() request: AuthenticatedRequest,
    @Param('organizationId') organizationId: string,
  ) {
    return this.service.listOrganizationRegistrations(request.user.id, organizationId);
  }

  @Post('registrations/:applicationId/review')
  review(
    @Req() request: AuthenticatedRequest,
    @Param('organizationId') organizationId: string,
    @Param('applicationId') applicationId: string,
    @Body() body: ReviewAssetRegistrationInput,
  ) {
    return this.service.reviewOrganizationRegistration(request.user.id, organizationId, applicationId, body);
  }
}