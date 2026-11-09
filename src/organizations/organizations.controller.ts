import { Body, Controller, Get, Param, Patch, Post, Put, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthenticatedIdentity } from '../auth/auth.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OrganizationsService, type InviteOrganizationMemberInput, type RegisterOrganizationInput } from './organizations.service';
import { OrganizationMembershipStatus } from './entities/organization-membership.entity';

type AuthenticatedRequest = Request & { user: AuthenticatedIdentity };

@Controller('organizations')
@UseGuards(JwtAuthGuard)
export class OrganizationsController {
  constructor(private readonly service: OrganizationsService) {}

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
