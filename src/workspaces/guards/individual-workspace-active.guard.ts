import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import type { AuthenticatedIdentity } from '../../auth/auth.service';

type AuthenticatedRequest = {
  user?: AuthenticatedIdentity;
};

@Injectable()
export class IndividualWorkspaceActiveGuard implements CanActivate {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const userId = request.user?.id;

    if (!userId) {
      throw new ForbiddenException('An authenticated account is required.');
    }

    const rows = await this.dataSource.query<Array<{ id: string }>>(
      `SELECT id
       FROM individual_workspaces
       WHERE user_id = $1 AND status = 'active'
       LIMIT 1`,
      [userId],
    );

    if (!rows.length) {
      throw new ForbiddenException(
        'An active Individual Workspace is required for this operation.',
      );
    }

    return true;
  }
}
