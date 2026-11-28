import { ForbiddenException } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { PlatformAuditLog } from '../audit/entities/platform-audit-log.entity';
import { Permission } from '../access-control/entities/permission.entity';
import { OrganizationMembershipRole } from '../access-control/entities/organization-membership-role.entity';
import { OrganizationRole } from '../access-control/entities/organization-role.entity';
import { OrganizationRolePermission } from '../access-control/entities/organization-role-permission.entity';
import { User } from '../identity/entities/user.entity';
import { Organization, OrganizationStatus } from './entities/organization.entity';
import { OrganizationMembership, OrganizationMembershipStatus } from './entities/organization-membership.entity';
import { OrganizationMembershipEvent, OrganizationMembershipEventType } from './entities/organization-membership-event.entity';
import { OrganizationsService } from './organizations.service';

describe('OrganizationsService organization authorization and membership history', () => {
  const organizationId = '4f4b2c6d-0a32-4b5c-8f6c-b8e4c7b0a111';
  const userId = '7d0f9c52-5e6f-4c91-9d4d-1a0a3b2c4d55';

  function createService(permissionCount = 0) {
    const queryBuilder = {
      innerJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getCount: jest.fn().mockResolvedValue(permissionCount),
    };
    const organizations = {
      findOneBy: jest.fn().mockResolvedValue({
        id: organizationId,
        status: OrganizationStatus.ACTIVE,
      }),
    };
    const memberships = {
      createQueryBuilder: jest.fn().mockReturnValue(queryBuilder),
    };
    const users = { findOne: jest.fn() };
    const service = new OrganizationsService(
      {} as DataSource,
      organizations as unknown as Repository<Organization>,
      memberships as unknown as Repository<OrganizationMembership>,
      {} as Repository<OrganizationRole>,
      {} as Repository<OrganizationMembershipRole>,
      {} as Repository<OrganizationRolePermission>,
      {} as Repository<Permission>,
      users as unknown as Repository<User>,
    );
    return { service, queryBuilder, users, organizations, memberships };
  }

  it('denies workspace access when the user has no active organization permission', async () => {
    const { service, queryBuilder } = createService();

    await expect(service.getWorkspace(userId, organizationId)).rejects.toBeInstanceOf(ForbiddenException);

    expect(queryBuilder.getCount).toHaveBeenCalledTimes(1);
    expect(queryBuilder.innerJoin).toHaveBeenCalledWith(
      OrganizationMembershipRole,
      'assignment',
      expect.stringContaining('assignment.revoked_at IS NULL'),
    );
    expect(queryBuilder.innerJoin).toHaveBeenCalledWith(
      OrganizationRole,
      'role',
      expect.stringContaining('role.organization_id = membership.organization_id'),
    );
  });

  it('denies member invitations before looking up the invited account when the actor lacks permission', async () => {
    const { service, queryBuilder, users } = createService();

    await expect(service.inviteMember(userId, organizationId, {
      email: 'new.member@example.com',
      roleKey: 'organization_member',
    })).rejects.toBeInstanceOf(ForbiddenException);

    expect(queryBuilder.getCount).toHaveBeenCalledTimes(1);
    expect(users.findOne).not.toHaveBeenCalled();
  });

  it('revokes active role assignments and appends a removal event atomically', async () => {
    const membership = {
      id: 'membership-id',
      organizationId,
      userId: 'target-user-id',
      status: OrganizationMembershipStatus.ACTIVE,
      joinedAt: new Date('2024-03-01T00:00:00.000Z'),
    };
    const permission = createService(1);
    const lockQueryBuilder = {
      setLock: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(membership),
    };
    const permissionBuilder = {
      innerJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getCount: jest.fn().mockResolvedValue(1),
    };
    const membershipRepository = {
      createQueryBuilder: jest.fn()
        .mockReturnValueOnce(permissionBuilder)
        .mockReturnValue(lockQueryBuilder),
      save: jest.fn().mockImplementation(async (value) => value),
    };
    const organizationRepository = {
      findOneBy: jest.fn().mockResolvedValue({ id: organizationId, status: OrganizationStatus.ACTIVE }),
    };
    const assignmentRepository = {
      find: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      delete: jest.fn(),
    };
    const eventRepository = {
      create: jest.fn((value) => value),
      save: jest.fn().mockImplementation(async (value) => value),
    };
    const auditRepository = { save: jest.fn().mockResolvedValue(undefined) };
    const manager = {
      getRepository: jest.fn((entity) => {
        if (entity === Organization) return organizationRepository;
        if (entity === OrganizationMembership) return membershipRepository;
        if (entity === OrganizationMembershipRole) return assignmentRepository;
        if (entity === OrganizationMembershipEvent) return eventRepository;
        if (entity === PlatformAuditLog) return auditRepository;
        throw new Error('Unexpected repository requested.');
      }),
    };
    const dataSource = {
      transaction: jest.fn(async (callback) => callback(manager)),
    } as unknown as DataSource;
    const service = new OrganizationsService(
      dataSource,
      permission.organizations as unknown as Repository<Organization>,
      permission.memberships as unknown as Repository<OrganizationMembership>,
      {} as Repository<OrganizationRole>,
      {} as Repository<OrganizationMembershipRole>,
      {} as Repository<OrganizationRolePermission>,
      {} as Repository<Permission>,
      permission.users as unknown as Repository<User>,
    );

    const result = await service.changeMemberStatus(
      userId,
      organizationId,
      membership.id,
      OrganizationMembershipStatus.REMOVED,
    );

    expect(result).toEqual({
      membershipId: membership.id,
      status: OrganizationMembershipStatus.REMOVED,
    });
    expect(membership.joinedAt).toEqual(new Date('2024-03-01T00:00:00.000Z'));
    expect(assignmentRepository.update).toHaveBeenCalledWith(
      { membershipId: membership.id, revokedAt: expect.anything() },
      expect.objectContaining({
        revokedAt: expect.any(Date),
        revokedByUserId: userId,
        revocationReason: expect.stringContaining('Membership removed'),
      }),
    );
    expect(assignmentRepository.delete).not.toHaveBeenCalled();
    expect(eventRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        membershipId: membership.id,
        eventType: OrganizationMembershipEventType.MEMBERSHIP_REMOVED,
        previousStatus: OrganizationMembershipStatus.ACTIVE,
        newStatus: OrganizationMembershipStatus.REMOVED,
        actorUserId: userId,
      }),
    );
  });

  it('preserves the first joined_at date when a removed member accepts a fresh invitation', async () => {
    const firstJoinedAt = new Date('2022-08-17T00:00:00.000Z');
    const membership = {
      id: 'membership-id',
      organizationId,
      userId,
      status: OrganizationMembershipStatus.PENDING,
      joinedAt: firstJoinedAt,
    };
    const membershipQueryBuilder = {
      setLock: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(membership),
    };
    const membershipRepository = {
      createQueryBuilder: jest.fn().mockReturnValue(membershipQueryBuilder),
      save: jest.fn().mockImplementation(async (value) => value),
    };
    const organizationRepository = {
      findOneBy: jest.fn().mockResolvedValue({ id: organizationId, status: OrganizationStatus.ACTIVE }),
    };
    const eventRepository = {
      create: jest.fn((value) => value),
      save: jest.fn().mockImplementation(async (value) => value),
    };
    const auditRepository = { save: jest.fn().mockResolvedValue(undefined) };
    const manager = {
      getRepository: jest.fn((entity) => {
        if (entity === OrganizationMembership) return membershipRepository;
        if (entity === Organization) return organizationRepository;
        if (entity === OrganizationMembershipEvent) return eventRepository;
        if (entity === PlatformAuditLog) return auditRepository;
        throw new Error('Unexpected repository requested.');
      }),
    };
    const dataSource = {
      transaction: jest.fn(async (callback) => callback(manager)),
    } as unknown as DataSource;
    const base = createService();
    const service = new OrganizationsService(
      dataSource,
      base.organizations as unknown as Repository<Organization>,
      base.memberships as unknown as Repository<OrganizationMembership>,
      {} as Repository<OrganizationRole>,
      {} as Repository<OrganizationMembershipRole>,
      {} as Repository<OrganizationRolePermission>,
      {} as Repository<Permission>,
      base.users as unknown as Repository<User>,
    );

    const result = await service.acceptInvitation(userId, organizationId, membership.id);

    expect(result.status).toBe(OrganizationMembershipStatus.ACTIVE);
    expect(result.joinedAt).toEqual(firstJoinedAt);
    expect(membership.joinedAt).toEqual(firstJoinedAt);
    expect(eventRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        membershipId: membership.id,
        eventType: OrganizationMembershipEventType.MEMBERSHIP_REJOINED,
        previousStatus: OrganizationMembershipStatus.PENDING,
        newStatus: OrganizationMembershipStatus.ACTIVE,
        actorUserId: userId,
      }),
    );
  });

  it('retains the previous role assignment when a member role is changed', async () => {
    const membership = {
      id: 'membership-id',
      organizationId,
      userId: 'target-user-id',
      status: OrganizationMembershipStatus.ACTIVE,
    };
    const permission = createService(1);
    const lockQueryBuilder = {
      setLock: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(membership),
    };
    const permissionBuilder = {
      innerJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getCount: jest.fn().mockResolvedValue(1),
    };
    const membershipRepository = {
      createQueryBuilder: jest.fn()
        .mockReturnValueOnce(permissionBuilder)
        .mockReturnValue(lockQueryBuilder),
    };
    const organizationRepository = {
      findOneBy: jest.fn().mockResolvedValue({ id: organizationId, status: OrganizationStatus.ACTIVE }),
    };
    const oldAssignment = { id: 'old-assignment-id', membershipId: membership.id, roleId: 'old-role-id', revokedAt: null };
    const assignmentRepository = {
      find: jest.fn().mockResolvedValue([oldAssignment]),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      create: jest.fn((value) => value),
      save: jest.fn().mockImplementation(async (value) => value),
      delete: jest.fn(),
    };
    const oldRole = { id: 'old-role-id', key: 'asset_manager', name: 'Asset Manager', isActive: true, organizationId: null };
    const newRole = { id: 'new-role-id', key: 'organization_member', name: 'Organization Member', isActive: true, organizationId: null };
    const roleQueryBuilder = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([oldRole]),
    };
    const roleRepository = {
      createQueryBuilder: jest.fn().mockReturnValue(roleQueryBuilder),
      findOne: jest.fn().mockResolvedValue(newRole),
    };
    const auditRepository = { save: jest.fn().mockResolvedValue(undefined) };
    const manager = {
      getRepository: jest.fn((entity) => {
        if (entity === Organization) return organizationRepository;
        if (entity === OrganizationMembership) return membershipRepository;
        if (entity === OrganizationMembershipRole) return assignmentRepository;
        if (entity === OrganizationRole) return roleRepository;
        if (entity === PlatformAuditLog) return auditRepository;
        throw new Error('Unexpected repository requested.');
      }),
    };
    const dataSource = {
      transaction: jest.fn(async (callback) => callback(manager)),
    } as unknown as DataSource;
    const service = new OrganizationsService(
      dataSource,
      permission.organizations as unknown as Repository<Organization>,
      permission.memberships as unknown as Repository<OrganizationMembership>,
      roleRepository as unknown as Repository<OrganizationRole>,
      assignmentRepository as unknown as Repository<OrganizationMembershipRole>,
      {} as Repository<OrganizationRolePermission>,
      {} as Repository<Permission>,
      permission.users as unknown as Repository<User>,
    );

    const result = await service.changeMemberRole(userId, organizationId, membership.id, 'organization_member');

    expect(result.role).toEqual({ key: 'organization_member', name: 'Organization Member' });
    expect(assignmentRepository.update).toHaveBeenCalledWith(
      { membershipId: membership.id, revokedAt: expect.anything() },
      expect.objectContaining({
        revokedAt: expect.any(Date),
        revokedByUserId: userId,
        revocationReason: expect.stringContaining('Role replaced'),
      }),
    );
    expect(assignmentRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        membershipId: membership.id,
        roleId: newRole.id,
        assignedByUserId: userId,
      }),
    );
    expect(assignmentRepository.delete).not.toHaveBeenCalled();
  });
});
