import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { IndividualWorkspaceActiveGuard } from './individual-workspace-active.guard';

describe('IndividualWorkspaceActiveGuard', () => {
  let guard: IndividualWorkspaceActiveGuard;
  let query: jest.Mock;

  const context = (userId?: string) => ({
    switchToHttp: () => ({
      getRequest: () => userId ? { user: { id: userId } } : {},
    }),
  }) as unknown as ExecutionContext;

  beforeEach(() => {
    query = jest.fn();
    guard = new IndividualWorkspaceActiveGuard({ query } as unknown as DataSource);
  });

  it('allows an account with an active Individual Workspace', async () => {
    query.mockResolvedValueOnce([{ id: 'workspace-1' }]);

    await expect(guard.canActivate(context('user-1'))).resolves.toBe(true);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("status = 'active'"),
      ['user-1'],
    );
  });

  it('denies an account without an active Individual Workspace', async () => {
    query.mockResolvedValueOnce([]);

    await expect(guard.canActivate(context('user-1'))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('denies a request without an authenticated identity', async () => {
    await expect(guard.canActivate(context())).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(query).not.toHaveBeenCalled();
  });
});
