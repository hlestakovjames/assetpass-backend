import { DataSource, EntityManager } from 'typeorm';
import { PlatformAuditLog } from '../audit/entities/platform-audit-log.entity';
import { IndividualWorkspaceService } from './individual-workspace.service';

describe('IndividualWorkspaceService', () => {
  let service: IndividualWorkspaceService;
  let query: jest.Mock;
  let saveAudit: jest.Mock;
  let transaction: jest.Mock;

  beforeEach(() => {
    query = jest.fn();
    saveAudit = jest.fn().mockResolvedValue({});
    const manager = {
      query,
      getRepository: jest.fn().mockReturnValue({ save: saveAudit }),
    } as unknown as EntityManager;
    transaction = jest.fn((callback: (manager: EntityManager) => unknown) =>
      callback(manager),
    );
    service = new IndividualWorkspaceService({
      transaction,
    } as unknown as DataSource);
  });

  it('activates a workspace idempotently and records an audit event', async () => {
    query.mockResolvedValueOnce([{
      id: 'workspace-1',
      user_id: 'user-1',
      status: 'active',
      activated_at: new Date('2026-11-18T10:00:00.000Z'),
      deactivated_at: null,
    }]);

    const result = await service.activate('user-1', {
      sourceIp: '127.0.0.1',
      userAgent: 'AssetPass test',
    });

    expect(result).toMatchObject({
      id: 'workspace-1',
      userId: 'user-1',
      status: 'active',
      deactivatedAt: null,
    });
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('ON CONFLICT (user_id) DO UPDATE'),
      ['user-1'],
    );
    expect(saveAudit).toHaveBeenCalledWith(expect.objectContaining({
      actorUserId: 'user-1',
      action: 'workspace.individual.activated',
      entityType: 'individual_workspace',
      entityId: 'workspace-1',
      outcome: 'success',
      sourceIp: '127.0.0.1',
    }));
    expect(transaction).toHaveBeenCalledTimes(1);
  });

  it('deactivates a workspace without deleting its record and records an audit event', async () => {
    query.mockResolvedValueOnce([{
      id: 'workspace-1',
      user_id: 'user-1',
      status: 'inactive',
      activated_at: new Date('2026-11-18T10:00:00.000Z'),
      deactivated_at: new Date('2026-11-18T11:00:00.000Z'),
    }]);

    const result = await service.deactivate('user-1');

    expect(result).toMatchObject({
      id: 'workspace-1',
      userId: 'user-1',
      status: 'inactive',
    });
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("VALUES ($1, 'inactive', NULL, NOW())"),
      ['user-1'],
    );
    expect(saveAudit).toHaveBeenCalledWith(expect.objectContaining({
      actorUserId: 'user-1',
      action: 'workspace.individual.deactivated',
      entityType: 'individual_workspace',
      entityId: 'workspace-1',
      outcome: 'success',
    }));
  });
});
