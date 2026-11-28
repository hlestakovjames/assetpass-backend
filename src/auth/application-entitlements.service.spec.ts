import { DataSource, EntityManager } from 'typeorm';
import { ApplicationEntitlementsService } from './application-entitlements.service';

describe('ApplicationEntitlementsService', () => {
  let service: ApplicationEntitlementsService;
  let manager: { query: jest.Mock };
  let dataSource: { query: jest.Mock; transaction: jest.Mock; manager: EntityManager };

  const userId = '9fed3a07-5a17-4b94-8437-552edeebf5a6';
  const organizationId = '5fed3a07-5a17-4b94-8437-552edeebf5a6';
  const grantId = '4fed3a07-5a17-4b94-8437-552edeebf5a6';
  const membershipId = '3fed3a07-5a17-4b94-8437-552edeebf5a6';
  const now = new Date('2026-11-28T10:00:00.000Z');

  beforeEach(() => {
    manager = { query: jest.fn() };
    dataSource = {
      query: jest.fn(),
      transaction: jest.fn(async (callback) => callback(manager)),
      manager: manager as unknown as EntityManager,
    };
    service = new ApplicationEntitlementsService(dataSource as unknown as DataSource);
  });

  it('returns independent App and Marketplace entitlement states', async () => {
    dataSource.query.mockResolvedValue([
      { application_key: 'assetpass_app', granted_at: now },
    ]);

    await expect(service.getUserEntitlements(userId)).resolves.toEqual({
      assetpassApp: { active: true, grantedAt: now },
      marketplace: { active: false, grantedAt: null },
    });
  });

  it('requires an approved active account before individual Marketplace opt-in', async () => {
    manager.query.mockResolvedValueOnce([]);

    await expect(service.optInIndividualMarketplace(userId))
      .rejects.toThrow('An approved, active account is required.');
    expect(manager.query).toHaveBeenCalledTimes(1);
  });

  it('creates an individual Marketplace entitlement and audit record', async () => {
    manager.query
      .mockResolvedValueOnce([{ id: userId }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: grantId, granted_at: now }])
      .mockResolvedValueOnce([]);

    await expect(service.optInIndividualMarketplace(userId)).resolves.toEqual({
      active: true,
      grantedAt: now,
    });
    expect(manager.query.mock.calls[2][0]).toContain('INSERT INTO user_application_entitlements');
    expect(manager.query.mock.calls[3][0]).toContain('INSERT INTO platform_audit_logs');
  });

  it('is idempotent when the individual Marketplace entitlement already exists', async () => {
    manager.query
      .mockResolvedValueOnce([{ id: userId }])
      .mockResolvedValueOnce([{ id: grantId, granted_at: now }]);

    await expect(service.optInIndividualMarketplace(userId)).resolves.toEqual({
      active: true,
      grantedAt: now,
    });
    expect(manager.query).toHaveBeenCalledTimes(2);
  });

  it('revokes only the individual Marketplace entitlement and requires a reason', async () => {
    await expect(service.revokeIndividualMarketplace(userId, '  '))
      .rejects.toThrow('A revocation reason of 1 to 1000 characters is required.');

    manager.query
      .mockResolvedValueOnce([{ id: userId }])
      .mockResolvedValueOnce([{ id: grantId }])
      .mockResolvedValueOnce([]);

    await expect(service.revokeIndividualMarketplace(userId, 'User opted out')).resolves.toEqual({
      active: false,
      revoked: true,
    });
    expect(manager.query.mock.calls[1][0]).toContain("application_key = 'marketplace'");
  });

  it('requires the organization Marketplace management permission to opt in', async () => {
    manager.query
      .mockResolvedValueOnce([{ id: organizationId }])
      .mockResolvedValueOnce([]);

    await expect(service.optInOrganizationMarketplace(userId, organizationId))
      .rejects.toThrow('Current organization membership and Marketplace management permission are required.');
  });

  it('creates an organization Marketplace entitlement after the scoped permission check', async () => {
    manager.query
      .mockResolvedValueOnce([{ id: organizationId }])
      .mockResolvedValueOnce([{ membership_id: membershipId, role_key: 'organization_owner' }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: grantId, granted_at: now }])
      .mockResolvedValueOnce([]);

    await expect(service.optInOrganizationMarketplace(userId, organizationId)).resolves.toEqual({
      active: true,
      grantedAt: now,
    });
    expect(manager.query.mock.calls[3][0]).toContain('INSERT INTO organization_application_entitlements');
  });

  it('requires active organization entitlement and membership before granting representation', async () => {
    manager.query
      .mockResolvedValueOnce([{ id: organizationId }])
      .mockResolvedValueOnce([{ membership_id: membershipId, role_key: 'organization_owner' }])
      .mockResolvedValueOnce([]);

    await expect(service.grantOrganizationRepresentative(userId, organizationId, {
      userId,
      authorityBasis: 'organization_owner_approval',
    })).rejects.toThrow('The organization must opt into Marketplace before representatives can be granted.');
  });

  it('requires a matching grantor role for owner/admin authority basis', async () => {
    manager.query
      .mockResolvedValueOnce([{ id: organizationId }])
      .mockResolvedValueOnce([{ membership_id: membershipId, role_key: 'organization_admin' }]);

    await expect(service.grantOrganizationRepresentative(userId, organizationId, {
      userId,
      authorityBasis: 'organization_owner_approval',
    })).rejects.toThrow('The selected authority basis does not match the grantor organization role.');
  });

  it('grants representation only to an active member and records the target membership identity', async () => {
    manager.query
      .mockResolvedValueOnce([{ id: organizationId }])
      .mockResolvedValueOnce([{ membership_id: membershipId, role_key: 'organization_owner' }])
      .mockResolvedValueOnce([{ id: grantId }])
      .mockResolvedValueOnce([{ id: membershipId }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: grantId, effective_at: now, expires_at: null }])
      .mockResolvedValueOnce([]);

    const result = await service.grantOrganizationRepresentative(userId, organizationId, {
      userId,
      authorityBasis: 'organization_owner_approval',
    });

    expect(result).toMatchObject({ id: grantId, organizationId, userId });
    expect(manager.query.mock.calls[6][0]).toContain('membership_id');
    expect(manager.query.mock.calls[6][1]).toEqual([
      organizationId,
      userId,
      membershipId,
      userId,
      membershipId,
      'organization_owner_approval',
      null,
      expect.any(Date),
      null,
    ]);
  });

  it('revokes organization Marketplace entitlement and active representation grants together', async () => {
    manager.query
      .mockResolvedValueOnce([{ membership_id: membershipId, role_key: 'organization_owner' }])
      .mockResolvedValueOnce([{ id: grantId }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    await expect(service.revokeOrganizationMarketplace(userId, organizationId, 'Organization opted out'))
      .resolves.toEqual({ active: false, revoked: true });
    expect(manager.query.mock.calls[1][0]).toContain('UPDATE organization_application_entitlements');
    expect(manager.query.mock.calls[2][0]).toContain('UPDATE organization_marketplace_representatives');
  });
});
