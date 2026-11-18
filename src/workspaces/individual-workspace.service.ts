import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { PlatformAuditLog } from '../audit/entities/platform-audit-log.entity';
import { IndividualWorkspaceStatus } from './entities/individual-workspace.entity';

export type WorkspaceRequestMetadata = {
  sourceIp?: string | null;
  userAgent?: string | null;
};

type WorkspaceRow = {
  id: string;
  user_id: string;
  status: IndividualWorkspaceStatus;
  activated_at: Date | null;
  deactivated_at: Date | null;
};

@Injectable()
export class IndividualWorkspaceService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async activate(userId: string, metadata: WorkspaceRequestMetadata = {}) {
    return this.dataSource.transaction(async (manager) => {
      const rows = await manager.query<WorkspaceRow[]>(
        `INSERT INTO individual_workspaces
           (user_id, status, activated_at, deactivated_at)
         VALUES ($1, 'active', NOW(), NULL)
         ON CONFLICT (user_id) DO UPDATE
           SET status = 'active',
               activated_at = CASE
                 WHEN individual_workspaces.status = 'active'
                   THEN individual_workspaces.activated_at
                 ELSE NOW()
               END,
               deactivated_at = NULL,
               updated_at = NOW()
         RETURNING id, user_id, status, activated_at, deactivated_at`,
        [userId],
      );
      const workspace = rows[0];

      await manager.getRepository(PlatformAuditLog).save({
        actorUserId: userId,
        action: 'workspace.individual.activated',
        entityType: 'individual_workspace',
        entityId: workspace.id,
        outcome: 'success',
        reason: null,
        sourceIp: metadata.sourceIp ?? null,
        userAgent: metadata.userAgent ?? null,
        metadata: { workspaceStatus: workspace.status },
      });

      return toResponse(workspace);
    });
  }

  async deactivate(userId: string, metadata: WorkspaceRequestMetadata = {}) {
    return this.dataSource.transaction(async (manager) => {
      const rows = await manager.query<WorkspaceRow[]>(
        `INSERT INTO individual_workspaces
           (user_id, status, activated_at, deactivated_at)
         VALUES ($1, 'inactive', NULL, NOW())
         ON CONFLICT (user_id) DO UPDATE
           SET status = 'inactive',
               deactivated_at = NOW(),
               updated_at = NOW()
         RETURNING id, user_id, status, activated_at, deactivated_at`,
        [userId],
      );
      const workspace = rows[0];

      await manager.getRepository(PlatformAuditLog).save({
        actorUserId: userId,
        action: 'workspace.individual.deactivated',
        entityType: 'individual_workspace',
        entityId: workspace.id,
        outcome: 'success',
        reason: null,
        sourceIp: metadata.sourceIp ?? null,
        userAgent: metadata.userAgent ?? null,
        metadata: { workspaceStatus: workspace.status },
      });

      return toResponse(workspace);
    });
  }
}

function toResponse(row: WorkspaceRow) {
  return {
    id: row.id,
    userId: row.user_id,
    status: row.status,
    activatedAt: row.activated_at,
    deactivatedAt: row.deactivated_at,
  };
}
