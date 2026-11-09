import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthenticatedIdentity } from '../auth/auth.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RequirePlatformPermission } from '../access-control/platform-permission.decorator';
import { PlatformPermissionGuard } from '../access-control/platform-permission.guard';
import { AssetsService, type CreateAssetRegistrationInput, type ReviewAssetRegistrationInput } from './assets.service';
import { EvidenceStorageService } from './evidence-storage.service';

type AuthenticatedRequest = Request & { user: AuthenticatedIdentity };

@Controller('assets')
@UseGuards(JwtAuthGuard)
export class AssetsController {
  constructor(private readonly service: AssetsService, private readonly evidenceStorage: EvidenceStorageService) {}

  @Post('evidence/uploads')
  createEvidenceUpload(@Req() request: AuthenticatedRequest, @Body() body: { fileName: string; contentType: string; sizeBytes: number }) {
    return this.evidenceStorage.createUpload(request.user.id, body);
  }

  @Post('evidence/uploads/:uploadId/complete')
  completeEvidenceUpload(@Req() request: AuthenticatedRequest, @Param('uploadId') uploadId: string) {
    return this.evidenceStorage.completeUpload(request.user.id, uploadId);
  }

  @Get('evidence/uploads/:uploadId/download')
  downloadEvidence(@Req() request: AuthenticatedRequest, @Param('uploadId') uploadId: string) {
    return this.evidenceStorage.createDownloadUrl(request.user.id, uploadId);
  }

  @Post('registrations/individual')
  createIndividual(@Req() request: AuthenticatedRequest, @Body() body: CreateAssetRegistrationInput) {
    return this.service.createIndividualRegistration(request.user.id, body);
  }

  @Get('registrations/mine')
  listMine(@Req() request: AuthenticatedRequest) {
    return this.service.listMine(request.user.id);
  }

  @Get('registrations/platform-review')
  @UseGuards(PlatformPermissionGuard)
  @RequirePlatformPermission('platform.assets.review')
  listPlatformReview() {
    return this.service.listIndividualRegistrations();
  }

  @Post('registrations/:applicationId/platform-review')
  @UseGuards(PlatformPermissionGuard)
  @RequirePlatformPermission('platform.assets.review')
  reviewIndividual(
    @Req() request: AuthenticatedRequest,
    @Param('applicationId') applicationId: string,
    @Body() body: ReviewAssetRegistrationInput,
  ) {
    return this.service.reviewIndividualRegistration(request.user.id, applicationId, body);
  }
}