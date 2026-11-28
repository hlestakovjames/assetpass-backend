import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, IsNull, Repository } from 'typeorm';
import { appendOrganizationMembershipEvent } from './organization-membership-events';
import { OrganizationMembershipEvent, OrganizationMembershipEventType } from './entities/organization-membership-event.entity';
import { PlatformAuditLog } from '../audit/entities/platform-audit-log.entity';
import { Permission } from '../access-control/entities/permission.entity';
import { OrganizationMembershipRole } from '../access-control/entities/organization-membership-role.entity';
import { OrganizationRole } from '../access-control/entities/organization-role.entity';
import { OrganizationRolePermission } from '../access-control/entities/organization-role-permission.entity';
import { User, UserStatus } from '../identity/entities/user.entity';
import { Organization, OrganizationStatus } from './entities/organization.entity';
import { OrganizationMembership, OrganizationMembershipStatus } from './entities/organization-membership.entity';
import { OrganizationOnboardingApplication, OrganizationOnboardingStatus } from './entities/organization-onboarding-application.entity';
import { OrganizationOnboardingSession } from './entities/organization-onboarding-session.entity';

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
      const membership = await memberRepo.save(memberRepo.create({
        organizationId: organization.id, userId, status: OrganizationMembershipStatus.PENDING,
        invitedByUserId: null, joinedAt: null,
      }));
      await appendOrganizationMembershipEvent(manager, {
        membershipId: membership.id,
        eventType: OrganizationMembershipEventType.MEMBERSHIP_CREATED,
        previousStatus: null,
        newStatus: OrganizationMembershipStatus.PENDING,
        actorUserId: userId,
        metadata: { source: 'organization_registration' },
      });
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
    const assignments = await this.membershipRoles.find({
      where: { membershipId: membership.id, revokedAt: IsNull() },
    });
    const roles = assignments.length
      ? await this.roles.createQueryBuilder('role')
          .where('role.id IN (:...roleIds)', { roleIds: assignments.map((item) => item.roleId) })
          .andWhere('role.is_active = true')
          .andWhere('(role.organization_id IS NULL OR role.organization_id = :organizationId)', { organizationId })
          .getMany()
      : [];
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
      where: { membershipId: In(memberships.map((membership) => membership.id)), revokedAt: IsNull() },
    });
    const roles = assignments.length
      ? await this.roles.createQueryBuilder('role')
          .where('role.id IN (:...roleIds)', { roleIds: assignments.map((item) => item.roleId) })
          .andWhere('role.is_active = true')
          .andWhere('(role.organization_id IS NULL OR role.organization_id = :organizationId)', { organizationId })
          .getMany()
      : [];
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
    if (!input || typeof input.email !== 'string' || !['organization_admin', 'asset_manager', 'organization_member'].includes(input.roleKey)) {
      throw new BadRequestException('Provide a valid user email and organization role.');
    }
    const email = input.email.trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new BadRequestException('Enter a valid email address.');
    const user = await this.users.findOne({ where: { email, status: UserStatus.ACTIVE }, select: { id: true, fullName: true, email: true, status: true } });
    if (!user) throw new NotFoundException('No active AssetPass account exists for this email. The person must register before they can be invited.');
    const organization = await this.organizations.findOneBy({ id: organizationId, status: OrganizationStatus.ACTIVE });
    if (!organization) throw new NotFoundException('Active organization not found.');
    const role = await this.roles.findOne({ where: [
      { organizationId: IsNull(), key: input.roleKey, isActive: true },
      { organizationId, key: input.roleKey, isActive: true },
    ] });
    if (!role || (role.organizationId !== null && role.organizationId !== organizationId)) {
      throw new BadRequestException('The selected organization role is not available.');
    }
    return this.dataSource.transaction(async (manager) => {
      await this.assertPermission(actorUserId, organizationId, 'organization.members.manage', manager);
      const membershipRepo = manager.getRepository(OrganizationMembership);
      const membership = await membershipRepo.createQueryBuilder('membership')
        .setLock('pessimistic_write')
        .where('membership.organization_id = :organizationId', { organizationId })
        .andWhere('membership.user_id = :userId', { userId: user.id })
        .getOne();
      if (membership && membership.status !== OrganizationMembershipStatus.REMOVED) {
        throw new ConflictException('This user already has an organization membership or invitation.');
      }

      let savedMembership: OrganizationMembership;
      const previousStatus = membership?.status ?? null;
      if (membership) {
        savedMembership = await membershipRepo.save({
          ...membership,
          status: OrganizationMembershipStatus.PENDING,
          invitedByUserId: actorUserId,
          // Preserve the first joined_at value across re-invitation.
          joinedAt: membership.joinedAt,
        });
        await manager.getRepository(OrganizationMembershipRole).update(
          { membershipId: membership.id, revokedAt: IsNull() },
          {
            revokedAt: new Date(),
            revokedByUserId: actorUserId,
            revocationReason: 'Prior role assignments closed before membership re-invitation.',
          },
        );
      } else {
        savedMembership = await membershipRepo.save(membershipRepo.create({
          organizationId, userId: user.id, status: OrganizationMembershipStatus.PENDING,
          invitedByUserId: actorUserId, joinedAt: null,
        }));
      }

      const roleRepo = manager.getRepository(OrganizationRole);
      const currentRole = await roleRepo.findOneBy({ id: role.id, isActive: true });
      if (!currentRole || (currentRole.organizationId !== null && currentRole.organizationId !== organizationId)) {
        throw new ConflictException('The selected organization role is no longer available.');
      }
      await manager.getRepository(OrganizationMembershipRole).save(
        manager.getRepository(OrganizationMembershipRole).create({
          membershipId: savedMembership.id, roleId: currentRole.id, assignedByUserId: actorUserId,
        }),
      );
      await appendOrganizationMembershipEvent(manager, {
        membershipId: savedMembership.id,
        eventType: membership
          ? OrganizationMembershipEventType.MEMBERSHIP_REINVITED
          : OrganizationMembershipEventType.MEMBERSHIP_INVITED,
        previousStatus,
        newStatus: OrganizationMembershipStatus.PENDING,
        actorUserId,
        metadata: { organizationId, invitedUserId: user.id, roleKey: currentRole.key },
      });
      await manager.getRepository(PlatformAuditLog).save({
        actorUserId, action: 'organization.member.invited', entityType: 'organization_membership',
        entityId: savedMembership.id, outcome: 'success', reason: null,
        metadata: { organizationId, invitedUserId: user.id, roleKey: currentRole.key },
      });
      return { id: savedMembership.id, status: savedMembership.status, email: user.email, fullName: user.fullName, role: currentRole.name };
    });
  }

  async acceptInvitation(userId: string, organizationId: string, membershipId: string) {
    return this.dataSource.transaction(async (manager) => {
      const membershipRepo = manager.getRepository(OrganizationMembership);
      const membership = await membershipRepo.createQueryBuilder('membership')
        .setLock('pessimistic_write')
        .where('membership.id = :membershipId', { membershipId })
        .andWhere('membership.organization_id = :organizationId', { organizationId })
        .andWhere('membership.user_id = :userId', { userId })
        .getOne();
      if (!membership) throw new NotFoundException('Organization invitation not found.');
      if (membership.status !== OrganizationMembershipStatus.PENDING) throw new ConflictException('This invitation is no longer pending.');
      const organization = await manager.getRepository(Organization).findOneBy({ id: organizationId, status: OrganizationStatus.ACTIVE });
      if (!organization) throw new ConflictException('The organization is not currently active.');
      const previousStatus = membership.status;
      const isRejoin = membership.joinedAt !== null;
      membership.status = OrganizationMembershipStatus.ACTIVE;
      membership.joinedAt = membership.joinedAt ?? new Date();
      await membershipRepo.save(membership);
      await appendOrganizationMembershipEvent(manager, {
        membershipId: membership.id,
        eventType: isRejoin
          ? OrganizationMembershipEventType.MEMBERSHIP_REJOINED
          : OrganizationMembershipEventType.INVITATION_ACCEPTED,
        previousStatus,
        newStatus: OrganizationMembershipStatus.ACTIVE,
        actorUserId: userId,
        metadata: { organizationId },
      });
      await manager.getRepository(PlatformAuditLog).save({
        actorUserId: userId, action: 'organization.invitation.accepted', entityType: 'organization_membership',
        entityId: membership.id, outcome: 'success', reason: null, metadata: { organizationId },
      });
      return { membershipId, organizationId, status: membership.status, joinedAt: membership.joinedAt };
    });
  }

  async changeMemberStatus(actorUserId: string, organizationId: string, membershipId: string, status: OrganizationMembershipStatus) {
    if (![OrganizationMembershipStatus.ACTIVE, OrganizationMembershipStatus.SUSPENDED, OrganizationMembershipStatus.REMOVED].includes(status)) {
      throw new BadRequestException('Only reactivation, suspension or removal is supported from member management.');
    }
    return this.dataSource.transaction(async (manager) => {
      await this.assertPermission(actorUserId, organizationId, 'organization.members.manage', manager);
      const membershipRepo = manager.getRepository(OrganizationMembership);
      const membership = await membershipRepo.createQueryBuilder('membership')
        .setLock('pessimistic_write')
        .where('membership.id = :membershipId', { membershipId })
        .andWhere('membership.organization_id = :organizationId', { organizationId })
        .getOne();
      if (!membership) throw new NotFoundException('Organization member not found.');
      if (membership.userId === actorUserId) throw new BadRequestException('You cannot suspend or remove your own membership.');
      if (membership.status === OrganizationMembershipStatus.REMOVED || membership.status === OrganizationMembershipStatus.REJECTED) {
        throw new ConflictException('This membership is no longer eligible for status changes.');
      }
      if (status === OrganizationMembershipStatus.ACTIVE && membership.status !== OrganizationMembershipStatus.SUSPENDED) {
        throw new ConflictException('Only a suspended membership can be reactivated.');
      }
      if (status === OrganizationMembershipStatus.ACTIVE) {
        const activeOrganization = await manager.getRepository(Organization).findOneBy({
          id: organizationId,
          status: OrganizationStatus.ACTIVE,
        });
        if (!activeOrganization) throw new ConflictException('The organization must be active before membership reactivation.');
      }

      const assignmentRepo = manager.getRepository(OrganizationMembershipRole);
      const activeAssignments = await assignmentRepo.find({
        where: { membershipId, revokedAt: IsNull() },
      });
      const assignedRoles = activeAssignments.length
        ? await manager.getRepository(OrganizationRole).createQueryBuilder('role')
            .where('role.id IN (:...roleIds)', { roleIds: activeAssignments.map((item) => item.roleId) })
            .andWhere('role.is_active = true')
            .andWhere('(role.organization_id IS NULL OR role.organization_id = :organizationId)', { organizationId })
            .getMany()
        : [];
      if (assignedRoles.some((role) => role.key === 'organization_owner')) {
        const otherOwners = await manager.createQueryBuilder()
          .select('COUNT(DISTINCT membership.id)', 'count')
          .from(OrganizationMembership, 'membership')
          .innerJoin(
            OrganizationMembershipRole,
            'assignment',
            'assignment.membership_id = membership.id AND assignment.revoked_at IS NULL',
          )
          .innerJoin(
            OrganizationRole,
            'role',
            'role.id = assignment.role_id AND role.is_active = true AND (role.organization_id IS NULL OR role.organization_id = membership.organization_id)',
          )
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
      if (status === OrganizationMembershipStatus.REMOVED) {
        await assignmentRepo.update(
          { membershipId, revokedAt: IsNull() },
          {
            revokedAt: new Date(),
            revokedByUserId: actorUserId,
            revocationReason: 'Membership removed by an authorized organization administrator.',
          },
        );
      }
      const eventType = status === OrganizationMembershipStatus.SUSPENDED
        ? OrganizationMembershipEventType.MEMBERSHIP_SUSPENDED
        : status === OrganizationMembershipStatus.REMOVED
          ? OrganizationMembershipEventType.MEMBERSHIP_REMOVED
          : OrganizationMembershipEventType.MEMBERSHIP_REACTIVATED;
      await appendOrganizationMembershipEvent(manager, {
        membershipId,
        eventType,
        previousStatus,
        newStatus: status,
        actorUserId,
      });
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
    if (!['organization_admin', 'asset_manager', 'organization_member'].includes(roleKey)) {
      throw new BadRequestException('The selected role cannot be assigned through member management.');
    }
    return this.dataSource.transaction(async (manager) => {
      await this.assertPermission(actorUserId, organizationId, 'organization.roles.manage', manager);
      const membership = await manager.getRepository(OrganizationMembership).createQueryBuilder('membership')
        .setLock('pessimistic_write')
        .where('membership.id = :membershipId', { membershipId })
        .andWhere('membership.organization_id = :organizationId', { organizationId })
        .andWhere('membership.status = :status', { status: OrganizationMembershipStatus.ACTIVE })
        .getOne();
      if (!membership) throw new NotFoundException('Active organization member not found.');
      if (membership.userId === actorUserId) {
        throw new BadRequestException('You cannot change your own organization role.');
      }
      const assignmentRepo = manager.getRepository(OrganizationMembershipRole);
      const currentAssignments = await assignmentRepo.find({
        where: { membershipId, revokedAt: IsNull() },
      });
      const currentRoles = currentAssignments.length
        ? await manager.getRepository(OrganizationRole).createQueryBuilder('role')
            .where('role.id IN (:...roleIds)', { roleIds: currentAssignments.map((item) => item.roleId) })
            .andWhere('(role.organization_id IS NULL OR role.organization_id = :organizationId)', { organizationId })
            .getMany()
        : [];
      if (currentRoles.some((item) => item.key === 'organization_owner' && item.isActive)) {
        const otherOwners = await manager.getRepository(OrganizationMembership).createQueryBuilder('membership')
          .innerJoin(
            OrganizationMembershipRole,
            'assignment',
            'assignment.membership_id = membership.id AND assignment.revoked_at IS NULL',
          )
          .innerJoin(
            OrganizationRole,
            'ownerRole',
            'ownerRole.id = assignment.role_id AND ownerRole.is_active = true AND ownerRole.key = :owner AND (ownerRole.organization_id IS NULL OR ownerRole.organization_id = membership.organization_id)',
            { owner: 'organization_owner' },
          )
          .where('membership.organization_id = :organizationId', { organizationId })
          .andWhere('membership.status = :active', { active: OrganizationMembershipStatus.ACTIVE })
          .andWhere('membership.id != :membershipId', { membershipId })
          .getCount();
        if (otherOwners === 0) throw new ConflictException('The last Organization Owner cannot be demoted.');
      }
      const role = await manager.getRepository(OrganizationRole).findOne({ where: [
        { organizationId: IsNull(), key: roleKey, isActive: true },
        { organizationId, key: roleKey, isActive: true },
      ] });
      if (!role || (role.organizationId !== null && role.organizationId !== organizationId)) {
        throw new BadRequestException('The selected organization role is not available.');
      }
      if (currentAssignments.some((assignment) => assignment.roleId === role.id)) {
        return { membershipId, role: { key: role.key, name: role.name } };
      }
      await assignmentRepo.update(
        { membershipId, revokedAt: IsNull() },
        {
          revokedAt: new Date(),
          revokedByUserId: actorUserId,
          revocationReason: 'Role replaced by an authorized organization administrator.',
        },
      );
      await assignmentRepo.save(
        assignmentRepo.create({ membershipId, roleId: role.id, assignedByUserId: actorUserId }),
      );
      await manager.getRepository(PlatformAuditLog).save({
        actorUserId, action: 'organization.member.role.changed', entityType: 'organization_membership',
        entityId: membershipId, outcome: 'success', reason: null,
        metadata: { organizationId, targetUserId: membership.userId, roleKey },
      });
      return { membershipId, role: { key: role.key, name: role.name } };
    });
  }

  private async assertPermission(
    userId: string,
    organizationId: string,
    permissionKey: string,
    manager?: EntityManager,
  ) {
    const organizationRepository = manager?.getRepository(Organization) ?? this.organizations;
    const membershipRepository = manager?.getRepository(OrganizationMembership) ?? this.memberships;
    const organization = await organizationRepository.findOneBy({ id: organizationId, status: OrganizationStatus.ACTIVE });
    if (!organization) throw new NotFoundException('Active organization workspace not found.');
    const rows = await membershipRepository.createQueryBuilder('membership')
      .innerJoin(
        OrganizationMembershipRole,
        'assignment',
        'assignment.membership_id = membership.id AND assignment.revoked_at IS NULL',
      )
      .innerJoin(
        OrganizationRole,
        'role',
        'role.id = assignment.role_id AND role.is_active = true AND (role.organization_id IS NULL OR role.organization_id = membership.organization_id)',
      )
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

  async getMembershipHistory(actorUserId: string, organizationId: string, membershipId: string) {
    await this.assertPermission(actorUserId, organizationId, 'organization.members.read');
    const membership = await this.memberships.findOneBy({ id: membershipId, organizationId });
    if (!membership) throw new NotFoundException('Organization membership not found.');

    const [events, assignments] = await Promise.all([
      this.dataSource.getRepository(OrganizationMembershipEvent).find({
        where: { membershipId },
        order: { eventSequence: 'ASC' },
      }),
      this.membershipRoles.find({
        where: { membershipId },
        order: { assignedAt: 'ASC' },
      }),
    ]);
    const roles = assignments.length
      ? await this.roles.createQueryBuilder('role')
          .where('role.id IN (:...roleIds)', { roleIds: assignments.map((assignment) => assignment.roleId) })
          .andWhere('(role.organization_id IS NULL OR role.organization_id = :organizationId)', { organizationId })
          .getMany()
      : [];
    const roleMap = new Map(roles.map((role) => [role.id, role]));

    return {
      membership: {
        id: membership.id,
        organizationId: membership.organizationId,
        userId: membership.userId,
        status: membership.status,
        firstJoinedAt: membership.joinedAt,
        createdAt: membership.createdAt,
      },
      events,
      roleAssignments: assignments.flatMap((assignment) => {
        const role = roleMap.get(assignment.roleId);
        if (!role) return [];
        return [{
          id: assignment.id,
          role: { id: role.id, key: role.key, name: role.name },
          assignedByUserId: assignment.assignedByUserId,
          assignedAt: assignment.assignedAt,
          revokedByUserId: assignment.revokedByUserId,
          revokedAt: assignment.revokedAt,
          revocationReason: assignment.revocationReason,
          isRevoked: assignment.revokedAt !== null,
          isEffective: membership.status === OrganizationMembershipStatus.ACTIVE
            && role.isActive
            && assignment.revokedAt === null,
        }];
      }),
    };
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
      const memberRepo = manager.getRepository(OrganizationMembership);
      if (status === OrganizationStatus.ACTIVE) {
        const membership = await memberRepo.createQueryBuilder('membership')
          .setLock('pessimistic_write')
          .where('membership.organization_id = :organizationId', { organizationId: id })
          .andWhere('membership.status = :status', { status: OrganizationMembershipStatus.PENDING })
          .orderBy('membership.created_at', 'ASC')
          .getOne();
        if (membership) {
          const previousMembershipStatus = membership.status;
          membership.status = OrganizationMembershipStatus.ACTIVE;
          membership.joinedAt = membership.joinedAt ?? new Date();
          await memberRepo.save(membership);
          await appendOrganizationMembershipEvent(manager, {
            membershipId: membership.id,
            eventType: OrganizationMembershipEventType.MEMBERSHIP_ACTIVATED,
            previousStatus: previousMembershipStatus,
            newStatus: OrganizationMembershipStatus.ACTIVE,
            actorUserId,
            reason: note?.trim() || null,
            metadata: { source: 'organization_review_approval' },
          });
          const ownerRole = await manager.getRepository(OrganizationRole).findOne({
            where: { organizationId: IsNull(), key: 'organization_owner', isActive: true },
          });
          if (!ownerRole) throw new Error('System organization owner role is missing.');
          const assignmentRepo = manager.getRepository(OrganizationMembershipRole);
          const existingOwnerGrant = await assignmentRepo.findOneBy({
            membershipId: membership.id,
            roleId: ownerRole.id,
            revokedAt: IsNull(),
          });
          if (!existingOwnerGrant) {
            await assignmentRepo.save(assignmentRepo.create({
              membershipId: membership.id,
              roleId: ownerRole.id,
              assignedByUserId: actorUserId,
            }));
          }
        }
      } else if (status === OrganizationStatus.REJECTED) {
        const pendingMemberships = await memberRepo.find({
          where: { organizationId: id, status: OrganizationMembershipStatus.PENDING },
        });
        for (const membership of pendingMemberships) {
          membership.status = OrganizationMembershipStatus.REJECTED;
          await memberRepo.save(membership);
          await appendOrganizationMembershipEvent(manager, {
            membershipId: membership.id,
            eventType: OrganizationMembershipEventType.MEMBERSHIP_REJECTED,
            previousStatus: OrganizationMembershipStatus.PENDING,
            newStatus: OrganizationMembershipStatus.REJECTED,
            actorUserId,
            reason: note?.trim() || null,
            metadata: { source: 'organization_review_rejection' },
          });
        }
        await manager.getRepository(OrganizationOnboardingApplication).update(
          { organizationId: id },
          { status: OrganizationOnboardingStatus.REJECTED },
        );
        const onboardingApplication = await manager.getRepository(OrganizationOnboardingApplication).findOneBy({ organizationId: id });
        if (onboardingApplication) {
          await manager.getRepository(OrganizationOnboardingSession).update(
            { applicationId: onboardingApplication.id, revokedAt: IsNull() },
            { revokedAt: new Date() },
          );
        }
      }
      if (status === OrganizationStatus.SUSPENDED) {
        const onboardingApplication = await manager.getRepository(OrganizationOnboardingApplication).findOneBy({ organizationId: id });
        if (onboardingApplication) {
          await manager.getRepository(OrganizationOnboardingSession).update(
            { applicationId: onboardingApplication.id, revokedAt: IsNull() },
            { revokedAt: new Date() },
          );
        }
      }
      await manager.getRepository(PlatformAuditLog).save({
        actorUserId, action: 'organization.status.changed', entityType: 'organization', entityId: id,
        outcome: 'success', reason: note?.trim() || null, metadata: { previousStatus, newStatus: status },
      });
      return orgRepo.findOneByOrFail({ id });
    });
  }

}
