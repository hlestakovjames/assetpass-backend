import { Controller, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthenticatedIdentity } from '../auth/auth.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { IndividualWorkspaceService } from './individual-workspace.service';

type AuthenticatedRequest = Request & { user: AuthenticatedIdentity };

@Controller('workspaces/individual')
@UseGuards(JwtAuthGuard)
export class IndividualWorkspaceController {
  constructor(private readonly workspaces: IndividualWorkspaceService) {}

  @Post('activate')
  activate(@Req() request: AuthenticatedRequest) {
    return this.workspaces.activate(request.user.id, requestMetadata(request));
  }

  @Post('deactivate')
  deactivate(@Req() request: AuthenticatedRequest) {
    return this.workspaces.deactivate(request.user.id, requestMetadata(request));
  }
}

function requestMetadata(request: Request) {
  return {
    sourceIp: request.ip ?? null,
    userAgent: request.headers['user-agent'] ?? null,
  };
}
