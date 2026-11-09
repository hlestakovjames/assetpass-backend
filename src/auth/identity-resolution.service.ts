import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { UserProfile } from '../identity/entities/user-profile.entity';
import { AuthenticatedIdentity } from './auth.service';

type PlatformRoleRow = { role: string };
type PermissionRow = { key: string };
type OrganizationRow = {
  membership_id: string;
  membership_status: string;
  membership_created_at: Date | string;
  joined_at: Date | string | null;
  organization_id: string;
  display_name: string;
  category: string;
  organization_status: string;
  role_key: string | null;
  role_name: string | null;
  permission_key: string | null;
};

export type ResolvedOrganizationIdentity = {
  id: string;
  displayName: string;
  category: string;
  status: string;
  membership: {
    id: string;
    status: string;
    createdAt: Date | string;
    joinedAt: Date | string | null;
  };
  roles: Array<{ key: string; name: string }>;
  permissions: string[];
};

export type ResolvedWorkspace = {
  type: 'platform' | 'individual' | 'organization';
  id?: string;
  label: string;
  href: string;
};

@Injectable()
export class IdentityResolutionService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async resolve(user: AuthenticatedIdentity) {
    const [profile, platformRoleRows, organizationRows] = await Promise.all([
      this.dataSource.getRepository(UserProfile).findOneBy({ userId: user.id }),
      this.dataSource.query<PlatformRoleRow[]>(
        `SELECT role FROM platform_roles
         WHERE user_id = $1 AND revoked_at IS NULL
         ORDER BY assigned_at ASC`,
        [user.id],
      ),
      this.dataSource.query<OrganizationRow[]>(
        `SELECT
           m.id AS membership_id,
           m.status AS membership_status,
           m.created_at AS membership_created_at,
           m.joined_at AS joined_at,
           o.id AS organization_id,
           o.display_name AS display_name,
           o.category AS category,
           o.status AS organization_status,
           r.key AS role_key,
           r.name AS role_name,
           p.key AS permission_key
         FROM organization_memberships m
         INNER JOIN organizations o ON o.id = m.organization_id
         LEFT JOIN organization_membership_roles mr
           ON mr.membership_id = m.id
           AND m.status = 'active'
           AND o.status = 'active'
         LEFT JOIN organization_roles r
           ON r.id = mr.role_id AND r.is_active = TRUE
         LEFT JOIN organization_role_permissions rp ON rp.role_id = r.id
         LEFT JOIN permissions p
           ON p.id = rp.permission_id AND p.scope = 'organization'
         WHERE m.user_id = $1 AND m.status <> 'removed'
         ORDER BY m.created_at DESC, r.name ASC, p.key ASC`,
        [user.id],
      ),
    ]);

    const platformRoles = platformRoleRows.map((row) => row.role);
    const isPlatformOwner = platformRoles.includes('Platform Owner');
    const platformPermissionRows = isPlatformOwner
      ? await this.dataSource.query<PermissionRow[]>(
          `SELECT key FROM permissions WHERE scope = 'platform' ORDER BY key ASC`,
        )
      : await this.dataSource.query<PermissionRow[]>(
          `SELECT DISTINCT p.key
           FROM platform_roles pr
           INNER JOIN platform_role_permissions prp ON prp.platform_role_id = pr.id
           INNER JOIN permissions p ON p.id = prp.permission_id
           WHERE pr.user_id = $1
             AND pr.revoked_at IS NULL
             AND pr.role = 'Platform Administrator'
             AND p.scope = 'platform'
           ORDER BY p.key ASC`,
          [user.id],
        );

    const organizationsById = new Map<string, ResolvedOrganizationIdentity>();
    for (const row of organizationRows) {
      let organization = organizationsById.get(row.organization_id);
      if (!organization) {
        organization = {
          id: row.organization_id,
          displayName: row.display_name,
          category: row.category,
          status: row.organization_status,
          membership: {
            id: row.membership_id,
            status: row.membership_status,
            createdAt: row.membership_created_at,
            joinedAt: row.joined_at,
          },
          roles: [],
          permissions: [],
        };
        organizationsById.set(row.organization_id, organization);
      }
      if (row.role_key && row.role_name &&
          !organization.roles.some((role) => role.key === row.role_key)) {
        organization.roles.push({ key: row.role_key, name: row.role_name });
      }
      if (row.permission_key &&
          !organization.permissions.includes(row.permission_key)) {
        organization.permissions.push(row.permission_key);
      }
    }

    const organizations = [...organizationsById.values()];
    const availableWorkspaces: ResolvedWorkspace[] = [
      { type: 'individual', label: 'Individual workspace', href: '/individual/overview' },
    ];

    if (platformRoles.length) {
      availableWorkspaces.unshift({
        type: 'platform',
        label: 'Platform administration',
        href: '/platform/overview',
      });
    }

    for (const organization of organizations) {
      if (organization.status === 'active' &&
          organization.membership.status === 'active') {
        availableWorkspaces.push({
          type: 'organization',
          id: organization.id,
          label: organization.displayName,
          href: `/organization/${organization.id}`,
        });
      }
    }

    const hasOrganizationContext = organizations.some((organization) =>
      organization.membership.status === 'pending' ||
      (organization.membership.status === 'active' && organization.status === 'active'),
    );

    const defaultWorkspace = platformRoles.length
      ? availableWorkspaces.find((workspace) => workspace.type === 'platform')!
      : hasOrganizationContext
        ? { type: 'organization' as const, label: 'Your organizations', href: '/organization/overview' }
        : availableWorkspaces[0];

    return {
      ...user,
      profile: profile ? {
        firstName: profile.firstName,
        middleName: profile.middleName,
        lastName: profile.lastName,
        phoneNumber: profile.phoneNumber,
        alternativePhone: profile.alternativePhone,
        countryCode: profile.countryCode,
        county: profile.county,
        city: profile.city,
        occupation: profile.occupation,
        preferredContactMethod: profile.preferredContactMethod,
        profilePhotoUrl: profile.profilePhotoUrl,
      } : null,
      platformRoles,
      platformPermissions: platformPermissionRows.map((row) => row.key),
      organizations,
      availableWorkspaces,
      defaultWorkspace,
    };
  }
}
