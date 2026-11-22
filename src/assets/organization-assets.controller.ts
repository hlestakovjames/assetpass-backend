import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthenticatedIdentity } from '../auth/auth.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AssetsService, type CreateAssetRegistrationInput, type ReviewAssetRegistrationInput } from './assets.service';
import { EvidenceStorageService } from './evidence-storage.service';

type AuthenticatedRequest = Request & { user: AuthenticatedIdentity };

@Controller('organizations/:organizationId/assets')
@UseGuards(JwtAuthGuard)
export class OrganizationAssetsController {
  constructor(private readonly service: AssetsService, private readonly evidenceStorage: EvidenceStorageService) {}

  @Post('evidence/uploads')
  createEvidenceUpload(
    @Req() request: AuthenticatedRequest,
    @Param('organizationId') organizationId: string,
    @Body() body: { fileName: string; contentType: string; sizeBytes: number },
  ) {
    return this.evidenceStorage.createUpload(request.user.id, body, organizationId);
  }

  @Post('evidence/uploads/:uploadId/complete')
  completeEvidenceUpload(
    @Req() request: AuthenticatedRequest,
    @Param('organizationId') organizationId: string,
    @Param('uploadId') uploadId: string,
  ) {
    return this.evidenceStorage.completeUpload(request.user.id, uploadId, organizationId);
  }

  @Get('evidence/uploads/:uploadId/download')
  downloadEvidence(
    @Req() request: AuthenticatedRequest,
    @Param('organizationId') organizationId: string,
    @Param('uploadId') uploadId: string,
  ) {
    return this.evidenceStorage.createDownloadUrl(request.user.id, uploadId, organizationId);
  }

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