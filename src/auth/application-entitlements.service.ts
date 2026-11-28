import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';

type EntitlementRow = {
  application_key: 'assetpass_app' | 'marketplace';
  granted_at: Date | string;
};

type MembershipPermissionRow = { membership_id: string; role_key: string };

const APPLICATIONS = ['assetpass_app', 'marketplace'] as const;
const AUTHORITY_BASES = [
  'organization_owner_approval',
  'organization_admin_approval',
  'documented_delegation',
  'legal_representative_verification',
] as const;

@Injectable()
export class ApplicationEntitlementsService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async getUserEntitlements(userId: string) {
    const rows = await this.dataSource.query<EntitlementRow[]>(
      `SELECT application_key, granted_at
       FROM user_application_entitlements
       WHERE user_id = $1 AND revoked_at IS NULL
       ORDER BY application_key ASC`,
      [userId],
    );
    const active = new Map<string, Date | string>(rows.map((row): [string, Date | string] => [row.application_key, row.granted_at]));
    return {
      assetpassApp: {
        active: active.has('assetpass_app'),
        grantedAt: active.get('assetpass_app') ?? null,
      },
      marketplace: {
        active: active.has('marketplace'),
        grantedAt: active.get('marketplace') ?? null,
      },
    };
  }

  async optInIndividualMarketplace(userId: string, acknowledgementAccepted: unknown) {
    return this.dataSource.transaction(async (manager) => {
      const users = await manager.query(
        `SELECT id FROM users
         WHERE id = $1 AND status = 'active'
           AND approval_status = 'approved' AND deactivated_at IS NULL
         FOR UPDATE`,
        [userId],
      );
      if (!users.length) {
        throw new ForbiddenException('An approved, active account is required.');
      }

      const existing = await manager.query(
        `SELECT id, granted_at FROM user_application_entitlements
         WHERE user_id = $1 AND application_key = 'marketplace'
           AND revoked_at IS NULL
         LIMIT 1`,
        [userId],
      ) as Array<{ id: string; granted_at: Date | string }>;
      if (existing.length) {
        return { active: true, grantedAt: existing[0].granted_at };
      }
      if (acknowledgementAccepted !== true) {
        throw new BadRequestException('Confirm the Marketplace participation acknowledgement before opting in.');
      }

      const inserted = await manager.query(
        `INSERT INTO user_application_entitlements
           (user_id, application_key, grant_source)
         VALUES ($1, 'marketplace', 'explicit_individual_opt_in')
         RETURNING id, granted_at`,
        [userId],
      ) as Array<{ id: string; granted_at: Date | string }>;

      await this.writeAudit(manager, userId, 'marketplace.individual.opted_in', 'user_application_entitlement', inserted[0].id, {
        application: 'marketplace',
        grantSource: 'explicit_individual_opt_in',
        acknowledgementAccepted: true,
      });
      return { active: true, grantedAt: inserted[0].granted_at };
    });
  }

  async revokeIndividualMarketplace(userId: string, reasonInput: unknown) {
    const reason = this.requireReason(reasonInput);
    return this.dataSource.transaction(async (manager) => {
      await manager.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [userId]);
      const rows = await manager.query(
        `UPDATE user_application_entitlements
         SET revoked_at = NOW(), revoked_by_user_id = $1, revocation_reason = $2
         WHERE user_id = $1 AND application_key = 'marketplace'
           AND revoked_at IS NULL
         RETURNING id`,
        [userId, reason],
      ) as Array<{ id: string }>;
      if (!rows.length) {
        throw new NotFoundException('No active individual Marketplace entitlement exists.');
      }
      await this.writeAudit(manager, userId, 'marketplace.individual.revoked', 'user_application_entitlement', rows[0].id, {
        application: 'marketplace',
        reason,
      });
      return { active: false, revoked: true };
    });
  }

  async getOrganizationEntitlements(actorUserId: string, organizationId: string) {
    await this.assertOrganizationPermission(
      this.dataSource.manager,
      actorUserId,
      organizationId,
    );
    const rows = await this.dataSource.query<EntitlementRow[]>(
      `SELECT application_key, granted_at
       FROM organization_application_entitlements
       WHERE organization_id = $1 AND revoked_at IS NULL
       ORDER BY application_key ASC`,
      [organizationId],
    );
    const active = new Map(rows.map((row) => [row.application_key, row.granted_at]));
    return {
      organizationId,
      assetpassApp: {
        active: active.has('assetpass_app'),
        grantedAt: active.get('assetpass_app') ?? null,
      },
      marketplace: {
        active: active.has('marketplace'),
        grantedAt: active.get('marketplace') ?? null,
      },
    };
  }

  async optInOrganizationMarketplace(actorUserId: string, organizationId: string) {
    return this.dataSource.transaction(async (manager) => {
      const organizations = await manager.query(
        `SELECT id FROM organizations WHERE id = $1 AND status = 'active' FOR UPDATE`,
        [organizationId],
      );
      if (!organizations.length) {
        throw new NotFoundException('An active organization is required.');
      }
      await this.assertOrganizationPermission(manager, actorUserId, organizationId);

      const existing = await manager.query(
        `SELECT id, granted_at FROM organization_application_entitlements
         WHERE organization_id = $1 AND application_key = 'marketplace'
           AND revoked_at IS NULL LIMIT 1`,
        [organizationId],
      ) as Array<{ id: string; granted_at: Date | string }>;
      if (existing.length) {
        return { active: true, grantedAt: existing[0].granted_at };
      }

      const inserted = await manager.query(
        `INSERT INTO organization_application_entitlements
           (organization_id, application_key, granted_by_user_id, grant_source)
         VALUES ($1, 'marketplace', $2, 'explicit_organization_opt_in')
         RETURNING id, granted_at`,
        [organizationId, actorUserId],
      ) as Array<{ id: string; granted_at: Date | string }>;
      await this.writeAudit(manager, actorUserId, 'marketplace.organization.opted_in', 'organization_application_entitlement', inserted[0].id, {
        organizationId,
        application: 'marketplace',
      });
      return { active: true, grantedAt: inserted[0].granted_at };
    });
  }

  async revokeOrganizationMarketplace(actorUserId: string, organizationId: string, reasonInput: unknown) {
    const reason = this.requireReason(reasonInput);
    return this.dataSource.transaction(async (manager) => {
      await this.assertOrganizationPermission(manager, actorUserId, organizationId);
      const rows = await manager.query(
        `UPDATE organization_application_entitlements
         SET revoked_at = NOW(), revoked_by_user_id = $1, revocation_reason = $2
         WHERE organization_id = $3 AND application_key = 'marketplace'
           AND revoked_at IS NULL
         RETURNING id`,
        [actorUserId, reason, organizationId],
      ) as Array<{ id: string }>;
      if (!rows.length) {
        throw new NotFoundException('No active organization Marketplace entitlement exists.');
      }
      await manager.query(
        `UPDATE organization_marketplace_representatives
         SET revoked_at = NOW(), revoked_by_user_id = $1,
             revocation_reason = 'Organization Marketplace participation revoked: ' || $2
         WHERE organization_id = $3 AND revoked_at IS NULL`,
        [actorUserId, reason, organizationId],
      );
      await this.writeAudit(manager, actorUserId, 'marketplace.organization.revoked', 'organization_application_entitlement', rows[0].id, {
        organizationId,
        application: 'marketplace',
        reason,
      });
      return { active: false, revoked: true };
    });
  }

  async grantOrganizationRepresentative(
    actorUserId: string,
    organizationId: string,
    input: {
      userId?: unknown;
      authorityBasis?: unknown;
      authorityReference?: unknown;
      effectiveAt?: unknown;
      expiresAt?: unknown;
    },
  ) {
    const userId = typeof input?.userId === 'string' ? input.userId.trim() : '';
    const authorityBasis = input?.authorityBasis;
    const authorityReference = typeof input?.authorityReference === 'string'
      ? input.authorityReference.trim()
      : '';
    if (!isUuid(userId) || !AUTHORITY_BASES.includes(authorityBasis as typeof AUTHORITY_BASES[number])) {
      throw new BadRequestException('Provide a valid user and Marketplace representation authority basis.');
    }
    if (
      (authorityBasis === 'documented_delegation' || authorityBasis === 'legal_representative_verification') &&
      !authorityReference
    ) {
      throw new BadRequestException('An authority reference is required for this representation basis.');
    }
    if (authorityReference.length > 2000) {
      throw new BadRequestException('The authority reference is too long.');
    }

    const effectiveAt = parseDate(input.effectiveAt, 'effectiveAt') ?? new Date();
    const expiresAt = parseDate(input.expiresAt, 'expiresAt');
    if (expiresAt && expiresAt <= effectiveAt) {
      throw new BadRequestException('The representation expiry must be later than its effective date.');
    }

    return this.dataSource.transaction(async (manager) => {
      const organizations = await manager.query(
        `SELECT id FROM organizations WHERE id = $1 AND status = 'active' FOR UPDATE`,
        [organizationId],
      );
      if (!organizations.length) {
        throw new NotFoundException('An active organization is required.');
      }
      const grantorMembership = await this.assertOrganizationPermission(
        manager,
        actorUserId,
        organizationId,
      );
      if (
        (authorityBasis === 'organization_owner_approval' && grantorMembership.role_key !== 'organization_owner') ||
        (authorityBasis === 'organization_admin_approval' && grantorMembership.role_key !== 'organization_admin')
      ) {
        throw new ForbiddenException('The selected authority basis does not match the grantor organization role.');
      }
      const entitlement = await manager.query(
        `SELECT id FROM organization_application_entitlements
         WHERE organization_id = $1 AND application_key = 'marketplace'
           AND revoked_at IS NULL LIMIT 1`,
        [organizationId],
      );
      if (!entitlement.length) {
        throw new ConflictException('The organization must opt into Marketplace before representatives can be granted.');
      }

      const target = await manager.query(
        `SELECT m.id
         FROM organization_memberships m
         INNER JOIN users u ON u.id = m.user_id
         WHERE m.organization_id = $1 AND m.user_id = $2
           AND m.status = 'active'
           AND u.status = 'active' AND u.approval_status = 'approved'
           AND u.deactivated_at IS NULL
         LIMIT 1`,
        [organizationId, userId],
      );
      if (!target.length) {
        throw new ForbiddenException('The representative must have an approved active account and active membership in this organization.');
      }

      await manager.query(
        `UPDATE organization_marketplace_representatives
         SET revoked_at = expires_at,
             revoked_by_user_id = NULL,
             revocation_reason = 'Representation grant expired before a new grant was issued.'
         WHERE organization_id = $1 AND user_id = $2
           AND revoked_at IS NULL AND expires_at IS NOT NULL
           AND expires_at <= NOW()`,
        [organizationId, userId],
      );
      const current = await manager.query(
        `SELECT id FROM organization_marketplace_representatives
         WHERE organization_id = $1 AND user_id = $2 AND revoked_at IS NULL
         LIMIT 1`,
        [organizationId, userId],
      );
      if (current.length) {
        throw new ConflictException('This person already has a current Marketplace representation grant.');
      }

      const inserted = await manager.query(
        `INSERT INTO organization_marketplace_representatives
           (organization_id, user_id, membership_id, granted_by_user_id, granted_by_membership_id,
            authority_basis, authority_reference, effective_at, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id, effective_at, expires_at`,
        [
          organizationId,
          userId,
          target[0].id,
          actorUserId,
          grantorMembership.membership_id,
          authorityBasis,
          authorityReference || null,
          effectiveAt,
          expiresAt,
        ],
      ) as Array<{ id: string; effective_at: Date | string; expires_at: Date | string | null }>;
      await this.writeAudit(manager, actorUserId, 'marketplace.organization.representative.granted', 'organization_marketplace_representative', inserted[0].id, {
        organizationId,
        representativeUserId: userId,
        authorityBasis,
        effectiveAt,
        expiresAt,
      });
      return {
        id: inserted[0].id,
        organizationId,
        userId,
        effectiveAt: inserted[0].effective_at,
        expiresAt: inserted[0].expires_at,
      };
    });
  }

  async revokeOrganizationRepresentative(
    actorUserId: string,
    organizationId: string,
    grantId: string,
    reasonInput: unknown,
  ) {
    const reason = this.requireReason(reasonInput);
    return this.dataSource.transaction(async (manager) => {
      await this.assertOrganizationPermission(manager, actorUserId, organizationId);
      const rows = await manager.query(
        `UPDATE organization_marketplace_representatives
         SET revoked_at = NOW(), revoked_by_user_id = $1, revocation_reason = $2
         WHERE id = $3 AND organization_id = $4 AND revoked_at IS NULL
         RETURNING id, user_id`,
        [actorUserId, reason, grantId, organizationId],
      ) as Array<{ id: string; user_id: string }>;
      if (!rows.length) {
        throw new NotFoundException('An active Marketplace representation grant was not found.');
      }
      await this.writeAudit(manager, actorUserId, 'marketplace.organization.representative.revoked', 'organization_marketplace_representative', rows[0].id, {
        organizationId,
        representativeUserId: rows[0].user_id,
        reason,
      });
      return { id: rows[0].id, revoked: true };
    });
  }

  async getCurrentMarketplaceRepresentations(userId: string) {
    return this.dataSource.query(
      `SELECT
         representative.id AS grant_id,
         organization.id AS organization_id,
         organization.display_name,
         representative.effective_at,
         representative.expires_at,
         representative.authority_basis
       FROM organization_marketplace_representatives representative
       INNER JOIN organizations organization
         ON organization.id = representative.organization_id
       INNER JOIN organization_application_entitlements entitlement
         ON entitlement.organization_id = organization.id
         AND entitlement.application_key = 'marketplace'
         AND entitlement.revoked_at IS NULL
       INNER JOIN organization_memberships membership
         ON membership.id = representative.membership_id
         AND membership.organization_id = organization.id
         AND membership.user_id = representative.user_id
         AND membership.status = 'active'
       INNER JOIN users user_account
         ON user_account.id = representative.user_id
       WHERE representative.user_id = $1
         AND representative.revoked_at IS NULL
         AND representative.effective_at <= NOW()
         AND (representative.expires_at IS NULL OR representative.expires_at > NOW())
         AND organization.status = 'active'
         AND user_account.status = 'active'
         AND user_account.approval_status = 'approved'
         AND user_account.deactivated_at IS NULL
       ORDER BY organization.display_name ASC`,
      [userId],
    );
  }

  private async assertOrganizationPermission(
    manager: EntityManager,
    actorUserId: string,
    organizationId: string,
  ): Promise<MembershipPermissionRow> {
    const rows = await manager.query(
      `SELECT DISTINCT membership.id AS membership_id, role.key AS role_key
       FROM organization_memberships membership
       INNER JOIN organizations organization
         ON organization.id = membership.organization_id
       INNER JOIN users user_account ON user_account.id = membership.user_id
       INNER JOIN organization_membership_roles assignment
         ON assignment.membership_id = membership.id
         AND assignment.revoked_at IS NULL
       INNER JOIN organization_roles role
         ON role.id = assignment.role_id
         AND role.is_active = TRUE
         AND (role.organization_id IS NULL OR role.organization_id = organization.id)
       INNER JOIN organization_role_permissions role_permission
         ON role_permission.role_id = role.id
       INNER JOIN permissions permission
         ON permission.id = role_permission.permission_id
         AND permission.scope = 'organization'
         AND permission.key = 'organization.marketplace.manage'
       WHERE membership.organization_id = $1
         AND membership.user_id = $2
         AND membership.status = 'active'
         AND organization.status = 'active'
         AND user_account.status = 'active'
         AND user_account.approval_status = 'approved'
         AND user_account.deactivated_at IS NULL
       ORDER BY CASE role.key
         WHEN 'organization_owner' THEN 0
         WHEN 'organization_admin' THEN 1
         ELSE 2
       END
       LIMIT 1`,
      [organizationId, actorUserId],
    ) as MembershipPermissionRow[];
    if (!rows.length) {
      throw new ForbiddenException('Current organization membership and Marketplace management permission are required.');
    }
    return rows[0];
  }

  private async writeAudit(
    manager: EntityManager,
    actorUserId: string,
    action: string,
    entityType: string,
    entityId: string,
    metadata: Record<string, unknown>,
  ) {
    await manager.query(
      `INSERT INTO platform_audit_logs
         (actor_user_id, action, entity_type, entity_id, outcome, metadata)
       VALUES ($1, $2, $3, $4, 'success', $5::jsonb)`,
      [actorUserId, action, entityType, entityId, JSON.stringify(metadata)],
    );
  }

  private requireReason(value: unknown): string {
    const reason = typeof value === 'string' ? value.trim() : '';
    if (!reason || reason.length > 1000) {
      throw new BadRequestException('A revocation reason of 1 to 1000 characters is required.');
    }
    return reason;
  }
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function parseDate(value: unknown, field: string): Date | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') {
    throw new BadRequestException(`${field} must be an ISO date string.`);
  }
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new BadRequestException(`${field} must be a valid ISO date string.`);
  }
  return date;
}
