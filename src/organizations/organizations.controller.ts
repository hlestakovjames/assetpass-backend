import { Body, Controller, Get, Param, Patch, Post, Put, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthenticatedIdentity } from '../auth/auth.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CookieCsrfGuard } from '../auth/guards/cookie-csrf.guard';
import { ApplicationEntitlementsService } from '../auth/application-entitlements.service';
import { OrganizationsService, type InviteOrganizationMemberInput, type RegisterOrganizationInput } from './organizations.service';
import { OrganizationMembershipStatus } from './entities/organization-membership.entity';

type AuthenticatedRequest = Request & { user: AuthenticatedIdentity };

@Controller('organizations')
@UseGuards(JwtAuthGuard)
export class OrganizationsController {
  constructor(
    private readonly service: OrganizationsService,
    private readonly applicationEntitlements: ApplicationEntitlementsService,
  ) {}

  @Post()
  register(@Req() request: AuthenticatedRequest, @Body() body: RegisterOrganizationInput) {
    return this.service.register(request.user.id, body);
  }

  @Get('mine')
  findMine(@Req() request: AuthenticatedRequest) {
    return this.service.findMine(request.user.id);
  }

  @Get(':organizationId')
  getWorkspace(@Req() request: AuthenticatedRequest, @Param('organizationId') organizationId: string) {
    return this.service.getWorkspace(request.user.id, organizationId);
  }

  @Get(':organizationId/members')
  listMembers(@Req() request: AuthenticatedRequest, @Param('organizationId') organizationId: string) {
    return this.service.listMembers(request.user.id, organizationId);
  }

  @Get(':organizationId/members/:membershipId/history')
  getMembershipHistory(
    @Req() request: AuthenticatedRequest,
    @Param('organizationId') organizationId: string,
    @Param('membershipId') membershipId: string,
  ) {
    return this.service.getMembershipHistory(request.user.id, organizationId, membershipId);
  }

  @Post(':organizationId/invitations')
  inviteMember(
    @Req() request: AuthenticatedRequest,
    @Param('organizationId') organizationId: string,
    @Body() body: InviteOrganizationMemberInput,
  ) {
    return this.service.inviteMember(request.user.id, organizationId, body);
  }

  @Post(':organizationId/members/:membershipId/accept')
  acceptInvitation(
    @Req() request: AuthenticatedRequest,
    @Param('organizationId') organizationId: string,
    @Param('membershipId') membershipId: string,
  ) {
    return this.service.acceptInvitation(request.user.id, organizationId, membershipId);
  }

  @Patch(':organizationId/members/:membershipId/status')
  changeMemberStatus(
    @Req() request: AuthenticatedRequest,
    @Param('organizationId') organizationId: string,
    @Param('membershipId') membershipId: string,
    @Body() body: { status: OrganizationMembershipStatus },
  ) {
    return this.service.changeMemberStatus(request.user.id, organizationId, membershipId, body?.status);
  }


  @Get(':organizationId/application-entitlements')
  getApplicationEntitlements(
    @Req() request: AuthenticatedRequest,
    @Param('organizationId') organizationId: string,
  ) {
    return this.applicationEntitlements.getOrganizationEntitlements(
      request.user.id,
      organizationId,
    );
  }

  @Post(':organizationId/application-entitlements/marketplace/opt-in')
  @UseGuards(CookieCsrfGuard)
  optInMarketplace(
    @Req() request: AuthenticatedRequest,
    @Param('organizationId') organizationId: string,
  ) {
    return this.applicationEntitlements.optInOrganizationMarketplace(
      request.user.id,
      organizationId,
    );
  }

  @Post(':organizationId/application-entitlements/marketplace/revoke')
  @UseGuards(CookieCsrfGuard)
  revokeMarketplace(
    @Req() request: AuthenticatedRequest,
    @Param('organizationId') organizationId: string,
    @Body() body: { reason?: unknown },
  ) {
    return this.applicationEntitlements.revokeOrganizationMarketplace(
      request.user.id,
      organizationId,
      body?.reason,
    );
  }

  @Post(':organizationId/marketplace/representatives')
  @UseGuards(CookieCsrfGuard)
  grantMarketplaceRepresentative(
    @Req() request: AuthenticatedRequest,
    @Param('organizationId') organizationId: string,
    @Body() body: {
      userId?: unknown;
      authorityBasis?: unknown;
      authorityReference?: unknown;
      effectiveAt?: unknown;
      expiresAt?: unknown;
    },
  ) {
    return this.applicationEntitlements.grantOrganizationRepresentative(
      request.user.id,
      organizationId,
      body,
    );
  }

  @Post(':organizationId/marketplace/representatives/:grantId/revoke')
  @UseGuards(CookieCsrfGuard)
  revokeMarketplaceRepresentative(
    @Req() request: AuthenticatedRequest,
    @Param('organizationId') organizationId: string,
    @Param('grantId') grantId: string,
    @Body() body: { reason?: unknown },
  ) {
    return this.applicationEntitlements.revokeOrganizationRepresentative(
      request.user.id,
      organizationId,
      grantId,
      body?.reason,
    );
  }

  @Put(':organizationId/members/:membershipId/role')
  changeMemberRole(
    @Req() request: AuthenticatedRequest,
    @Param('organizationId') organizationId: string,
    @Param('membershipId') membershipId: string,
    @Body() body: { roleKey: string },
  ) {
    return this.service.changeMemberRole(request.user.id, organizationId, membershipId, body?.roleKey);
  }
}
