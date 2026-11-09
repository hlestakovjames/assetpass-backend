import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { PlatformRole, PlatformRoleName } from '../platform-governance/entities/platform-role.entity';
import { Permission } from './entities/permission.entity';
import { PlatformRolePermission } from './entities/platform-role-permission.entity';
import { PLATFORM_OWNER_ONLY_KEY, PLATFORM_PERMISSION_KEY } from './platform-permission.decorator';

@Injectable()
export class PlatformPermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @InjectRepository(PlatformRole) private readonly platformRoles: Repository<PlatformRole>,
    @InjectRepository(PlatformRolePermission) private readonly grants: Repository<PlatformRolePermission>,
    @InjectRepository(Permission) private readonly permissions: Repository<Permission>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const ownerOnly = this.reflector.getAllAndOverride<boolean>(PLATFORM_OWNER_ONLY_KEY, [context.getHandler(), context.getClass()]);
    const key = this.reflector.getAllAndOverride<string>(PLATFORM_PERMISSION_KEY, [context.getHandler(), context.getClass()]);
    if (!ownerOnly && !key) return true;
    const request = context.switchToHttp().getRequest<{ user?: { id?: string } }>();
    const userId = request.user?.id;
    if (!userId) throw new ForbiddenException('Platform access is required.');
    const roles = await this.platformRoles.find({ where: { userId, revokedAt: IsNull() } });
    const owner = roles.some((role) => role.role === PlatformRoleName.OWNER);
    if (owner) return true;
    if (ownerOnly) throw new ForbiddenException('Only the Platform Owner can perform this action.');
    const administrator = roles.find((role) => role.role === PlatformRoleName.ADMINISTRATOR);
    if (!administrator || !key) throw new ForbiddenException('Platform access is required.');
    const permission = await this.permissions.findOneBy({ key });
    if (!permission) throw new ForbiddenException('Permission is not registered.');
    const grant = await this.grants.findOneBy({ platformRoleId: administrator.id, permissionId: permission.id });
    if (!grant) throw new ForbiddenException('You do not have permission to perform this action.');
    return true;
  }
}
