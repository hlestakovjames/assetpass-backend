import { BadRequestException, Body, ConflictException, Controller, Delete, Get, NotFoundException, Param, Post, Put, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
import { AuthenticatedIdentity } from '../auth/auth.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PlatformRole, PlatformRoleName } from '../platform-governance/entities/platform-role.entity';
import { PlatformAuditLog } from '../audit/entities/platform-audit-log.entity';
import { User, UserStatus } from '../identity/entities/user.entity';
import { Permission, PermissionScope } from './entities/permission.entity';
import { PlatformRolePermission } from './entities/platform-role-permission.entity';
import { PlatformPermissionGuard } from './platform-permission.guard';
import { RequirePlatformOwner, RequirePlatformPermission } from './platform-permission.decorator';

type AuthenticatedRequest = Request & { user: AuthenticatedIdentity };

@Controller('platform')
@UseGuards(JwtAuthGuard, PlatformPermissionGuard)
export class PlatformAccessController {
  constructor(
    @InjectRepository(Permission) private readonly permissions: Repository<Permission>,
    @InjectRepository(PlatformRole) private readonly platformRoles: Repository<PlatformRole>,
    @InjectRepository(PlatformRolePermission) private readonly grants: Repository<PlatformRolePermission>,
    @InjectRepository(PlatformAuditLog) private readonly auditLogs: Repository<PlatformAuditLog>,
    @InjectRepository(User) private readonly users: Repository<User>,
  ) {}

  @Get('permissions')
  @RequirePlatformOwner()
  listPermissions() {
    return this.permissions.find({ order: { scope: 'ASC', key: 'ASC' } });
  }

  @Get('administrators')
  @RequirePlatformOwner()
  async listAdministrators() {
    const roles = await this.platformRoles.find({
      where: { role: PlatformRoleName.ADMINISTRATOR, revokedAt: IsNull() },
      order: { assignedAt: 'DESC' },
    });
    if (!roles.length) return [];
    const userIds = roles.map((role) => role.userId);
    const users = await this.users.find({
      where: { id: In(userIds) },
      select: { id: true, fullName: true, email: true, status: true },
    });
    const grants = await this.grants.find({ where: { platformRoleId: In(roles.map((role) => role.id)) } });
    const permissions = grants.length
      ? await this.permissions.find({ where: { id: In(grants.map((grant) => grant.permissionId)) } })
      : [];
    const permissionMap = new Map(permissions.map((permission) => [permission.id, permission.key]));
    const userMap = new Map(users.map((user) => [user.id, user]));
    return roles.map((role) => ({
      roleId: role.id,
      assignedAt: role.assignedAt,
      reason: role.reason,
      user: userMap.get(role.userId) ?? null,
      permissionKeys: grants.filter((grant) => grant.platformRoleId === role.id)
        .map((grant) => permissionMap.get(grant.permissionId))
        .filter((key): key is string => Boolean(key)),
    }));
  }

  @Post('administrators')
  @RequirePlatformOwner()
  async assignAdministrator(@Req() request: AuthenticatedRequest, @Body() body: { userId: string; reason: string }) {
    if (!body || typeof body.userId !== 'string' || typeof body.reason !== 'string' || !body.reason.trim()) {
      throw new BadRequestException('A userId and assignment reason are required.');
    }
    const user = await this.users.findOne({
      where: { id: body.userId },
      select: { id: true, status: true },
    });
    if (!user || user.status !== UserStatus.ACTIVE) throw new NotFoundException('An active user account was not found.');
    const existing = await this.platformRoles.findOne({
      where: { userId: body.userId, role: PlatformRoleName.ADMINISTRATOR, revokedAt: IsNull() },
    });
    if (existing) throw new ConflictException('This user is already an active Platform Administrator.');
    const role = await this.platformRoles.save(this.platformRoles.create({
      userId: body.userId,
      role: PlatformRoleName.ADMINISTRATOR,
      assignedByUserId: request.user.id,
      revokedAt: null,
      reason: body.reason.trim(),
    }));
    await this.auditLogs.save({
      actorUserId: request.user.id,
      action: 'platform.administrator.assigned',
      entityType: 'platform_role',
      entityId: role.id,
      outcome: 'success',
      reason: body.reason.trim(),
      metadata: { targetUserId: body.userId, role: PlatformRoleName.ADMINISTRATOR },
    });
    return { roleId: role.id, userId: role.userId, role: role.role, assignedAt: role.assignedAt };
  }

  @Delete('administrators/:userId')
  @RequirePlatformOwner()
  async revokeAdministrator(@Param('userId') userId: string, @Req() request: AuthenticatedRequest) {
    const role = await this.platformRoles.findOne({
      where: { userId, role: PlatformRoleName.ADMINISTRATOR, revokedAt: IsNull() },
    });
    if (!role) throw new NotFoundException('Active Platform Administrator not found.');
    role.revokedAt = new Date();
    await this.platformRoles.save(role);
    await this.auditLogs.save({
      actorUserId: request.user.id,
      action: 'platform.administrator.revoked',
      entityType: 'platform_role',
      entityId: role.id,
      outcome: 'success',
      reason: 'Platform Administrator access revoked by Platform Owner.',
      metadata: { targetUserId: userId },
    });
    return { userId, revoked: true };
  }

  @Get('administrators/:userId/permissions')
  @RequirePlatformOwner()
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
  @RequirePlatformOwner()
  async replaceAdministratorPermissions(
    @Param('userId') userId: string,
    @Req() request: AuthenticatedRequest,
    @Body() body: { permissionKeys: string[] },
  ) {
    if (!body || !Array.isArray(body.permissionKeys) || body.permissionKeys.length > 100 || body.permissionKeys.some((key) => typeof key !== 'string')) {
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
