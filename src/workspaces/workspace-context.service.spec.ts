import { ForbiddenException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { PlatformAuditLog } from '../audit/entities/platform-audit-log.entity';
import { WorkspaceContextService } from './workspace-context.service';

describe('WorkspaceContextService', () => {
  let service: WorkspaceContextService;
  let query: jest.Mock;
  let saveAudit: jest.Mock;

  beforeEach(() => {
    query = jest.fn();
    saveAudit = jest.fn().mockResolvedValue({});
    const manager = {
      query,
      getRepository: jest.fn((entity: unknown) =>
        entity === PlatformAuditLog ? { save: saveAudit } : undefined,
      ),
    } as unknown as EntityManager;
    service = new WorkspaceContextService({
      transaction: (callback: (manager: EntityManager) => unknown) => callback(manager),
    } as unknown as DataSource);
  });

  it('selects a workspace owned by the authenticated user and audits the change', async () => {
    query.mockResolvedValueOnce([{ ok: 1 }]).mockResolvedValueOnce([]);
    const result = await service.select(
      'user-1', 'session-1', 'individual', 'workspace-1',
      { sourceIp: '127.0.0.1', userAgent: 'AssetPass test' },
    );
    expect(result).toMatchObject({
      contextType: 'individual',
      contextId: 'workspace-1',
    });
    expect(query).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("user_id = $2 AND status = 'active'"),
      ['workspace-1', 'user-1'],
    );
    expect(query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('ON CONFLICT (session_id) DO UPDATE'),
      ['session-1', 'individual', 'workspace-1'],
    );
    expect(saveAudit).toHaveBeenCalledWith(expect.objectContaining({
      actorUserId: 'user-1',
      action: 'workspace.context.selected',
      entityId: 'session-1',
      outcome: 'success',
    }));
  });

  it('rejects a workspace the user cannot access without saving a selection', async () => {
    query.mockResolvedValueOnce([]);
    await expect(service.select(
      'user-1', 'session-1', 'organization', 'org-foreign',
    )).rejects.toThrow(ForbiddenException);
    expect(query).toHaveBeenCalledTimes(1);
    expect(saveAudit).not.toHaveBeenCalled();
  });

  it('validates platform authority before selecting platform administration', async () => {
    query.mockResolvedValueOnce([{ ok: 1 }]).mockResolvedValueOnce([]);
    const result = await service.select('user-1', 'session-1', 'platform', null);
    expect(result.contextType).toBe('platform');
    expect(query).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('FROM platform_roles'),
      ['user-1'],
    );
  });
});
