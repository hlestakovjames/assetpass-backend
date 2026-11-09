import { BadRequestException, Body, Controller, Get, NotFoundException, Param, Put, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
import { AuthenticatedIdentity } from '../auth/auth.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PlatformRole, PlatformRoleName } from '../platform-governance/entities/platform-role.entity';
import { PlatformAuditLog } from '../audit/entities/platform-audit-log.entity';
import { Permission, PermissionScope } from './entities/permission.entity';
import { PlatformRolePermission } from './entities/platform-role-permission.entity';
import { PlatformPermissionGuard } from './platform-permission.guard';
import { RequirePlatformPermission } from './platform-permission.decorator';

type AuthenticatedRequest = Request & { user: AuthenticatedIdentity };

@Controller('platform')
@UseGuards(JwtAuthGuard, PlatformPermissionGuard)
export class PlatformAccessController {
  constructor(
    @InjectRepository(Permission) private readonly permissions: Repository<Permission>,
    @InjectRepository(PlatformRole) private readonly platformRoles: Repository<PlatformRole>,
    @InjectRepository(PlatformRolePermission) private readonly grants: Repository<PlatformRolePermission>,
    @InjectRepository(PlatformAuditLog) private readonly auditLogs: Repository<PlatformAuditLog>,
  ) {}

  @Get('permissions')
  @RequirePlatformPermission('platform.roles.manage')
  listPermissions() {
    return this.permissions.find({ order: { scope: 'ASC', key: 'ASC' } });
  }

  @Get('administrators/:userId/permissions')
  @RequirePlatformPermission('platform.roles.manage')
  async getAdministratorPermissions(@Param('userId') userId: string) {
    const role = await this.platformRoles.findOne({
      where: { userId, role: PlatformRoleName.ADMINISTRATOR, revokedAt: IsNull() },
    });
    if (!role) throw new NotFoundException('Active Platform Administrator not found.');
    return this.grants.createQueryBuilder('grant')
      .innerJoin(Permission, 'permission', 'permission.id = grant.permission_id')
      .where('grant.platform_role_id = :roleId', { roleId: role.id })
      .select(['permission.key AS key', 'permission.name AS name'])
      .orderBy('permission.key', 'ASC')
      .getRawMany();
  }

  @Put('administrators/:userId/permissions')
  @RequirePlatformPermission('platform.roles.manage')
  async replaceAdministratorPermissions(
    @Param('userId') userId: string,
    @Req() request: AuthenticatedRequest,
    @Body() body: { permissionKeys: string[] },
  ) {
    if (!Array.isArray(body.permissionKeys) || body.permissionKeys.length > 100 || body.permissionKeys.some((key) => typeof key !== 'string')) {
      throw new BadRequestException('Provide a valid permissionKeys array.');
    }
    const role = await this.platformRoles.findOne({
      where: { userId, role: PlatformRoleName.ADMINISTRATOR, revokedAt: IsNull() },
    });
    if (!role) throw new NotFoundException('Active Platform Administrator not found.');
    const keys = [...new Set(body.permissionKeys)];
    const permissions = keys.length
      ? await this.permissions.find({ where: { key: In(keys), scope: PermissionScope.PLATFORM } })
      : [];
    if (permissions.length !== keys.length) throw new BadRequestException('One or more permission keys are invalid or not platform-scoped.');

    await this.grants.manager.transaction(async (manager) => {
      await manager.getRepository(PlatformRolePermission).delete({ platformRoleId: role.id });
      if (permissions.length) {
        await manager.getRepository(PlatformRolePermission).insert(permissions.map((permission) => ({
          platformRoleId: role.id, permissionId: permission.id, grantedByUserId: request.user.id,
        })));
      }
      await manager.getRepository(PlatformAuditLog).save({
        actorUserId: request.user.id,
        action: 'platform.administrator.permissions.replaced',
        entityType: 'platform_role',
        entityId: role.id,
        outcome: 'success',
        reason: null,
        metadata: { targetUserId: userId, permissionKeys: keys },
      });
    });
    return { userId, permissionKeys: keys };
  }
}
