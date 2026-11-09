import { Controller, Get, UseGuards } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { User } from '../identity/entities/user.entity';
import { PlatformRole } from '../platform-governance/entities/platform-role.entity';
import { PlatformPermissionGuard } from './platform-permission.guard';
import { RequirePlatformPermission } from './platform-permission.decorator';

@Controller('platform/users')
@UseGuards(JwtAuthGuard, PlatformPermissionGuard)
export class PlatformUsersController {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(PlatformRole) private readonly platformRoles: Repository<PlatformRole>,
  ) {}

  @Get()
  @RequirePlatformPermission('platform.users.read')
  async list() {
    const users = await this.users.find({
      select: { id: true, fullName: true, email: true, status: true, lastLoginAt: true, createdAt: true, deactivatedAt: true },
      order: { createdAt: 'DESC' },
      take: 200,
    });
    if (!users.length) return [];
    const roles = await this.platformRoles.find({ where: { userId: In(users.map((user) => user.id)) } });
    const roleMap = new Map<string, string[]>();
    for (const role of roles) {
      if (role.revokedAt) continue;
      roleMap.set(role.userId, [...(roleMap.get(role.userId) ?? []), role.role]);
    }
    return users.map((user) => ({ ...user, platformRoles: roleMap.get(user.id) ?? [] }));
  }
}
