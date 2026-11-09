import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PlatformRole } from '../platform-governance/entities/platform-role.entity';
import { User } from '../identity/entities/user.entity';
import { PlatformAuditLog } from '../audit/entities/platform-audit-log.entity';
import { OrganizationRole } from './entities/organization-role.entity';
import { OrganizationMembershipRole } from './entities/organization-membership-role.entity';
import { OrganizationRolePermission } from './entities/organization-role-permission.entity';
import { PlatformRolePermission } from './entities/platform-role-permission.entity';
import { Permission } from './entities/permission.entity';
import { PlatformAccessController } from './platform-access.controller';
import { PlatformUsersController } from './platform-users.controller';
import { PlatformPermissionGuard } from './platform-permission.guard';

@Module({
  imports: [TypeOrmModule.forFeature([
    PlatformRole, PlatformRolePermission, OrganizationRole,
    OrganizationMembershipRole, OrganizationRolePermission, Permission,
    User, PlatformAuditLog,
  ])],
  controllers: [PlatformAccessController, PlatformUsersController],
  providers: [PlatformPermissionGuard],
  exports: [TypeOrmModule, PlatformPermissionGuard],
})
export class AccessControlModule {}
