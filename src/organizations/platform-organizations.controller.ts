import { Body, Controller, Get, Param, Patch, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthenticatedIdentity } from '../auth/auth.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RequirePlatformPermission } from '../access-control/platform-permission.decorator';
import { PlatformPermissionGuard } from '../access-control/platform-permission.guard';
import { OrganizationStatus } from './entities/organization.entity';
import { OrganizationsService } from './organizations.service';

type AuthenticatedRequest = Request & { user: AuthenticatedIdentity };

@Controller('platform/organizations')
@UseGuards(JwtAuthGuard, PlatformPermissionGuard)
export class PlatformOrganizationsController {
  constructor(private readonly service: OrganizationsService) {}
  @Get() @RequirePlatformPermission('platform.organizations.read')
  list(@Query('status') status?: OrganizationStatus) { return this.service.list(status); }
  @Patch(':id/status') @RequirePlatformPermission('platform.organizations.review')
  review(@Param('id') id: string, @Req() request: AuthenticatedRequest, @Body() body: { status: OrganizationStatus; note?: string }) {
    return this.service.review(id, request.user.id, body.status, body.note);
  }
}
