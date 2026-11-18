import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { PlatformAuditLog } from '../audit/entities/platform-audit-log.entity';

export type WorkspaceContextType = 'platform' | 'individual' | 'organization';

@Injectable()
export class WorkspaceContextService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async select(
    userId: string,
    sessionId: string,
    contextType: WorkspaceContextType,
    contextId: string | null,
    metadata: { sourceIp?: string | null; userAgent?: string | null } = {},
  ) {
    return this.dataSource.transaction(async (manager) => {
      let authorized = false;
      if (contextType === 'platform' && contextId === null) {
        const rows = await manager.query(
          `SELECT 1 FROM platform_roles
           WHERE user_id = $1 AND revoked_at IS NULL LIMIT 1`,
          [userId],
        );
        authorized = rows.length > 0;
      } else if (contextType === 'individual' && contextId) {
        const rows = await manager.query(
          `SELECT 1 FROM individual_workspaces
           WHERE id = $1 AND user_id = $2 AND status = 'active' LIMIT 1`,
          [contextId, userId],
        );
        authorized = rows.length > 0;
      } else if (contextType === 'organization' && contextId) {
        const rows = await manager.query(
          `SELECT 1
           FROM organization_memberships m
           INNER JOIN organizations o ON o.id = m.organization_id
           WHERE m.organization_id = $1 AND m.user_id = $2
             AND m.status = 'active' AND o.status = 'active'
           LIMIT 1`,
          [contextId, userId],
        );
        authorized = rows.length > 0;
      }

      if (!authorized) {
        throw new ForbiddenException('You do not have access to this workspace.');
      }

      await manager.query(
        `INSERT INTO auth_session_contexts (session_id, context_type, context_id, updated_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (session_id) DO UPDATE
           SET context_type = EXCLUDED.context_type,
               context_id = EXCLUDED.context_id,
               updated_at = NOW()`,
        [sessionId, contextType, contextId],
      );

      await manager.getRepository(PlatformAuditLog).save({
        actorUserId: userId,
        action: 'workspace.context.selected',
        entityType: 'auth_session',
        entityId: sessionId,
        outcome: 'success',
        reason: null,
        sourceIp: metadata.sourceIp ?? null,
        userAgent: metadata.userAgent ?? null,
        metadata: { contextType, contextId },
      });

      return { contextType, contextId, selectedAt: new Date().toISOString() };
    });
  }
}
