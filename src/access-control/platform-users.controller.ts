import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { DataSource, In, IsNull, Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import type { AuthenticatedIdentity } from '../auth/auth.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PlatformAuditLog } from '../audit/entities/platform-audit-log.entity';
import { User, UserApprovalStatus, UserStatus } from '../identity/entities/user.entity';
import { PlatformRole } from '../platform-governance/entities/platform-role.entity';
import { PlatformPermissionGuard } from './platform-permission.guard';
import { RequirePlatformPermission } from './platform-permission.decorator';

type AuthenticatedRequest = Request & { user: AuthenticatedIdentity };

@Controller('platform/users')
@UseGuards(JwtAuthGuard, PlatformPermissionGuard)
export class PlatformUsersController {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(PlatformRole) private readonly platformRoles: Repository<PlatformRole>,
    private readonly dataSource: DataSource,
  ) {}

  @Get()
  @RequirePlatformPermission('platform.users.read')
  async list() {
    const users = await this.users.find({
      select: {
        id: true,
        fullName: true,
        email: true,
        status: true,
        approvalStatus: true,
        approvalReviewedAt: true,
        approvalNote: true,
        emailVerifiedAt: true,
        lastLoginAt: true,
        createdAt: true,
        deactivatedAt: true,
      },
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

  @Patch(':userId/approval')
  @RequirePlatformPermission('platform.users.review')
  async review(
    @Param('userId') userId: string,
    @Req() request: AuthenticatedRequest,
    @Body() body: { decision: 'approve' | 'reject'; note?: string },
  ) {
    if (!body || !['approve', 'reject'].includes(body.decision)) {
      throw new BadRequestException('Choose whether to approve or reject this registration.');
    }
    const note = typeof body.note === 'string' ? body.note.trim() : '';
    if (note.length > 500 || (body.decision === 'reject' && !note)) {
      throw new BadRequestException('A rejection reason of up to 500 characters is required.');
    }

    return this.dataSource.transaction(async (manager) => {
      const userRepo = manager.getRepository(User);
      const user = await userRepo.createQueryBuilder('user')
        .setLock('pessimistic_write')
        .where('user.id = :userId', { userId })
        .getOne();

      if (!user) throw new NotFoundException('The user account was not found.');
      if (user.id === request.user.id) {
        throw new ConflictException('You cannot review your own account.');
      }
      if (user.approvalStatus !== UserApprovalStatus.PENDING_REVIEW) {
        throw new ConflictException('This account is no longer awaiting review.');
      }

      const activePlatformRoles = await manager.getRepository(PlatformRole).find({
        where: { userId, revokedAt: IsNull() },
      });
      if (activePlatformRoles.length) {
        throw new ConflictException('Accounts with platform-wide roles cannot be reviewed through registration approvals.');
      }

      const previousStatus = user.approvalStatus;
      user.approvalStatus = body.decision === 'approve'
        ? UserApprovalStatus.APPROVED
        : UserApprovalStatus.REJECTED;
      user.approvalReviewedByUserId = request.user.id;
      user.approvalReviewedAt = new Date();
      user.approvalNote = note || null;
      user.status = body.decision === 'approve'
        ? UserStatus.ACTIVE
        : UserStatus.INACTIVE;

      await userRepo.save(user);
      await manager.getRepository(PlatformAuditLog).save({
        actorUserId: request.user.id,
        action: body.decision === 'approve' ? 'platform.user.approved' : 'platform.user.rejected',
        entityType: 'user',
        entityId: user.id,
        outcome: 'success',
        reason: note || null,
        metadata: {
          previousApprovalStatus: previousStatus,
          approvalStatus: user.approvalStatus,
          emailVerified: Boolean(user.emailVerifiedAt),
          emailVerificationRequiredForLogin: false,
          accountStatus: user.status,
        },
      });

      return {
        id: user.id,
        fullName: user.fullName,
        email: user.email,
        status: user.status,
        approvalStatus: user.approvalStatus,
        emailVerifiedAt: user.emailVerifiedAt,
        approvalReviewedAt: user.approvalReviewedAt,
        approvalNote: user.approvalNote,
      };
    });
  }
}
