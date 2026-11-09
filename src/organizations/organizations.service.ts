import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, IsNull, Repository } from 'typeorm';
import { PlatformAuditLog } from '../audit/entities/platform-audit-log.entity';
import { Permission } from '../access-control/entities/permission.entity';
import { OrganizationMembershipRole } from '../access-control/entities/organization-membership-role.entity';
import { OrganizationRole } from '../access-control/entities/organization-role.entity';
import { OrganizationRolePermission } from '../access-control/entities/organization-role-permission.entity';
import { User, UserStatus } from '../identity/entities/user.entity';
import { Organization, OrganizationStatus } from './entities/organization.entity';
import { OrganizationMembership, OrganizationMembershipStatus } from './entities/organization-membership.entity';

export interface RegisterOrganizationInput {
  displayName: string; legalName?: string; category: string; registrationNumber?: string;
  contactEmail: string; contactPhone?: string; website?: string; description?: string;
  countryCode?: string; county?: string; city?: string;
}

export interface InviteOrganizationMemberInput {
  email: string;
  roleKey: 'organization_admin' | 'asset_manager' | 'organization_member';
}

@Injectable()
export class OrganizationsService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(Organization) private readonly organizations: Repository<Organization>,
    @InjectRepository(OrganizationMembership) private readonly memberships: Repository<OrganizationMembership>,
    @InjectRepository(OrganizationRole) private readonly roles: Repository<OrganizationRole>,
    @InjectRepository(OrganizationMembershipRole) private readonly membershipRoles: Repository<OrganizationMembershipRole>,
    @InjectRepository(OrganizationRolePermission) private readonly rolePermissions: Repository<OrganizationRolePermission>,
    @InjectRepository(Permission) private readonly permissions: Repository<Permission>,
    @InjectRepository(User) private readonly users: Repository<User>,
  ) {}

  async register(userId: string, input: RegisterOrganizationInput): Promise<Organization> {
    if (!input || typeof input !== 'object' || typeof input.displayName !== 'string' || typeof input.category !== 'string' || typeof input.contactEmail !== 'string') {
      throw new BadRequestException('A valid organization name, category and contact email are required.');
    }
    const displayName = input.displayName.trim();
    const category = input.category.trim();
    const contactEmail = input.contactEmail.trim().toLowerCase();
    if (!displayName || displayName.length > 200 || !category || category.length > 80 || !contactEmail || contactEmail.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) {
      throw new BadRequestException('A valid organization name, category and contact email are required.');
    }
    const registrationNumber = input.registrationNumber?.trim() || null;
    if (registrationNumber && await this.organizations.findOneBy({ registrationNumber })) {
      throw new ConflictException('An organization with this registration number already exists.');
    }
    return this.dataSource.transaction(async (manager) => {
      const orgRepo = manager.getRepository(Organization);
      const memberRepo = manager.getRepository(OrganizationMembership);
      const organization = await orgRepo.save(orgRepo.create({
        displayName, legalName: input.legalName?.trim() || null, category, registrationNumber,
        contactEmail, contactPhone: input.contactPhone?.trim() || null, website: input.website?.trim() || null,
        description: input.description?.trim() || null, countryCode: (input.countryCode?.trim().toUpperCase() || 'KE').slice(0, 2),
        county: input.county?.trim() || null, city: input.city?.trim() || null,
        status: OrganizationStatus.PENDING_REVIEW, createdByUserId: userId,
      }));
      await memberRepo.save(memberRepo.create({
        organizationId: organization.id, userId, status: OrganizationMembershipStatus.PENDING,
        invitedByUserId: null, joinedAt: null,
      }));
      await manager.getRepository(PlatformAuditLog).save({
        actorUserId: userId, action: 'organization.registration.submitted', entityType: 'organization',
        entityId: organization.id, outcome: 'success', reason: null, metadata: { status: organization.status },
      });
      return organization;
    });
  }

  async findMine(userId: string) {
    return this.memberships.createQueryBuilder('membership')
      .innerJoin('organizations', 'organization', 'organization.id = membership.organization_id')
      .where('membership.user_id = :userId', { userId })
      .andWhere('membership.status IN (:...statuses)', { statuses: [OrganizationMembershipStatus.ACTIVE, OrganizationMembershipStatus.PENDING] })
      .select([
        'membership.id AS membership_id', 'membership.status AS membership_status',
        'membership.created_at AS membership_created_at', 'organization.id AS id',
        'organization.display_name AS display_name', 'organization.category AS category',
        'organization.status AS status',
      ])
      .orderBy('membership.created_at', 'DESC').getRawMany();
  }

  async getWorkspace(userId: string, organizationId: string) {
    await this.assertPermission(userId, organizationId, 'organization.assets.read');
    const membership = await this.memberships.findOneBy({ organizationId, userId, status: OrganizationMembershipStatus.ACTIVE });
    const organization = await this.organizations.findOneBy({ id: organizationId, status: OrganizationStatus.ACTIVE });
    if (!membership || !organization) throw new NotFoundException('Active organization workspace not found.');
    const assignments = await this.membershipRoles.find({ where: { membershipId: membership.id } });
    const roles = assignments.length ? await this.roles.find({ where: { id: In(assignments.map((item) => item.roleId)) } }) : [];
    const grants = roles.length ? await this.rolePermissions.find({ where: { roleId: In(roles.map((item) => item.id)) } }) : [];
    const permissionRecords = grants.length ? await this.permissions.find({ where: { id: In(grants.map((item) => item.permissionId)) } }) : [];
    return {
      organization,
      membership: { id: membership.id, status: membership.status, joinedAt: membership.joinedAt },
      roles: roles.map((role) => ({ key: role.key, name: role.name })),
      permissions: permissionRecords.map((permission) => permission.key),
    };
  }

  async listMembers(actorUserId: string, organizationId: string) {
    await this.assertPermission(actorUserId, organizationId, 'organization.members.read');
    const memberships = await this.memberships.find({
      where: { organizationId },
      order: { createdAt: 'ASC' },
    });
    if (!memberships.length) return [];
    const users = await this.users.find({
      where: { id: In(memberships.map((membership) => membership.userId)) },
      select: { id: true, fullName: true, email: true, status: true },
    });
    const assignments = await this.membershipRoles.find({
      where: { membershipId: In(memberships.map((membership) => membership.id)) },
    });
    const roles = assignments.length ? await this.roles.find({ where: { id: In(assignments.map((item) => item.roleId)) } }) : [];
    const userMap = new Map(users.map((user) => [user.id, user]));
    const roleMap = new Map(roles.map((role) => [role.id, role]));
    return memberships.map((membership) => ({
      id: membership.id,
      status: membership.status,
      joinedAt: membership.joinedAt,
      createdAt: membership.createdAt,
      user: userMap.get(membership.userId) ?? null,
      roles: assignments.filter((assignment) => assignment.membershipId === membership.id)
        .map((assignment) => roleMap.get(assignment.roleId))
        .filter((role): role is OrganizationRole => Boolean(role))
        .map((role) => ({ key: role.key, name: role.name })),
    }));
  }

  async inviteMember(actorUserId: string, organizationId: string, input: InviteOrganizationMemberInput) {
    await this.assertPermission(actorUserId, organizationId, 'organization.members.manage');
    if (!input || typeof input.email !== 'string' || !['organization_admin', 'asset_manager', 'organization_member'].includes(input.roleKey)) {
      throw new BadRequestException('Provide a valid user email and organization role.');
    }
    const email = input.email.trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new BadRequestException('Enter a valid email address.');
    const user = await this.users.findOne({ where: { email, status: UserStatus.ACTIVE }, select: { id: true, fullName: true, email: true, status: true } });
    if (!user) throw new NotFoundException('No active AssetPass account exists for this email. The person must register before they can be invited.');
    const organization = await this.organizations.findOneBy({ id: organizationId, status: OrganizationStatus.ACTIVE });
    if (!organization) throw new NotFoundException('Active organization not found.');
    const existing = await this.memberships.findOneBy({ organizationId, userId: user.id });
    if (existing && existing.status !== OrganizationMembershipStatus.REMOVED) {
      throw new ConflictException('This user already has an organization membership or invitation.');
    }
    const role = await this.roles.findOne({ where: [
      { organizationId: IsNull(), key: input.roleKey, isActive: true },
      { organizationId, key: input.roleKey, isActive: true },
    ] });
    if (!role) throw new BadRequestException('The selected organization role is not available.');
    return this.dataSource.transaction(async (manager) => {
      const membershipRepo = manager.getRepository(OrganizationMembership);
      let membership: OrganizationMembership;
      if (existing) {
        membership = await membershipRepo.save({
          ...existing,
          status: OrganizationMembershipStatus.PENDING,
          invitedByUserId: actorUserId,
          joinedAt: null,
        });
        await manager.getRepository(OrganizationMembershipRole).delete({ membershipId: membership.id });
      } else {
        membership = await membershipRepo.save(membershipRepo.create({
          organizationId, userId: user.id, status: OrganizationMembershipStatus.PENDING,
          invitedByUserId: actorUserId, joinedAt: null,
        }));
      }
      await manager.getRepository(OrganizationMembershipRole).save(
        manager.getRepository(OrganizationMembershipRole).create({
          membershipId: membership.id, roleId: role.id, assignedByUserId: actorUserId,
        }),
      );
      await manager.getRepository(PlatformAuditLog).save({
        actorUserId, action: 'organization.member.invited', entityType: 'organization_membership',
        entityId: membership.id, outcome: 'success', reason: null,
        metadata: { organizationId, invitedUserId: user.id, roleKey: role.key },
      });
      return { id: membership.id, status: membership.status, email: user.email, fullName: user.fullName, role: role.name };
    });
  }

  async acceptInvitation(userId: string, organizationId: string, membershipId: string) {
    return this.dataSource.transaction(async (manager) => {
      const membershipRepo = manager.getRepository(OrganizationMembership);
      const membership = await membershipRepo.findOne({ where: { id: membershipId, organizationId, userId } });
      if (!membership) throw new NotFoundException('Organization invitation not found.');
      if (membership.status !== OrganizationMembershipStatus.PENDING) throw new ConflictException('This invitation is no longer pending.');
      const organization = await manager.getRepository(Organization).findOneBy({ id: organizationId, status: OrganizationStatus.ACTIVE });
      if (!organization) throw new ConflictException('The organization is not currently active.');
      membership.status = OrganizationMembershipStatus.ACTIVE;
      membership.joinedAt = new Date();
      await membershipRepo.save(membership);
      await manager.getRepository(PlatformAuditLog).save({
        actorUserId: userId, action: 'organization.invitation.accepted', entityType: 'organization_membership',
        entityId: membership.id, outcome: 'success', reason: null, metadata: { organizationId },
      });
      return { membershipId: membership.id, organizationId, status: membership.status, joinedAt: membership.joinedAt };
    });
  }

  async changeMemberStatus(actorUserId: string, organizationId: string, membershipId: string, status: OrganizationMembershipStatus) {
    await this.assertPermission(actorUserId, organizationId, 'organization.members.manage');
    if (![OrganizationMembershipStatus.ACTIVE, OrganizationMembershipStatus.SUSPENDED, OrganizationMembershipStatus.REMOVED].includes(status)) {
      throw new BadRequestException('Only reactivation, suspension or removal is supported from member management.');
    }
    return this.dataSource.transaction(async (manager) => {
      const membershipRepo = manager.getRepository(OrganizationMembership);
      const membership = await membershipRepo.findOneBy({ id: membershipId, organizationId });
      if (!membership) throw new NotFoundException('Organization member not found.');
      if (membership.userId === actorUserId) throw new BadRequestException('You cannot suspend or remove your own membership.');
      if (membership.status === OrganizationMembershipStatus.REMOVED || membership.status === OrganizationMembershipStatus.REJECTED) {
        throw new ConflictException('This membership is no longer eligible for status changes.');
      }
      if (status === OrganizationMembershipStatus.ACTIVE && membership.status !== OrganizationMembershipStatus.SUSPENDED) {
        throw new ConflictException('Only a suspended membership can be reactivated.');
      }
      const assignments = await manager.getRepository(OrganizationMembershipRole).find({ where: { membershipId } });
      const assignedRoles = assignments.length ? await manager.getRepository(OrganizationRole).find({ where: { id: In(assignments.map((item) => item.roleId)) } }) : [];
      if (assignedRoles.some((role) => role.key === 'organization_owner')) {
        const otherOwners = await manager.createQueryBuilder()
          .select('COUNT(DISTINCT membership.id)', 'count')
          .from(OrganizationMembership, 'membership')
          .innerJoin(OrganizationMembershipRole, 'assignment', 'assignment.membership_id = membership.id')
          .innerJoin(OrganizationRole, 'role', 'role.id = assignment.role_id')
          .where('membership.organization_id = :organizationId', { organizationId })
          .andWhere('membership.status = :active', { active: OrganizationMembershipStatus.ACTIVE })
          .andWhere('role.key = :owner', { owner: 'organization_owner' })
          .andWhere('membership.id != :membershipId', { membershipId })
          .getRawOne<{ count: string }>();
        if (Number(otherOwners?.count ?? 0) === 0) throw new ConflictException('The last Organization Owner cannot be suspended or removed.');
      }
      const previousStatus = membership.status;
      membership.status = status;
      await membershipRepo.save(membership);
      await manager.getRepository(PlatformAuditLog).save({
        actorUserId,
        action: status === OrganizationMembershipStatus.SUSPENDED ? 'organization.member.suspended' : status === OrganizationMembershipStatus.REMOVED ? 'organization.member.removed' : 'organization.member.reactivated',
        entityType: 'organization_membership', entityId: membership.id, outcome: 'success', reason: null,
        metadata: { organizationId, targetUserId: membership.userId, previousStatus, newStatus: status },
      });
      return { membershipId, status };
    });
  }

  async changeMemberRole(actorUserId: string, organizationId: string, membershipId: string, roleKey: string) {
    await this.assertPermission(actorUserId, organizationId, 'organization.roles.manage');
    if (!['organization_admin', 'asset_manager', 'organization_member'].includes(roleKey)) {
      throw new BadRequestException('The selected role cannot be assigned through member management.');
    }
    const membership = await this.memberships.findOneBy({ id: membershipId, organizationId, status: OrganizationMembershipStatus.ACTIVE });
    if (!membership) throw new NotFoundException('Active organization member not found.');
    if (membership.userId === actorUserId) {
      throw new BadRequestException('You cannot change your own organization role.');
    }
    const currentAssignments = await this.membershipRoles.find({ where: { membershipId } });
    const currentRoles = currentAssignments.length
      ? await this.roles.find({ where: { id: In(currentAssignments.map((item) => item.roleId)) } })
      : [];
    if (currentRoles.some((item) => item.key === 'organization_owner')) {
      const otherOwners = await this.memberships.createQueryBuilder('membership')
        .innerJoin(OrganizationMembershipRole, 'assignment', 'assignment.membership_id = membership.id')
        .innerJoin(OrganizationRole, 'ownerRole', 'ownerRole.id = assignment.role_id')
        .where('membership.organization_id = :organizationId', { organizationId })
        .andWhere('membership.status = :active', { active: OrganizationMembershipStatus.ACTIVE })
        .andWhere('ownerRole.key = :owner', { owner: 'organization_owner' })
        .andWhere('membership.id != :membershipId', { membershipId })
        .getCount();
      if (otherOwners === 0) throw new ConflictException('The last Organization Owner cannot be demoted.');
    }
    const role = await this.roles.findOne({ where: [
      { organizationId: IsNull(), key: roleKey, isActive: true },
      { organizationId, key: roleKey, isActive: true },
    ] });
    if (!role) throw new BadRequestException('The selected organization role is not available.');
    return this.dataSource.transaction(async (manager) => {
      await manager.getRepository(OrganizationMembershipRole).delete({ membershipId });
      await manager.getRepository(OrganizationMembershipRole).save(
        manager.getRepository(OrganizationMembershipRole).create({ membershipId, roleId: role.id, assignedByUserId: actorUserId }),
      );
      await manager.getRepository(PlatformAuditLog).save({
        actorUserId, action: 'organization.member.role.changed', entityType: 'organization_membership',
        entityId: membershipId, outcome: 'success', reason: null,
        metadata: { organizationId, targetUserId: membership.userId, roleKey },
      });
      return { membershipId, role: { key: role.key, name: role.name } };
    });
  }

  private async assertPermission(userId: string, organizationId: string, permissionKey: string) {
    const organization = await this.organizations.findOneBy({ id: organizationId, status: OrganizationStatus.ACTIVE });
    if (!organization) throw new NotFoundException('Active organization workspace not found.');
    const rows = await this.memberships.createQueryBuilder('membership')
      .innerJoin(OrganizationMembershipRole, 'assignment', 'assignment.membership_id = membership.id')
      .innerJoin(OrganizationRole, 'role', 'role.id = assignment.role_id AND role.is_active = true')
      .innerJoin(OrganizationRolePermission, 'rolePermission', 'rolePermission.role_id = role.id')
      .innerJoin(Permission, 'permission', 'permission.id = rolePermission.permission_id')
      .where('membership.organization_id = :organizationId', { organizationId })
      .andWhere('membership.user_id = :userId', { userId })
      .andWhere('membership.status = :status', { status: OrganizationMembershipStatus.ACTIVE })
      .andWhere('permission.key = :permissionKey', { permissionKey })
      .andWhere('permission.scope = :scope', { scope: 'organization' })
      .getCount();
    if (!rows) throw new ForbiddenException('You do not have permission to perform this organization action.');
  }

  async list(status?: OrganizationStatus) {
    if (status && !Object.values(OrganizationStatus).includes(status)) throw new BadRequestException('Invalid organization status filter.');
    return this.organizations.find({ where: status ? { status } : {}, order: { createdAt: 'DESC' } });
  }

  async review(id: string, actorUserId: string, status: OrganizationStatus, note?: string) {
    if (![OrganizationStatus.ACTIVE, OrganizationStatus.REJECTED, OrganizationStatus.SUSPENDED].includes(status)) throw new BadRequestException('Unsupported organization status transition.');
    if (status === OrganizationStatus.REJECTED && !note?.trim()) throw new BadRequestException('A reason is required when rejecting an organization.');
    return this.dataSource.transaction(async (manager) => {
      const rows = await manager.query('SELECT id, status FROM organizations WHERE id = $1 FOR UPDATE', [id]) as Array<{ id: string; status: OrganizationStatus }>;
      if (!rows.length) throw new NotFoundException('Organization not found.');
      const previousStatus = rows[0].status;
      if (previousStatus === OrganizationStatus.REJECTED) throw new ConflictException('A rejected registration cannot be changed.');
      if (previousStatus === OrganizationStatus.PENDING_REVIEW && status === OrganizationStatus.SUSPENDED) throw new BadRequestException('A pending registration must be approved or rejected first.');
      const orgRepo = manager.getRepository(Organization);
      await orgRepo.update(id, { status, reviewedByUserId: actorUserId, reviewedAt: new Date(), decisionNote: note?.trim() || null });
      if (status === OrganizationStatus.ACTIVE) {
        const memberRepo = manager.getRepository(OrganizationMembership);
        const membership = await memberRepo.findOne({ where: { organizationId: id, status: OrganizationMembershipStatus.PENDING } });
        if (membership) {
          membership.status = OrganizationMembershipStatus.ACTIVE;
          membership.joinedAt = new Date();
          await memberRepo.save(membership);
          const ownerRole = await manager.getRepository(OrganizationRole).findOne({ where: { organizationId: IsNull(), key: 'organization_owner', isActive: true } });
          if (!ownerRole) throw new Error('System organization owner role is missing.');
          await manager.query('INSERT INTO organization_membership_roles (membership_id, role_id, assigned_by_user_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [membership.id, ownerRole.id, actorUserId]);
        }
      } else if (status === OrganizationStatus.REJECTED) {
        await manager.getRepository(OrganizationMembership).update(
          { organizationId: id, status: OrganizationMembershipStatus.PENDING }, { status: OrganizationMembershipStatus.REJECTED },
        );
      }
      await manager.getRepository(PlatformAuditLog).save({
        actorUserId, action: 'organization.status.changed', entityType: 'organization', entityId: id,
        outcome: 'success', reason: note?.trim() || null, metadata: { previousStatus, newStatus: status },
      });
      return orgRepo.findOneByOrFail({ id });
    });
  }
}
