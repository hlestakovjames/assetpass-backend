import { ForbiddenException } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { PlatformAuditLog } from '../audit/entities/platform-audit-log.entity';
import { Permission } from '../access-control/entities/permission.entity';
import { OrganizationMembershipRole } from '../access-control/entities/organization-membership-role.entity';
import { OrganizationRole } from '../access-control/entities/organization-role.entity';
import { OrganizationRolePermission } from '../access-control/entities/organization-role-permission.entity';
import { User } from '../identity/entities/user.entity';
import { Organization, OrganizationStatus } from './entities/organization.entity';
import { OrganizationMembership } from './entities/organization-membership.entity';
import { OrganizationsService } from './organizations.service';

describe('OrganizationsService organization authorization', () => {
  const organizationId = '4f4b2c6d-0a32-4b5c-8f6c-b8e4c7b0a111';
  const userId = '7d0f9c52-5e6f-4c91-9d4d-1a0a3b2c4d55';

  function createService() {
    const queryBuilder = {
      innerJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getCount: jest.fn().mockResolvedValue(0),
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
    return { service, queryBuilder, users };
  }

  it('denies workspace access when the user has no active organization permission', async () => {
    const { service, queryBuilder } = createService();

    await expect(service.getWorkspace(userId, organizationId)).rejects.toBeInstanceOf(ForbiddenException);

    expect(queryBuilder.getCount).toHaveBeenCalledTimes(1);
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
});
