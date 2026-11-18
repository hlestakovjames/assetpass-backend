import { BadRequestException, Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthenticatedIdentity } from '../auth/auth.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { WorkspaceContextService, WorkspaceContextType } from './workspace-context.service';

type AuthenticatedRequest = Request & { user: AuthenticatedIdentity & { sessionId?: string } };

@Controller('workspaces/context')
@UseGuards(JwtAuthGuard)
export class WorkspaceContextController {
  constructor(private readonly contexts: WorkspaceContextService) {}

  @Post('select')
  select(
    @Req() request: AuthenticatedRequest,
    @Body() body: { contextType?: unknown; contextId?: unknown },
  ) {
    const types: WorkspaceContextType[] = ['platform', 'individual', 'organization'];
    if (!request.user.sessionId || !body || !types.includes(body.contextType as WorkspaceContextType)) {
      throw new BadRequestException('Invalid workspace context selection.');
    }
    const contextType = body.contextType as WorkspaceContextType;
    const contextId = body.contextId === undefined ? null : body.contextId;
    if ((contextType === 'platform' && contextId !== null) ||
        (contextType !== 'platform' && (typeof contextId !== 'string' ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(contextId)))) {
      throw new BadRequestException('Invalid workspace context identifier.');
    }
    return this.contexts.select(
      request.user.id,
      request.user.sessionId,
      contextType,
      contextId as string | null,
      { sourceIp: request.ip ?? null, userAgent: request.headers['user-agent'] ?? null },
    );
  }
}
