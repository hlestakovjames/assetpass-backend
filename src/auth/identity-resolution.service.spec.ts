import { DataSource, Repository } from 'typeorm';
import { UserProfile } from '../identity/entities/user-profile.entity';
import { UserStatus } from '../identity/entities/user.entity';
import { AuthenticatedIdentity } from './auth.service';
import { IdentityResolutionService } from './identity-resolution.service';

describe('IdentityResolutionService', () => {
  let service: IdentityResolutionService;
  let query: jest.Mock;
  let profileRepository: jest.Mocked<Pick<Repository<UserProfile>, 'findOneBy'>>;

  const user = {
    id: '9fed3a07-5a17-4b94-8437-552edeebf5a6',
    fullName: 'Test User',
    email: 'test@example.com',
    status: UserStatus.ACTIVE,
  } as AuthenticatedIdentity;

  beforeEach(() => {
    query = jest.fn();
    profileRepository = { findOneBy: jest.fn().mockResolvedValue(null) };
    const dataSource = {
      query,
      getRepository: jest.fn().mockReturnValue(profileRepository),
    };
    service = new IdentityResolutionService(dataSource as unknown as DataSource);
  });

  it('resolves organization memberships, roles, permissions and organization landing route', async () => {
    query
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          membership_id: 'membership-1',
          membership_status: 'active',
          membership_created_at: new Date('2026-01-01T00:00:00.000Z'),
          joined_at: new Date('2026-01-02T00:00:00.000Z'),
          organization_id: 'organization-1',
          display_name: 'Example Organization',
          category: 'Business',
          organization_status: 'active',
          role_key: 'organization_owner',
          role_name: 'Organization Owner',
          permission_key: 'organization.assets.read',
        },
        {
          membership_id: 'membership-1',
          membership_status: 'active',
          membership_created_at: new Date('2026-01-01T00:00:00.000Z'),
          joined_at: new Date('2026-01-02T00:00:00.000Z'),
          organization_id: 'organization-1',
          display_name: 'Example Organization',
          category: 'Business',
          organization_status: 'active',
          role_key: 'organization_owner',
          role_name: 'Organization Owner',
          permission_key: 'organization.members.read',
        },
      ])
      .mockResolvedValueOnce([]);

    const result = await service.resolve(user);

    expect(result.platformRoles).toEqual([]);
    expect(result.platformPermissions).toEqual([]);
    expect(result.organizations).toHaveLength(1);
    expect(result.organizations[0]).toMatchObject({
      id: 'organization-1',
      status: 'active',
      membership: { id: 'membership-1', status: 'active' },
      roles: [{ key: 'organization_owner', name: 'Organization Owner' }],
      permissions: ['organization.assets.read', 'organization.members.read'],
    });
    expect(result.defaultWorkspace).toEqual({
      type: 'organization',
      label: 'Your organizations',
      href: '/organization/overview',
    });
    expect(result.availableWorkspaces.map((workspace) => workspace.type)).toEqual([
      'individual',
      'organization',
    ]);
  });

  it('gives the platform owner the platform landing route and registered platform permissions', async () => {
    query
      .mockResolvedValueOnce([{ role: 'Platform Owner' }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { key: 'platform.users.view' },
        { key: 'platform.organizations.review' },
      ]);

    const result = await service.resolve(user);

    expect(result.platformRoles).toEqual(['Platform Owner']);
    expect(result.platformPermissions).toEqual([
      'platform.users.view',
      'platform.organizations.review',
    ]);
    expect(result.defaultWorkspace).toEqual({
      type: 'platform',
      label: 'Platform administration',
      href: '/platform/overview',
    });
    expect(result.availableWorkspaces.map((workspace) => workspace.type)).toEqual([
      'platform',
      'individual',
    ]);
  });

  it('keeps a pending organization visible without granting an active organization workspace', async () => {
    query
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          membership_id: 'membership-pending',
          membership_status: 'pending',
          membership_created_at: new Date('2026-11-09T00:00:00.000Z'),
          joined_at: null,
          organization_id: 'organization-pending',
          display_name: 'Pending Organization',
          category: 'Non-profit',
          organization_status: 'pending_review',
          role_key: null,
          role_name: null,
          permission_key: null,
        },
      ])
      .mockResolvedValueOnce([]);

    const result = await service.resolve(user);

    expect(result.organizations[0]).toMatchObject({
      status: 'pending_review',
      membership: { status: 'pending' },
      roles: [],
      permissions: [],
    });
    expect(result.defaultWorkspace.href).toBe('/organization/overview');
    expect(result.availableWorkspaces).toEqual([
      { type: 'individual', label: 'Individual workspace', href: '/individual/overview' },
    ]);
  });
});
