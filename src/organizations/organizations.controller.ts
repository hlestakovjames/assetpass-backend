import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthenticatedIdentity } from '../auth/auth.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OrganizationsService } from './organizations.service';
import type { RegisterOrganizationInput } from './organizations.service';

type AuthenticatedRequest = Request & { user: AuthenticatedIdentity };

@Controller('organizations')
@UseGuards(JwtAuthGuard)
export class OrganizationsController {
  constructor(private readonly service: OrganizationsService) {}
  @Post() register(@Req() request: AuthenticatedRequest, @Body() body: RegisterOrganizationInput) {
    return this.service.register(request.user.id, body);
  }
  @Get('mine') findMine(@Req() request: AuthenticatedRequest) {
    return this.service.findMine(request.user.id);
  }
}
