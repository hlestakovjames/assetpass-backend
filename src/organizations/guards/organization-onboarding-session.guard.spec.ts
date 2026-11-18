import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { OrganizationOnboardingSessionGuard } from './organization-onboarding-session.guard';

describe('OrganizationOnboardingSessionGuard', () => {
  function setup(session: unknown = null) {
    const query = { addSelect: jest.fn().mockReturnThis(), where: jest.fn().mockReturnThis(), andWhere: jest.fn().mockReturnThis(), getOne: jest.fn().mockResolvedValue(session) };
    const sessions = { createQueryBuilder: jest.fn().mockReturnValue(query), update: jest.fn() };
    const request: Record<string, unknown> = { headers: { 'x-organization-onboarding-session': 's'.repeat(43) } };
    const context = { switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext;
    return { guard: new OrganizationOnboardingSessionGuard(sessions as never), sessions, query, request, context };
  }

  it('rejects requests without a session token', async () => {
    const { guard, request, context } = setup();
    (request.headers as Record<string, string>)['x-organization-onboarding-session'] = '';
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('hashes the bearer token and attaches only the restricted application context', async () => {
    const session = { id: 'session-1', applicationId: 'application-1', scopes: ['application.read'] };
    const { guard, sessions, query, request, context } = setup(session);
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(query.where).toHaveBeenCalledWith('session.tokenHash = :tokenHash', {
      tokenHash: createHash('sha256').update('s'.repeat(43)).digest('hex'),
    });
    expect(sessions.update).toHaveBeenCalledWith(expect.objectContaining({ id: 'session-1' }), expect.objectContaining({ lastSeenAt: expect.any(Date) }));
    expect(request.organizationOnboarding).toEqual({ sessionId: 'session-1', applicationId: 'application-1', scopes: ['application.read'] });
  });

  it('rejects expired, idle or revoked sessions', async () => {
    const { guard, context } = setup(null);
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
