import {
  BadRequestException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import {
  createHash,
  createHmac,
  randomBytes,
} from 'node:crypto';
import { DataSource, EntityManager, IsNull } from 'typeorm';

import { PlatformAuditLog } from '../audit/entities/platform-audit-log.entity';
import {
  User,
  UserApprovalStatus,
  UserStatus,
} from '../identity/entities/user.entity';
import { AuthSession } from './auth-session.entity';
import { EmailDeliveryService } from './email-delivery.service';
import { PasswordResetRequestEvent } from './entities/password-reset-request-event.entity';
import { PasswordResetToken } from './entities/password-reset-token.entity';

export interface PasswordRecoveryMetadata {
  sourceIp?: string | null;
  userAgent?: string | null;
}

const GENERIC_RESET_MESSAGE =
  'If an account exists for that email address, password reset instructions will be sent shortly.';
const MIN_PASSWORD_LENGTH = 12;
const MAX_PASSWORD_LENGTH = 1024;
const RESET_TOKEN_TTL_MINUTES = 15;

@Injectable()
export class PasswordRecoveryService {
  private readonly logger = new Logger(PasswordRecoveryService.name);
  private readonly emailHashSecret: string;

  constructor(
    private readonly dataSource: DataSource,
    private readonly config: ConfigService,
    private readonly emailDelivery: EmailDeliveryService,
  ) {
    this.emailHashSecret = this.config.getOrThrow<string>('JWT_ACCESS_SECRET');
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private hashEmail(email: string): string {
    return createHmac('sha256', this.emailHashSecret)
      .update(email)
      .digest('hex');
  }

  private validateNewPassword(password: unknown): asserts password is string {
    if (
      typeof password !== 'string' ||
      password.length < MIN_PASSWORD_LENGTH ||
      password.length > MAX_PASSWORD_LENGTH
    ) {
      throw new BadRequestException(
        `Use a password containing at least ${MIN_PASSWORD_LENGTH} characters.`,
      );
    }
  }

  private async recordAndCheckRequestLimit(
    manager: EntityManager,
    emailHash: string,
    sourceIp: string | null,
  ): Promise<boolean> {
    await manager.query(
      'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
      [`password-reset-email:${emailHash}`],
    );

    if (sourceIp) {
      await manager.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        [`password-reset-ip:${sourceIp}`],
      );
    }

    await manager.query(
      `DELETE FROM password_reset_request_events
       WHERE created_at < NOW() - INTERVAL '24 hours'`,
    );

    const emailCounts = (await manager.query(
      `SELECT COUNT(*)::int AS count
       FROM password_reset_request_events
       WHERE email_hash = $1
         AND created_at > NOW() - INTERVAL '15 minutes'`,
      [emailHash],
    )) as Array<{ count: number }>;

    const emailLimitReached = Number(emailCounts[0]?.count ?? 0) >= 3;
    let ipLimitReached = false;

    if (sourceIp) {
      const ipCounts = (await manager.query(
        `SELECT COUNT(*)::int AS count
         FROM password_reset_request_events
         WHERE requested_ip = $1
           AND created_at > NOW() - INTERVAL '1 hour'`,
        [sourceIp],
      )) as Array<{ count: number }>;
      ipLimitReached = Number(ipCounts[0]?.count ?? 0) >= 10;
    }

    if (emailLimitReached || ipLimitReached) return false;

    await manager.getRepository(PasswordResetRequestEvent).save(
      manager.getRepository(PasswordResetRequestEvent).create({
        emailHash,
        requestedIp: sourceIp,
      }),
    );

    return true;
  }

  async requestPasswordReset(
    emailInput: unknown,
    metadata: PasswordRecoveryMetadata = {},
  ): Promise<{ message: string }> {
    if (typeof emailInput !== 'string' || emailInput.length > 320) {
      return { message: GENERIC_RESET_MESSAGE };
    }

    const email = emailInput.trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return { message: GENERIC_RESET_MESSAGE };
    }

    const emailHash = this.hashEmail(email);
    const sourceIp = metadata.sourceIp ?? null;

    const request = await this.dataSource.transaction(async (manager) => {
      const allowed = await this.recordAndCheckRequestLimit(
        manager,
        emailHash,
        sourceIp,
      );

      if (!allowed) return null;

      const user = await manager.getRepository(User).findOne({
        where: { email },
        select: { id: true, fullName: true, email: true },
      });

      if (!user) return null;

      const lockedUser = await manager.getRepository(User).findOne({
        where: { id: user.id },
        lock: { mode: 'pessimistic_write' },
        select: { id: true, fullName: true, email: true },
      });

      if (!lockedUser) return null;

      const now = new Date();
      await manager.getRepository(PasswordResetToken).update(
        { userId: lockedUser.id, usedAt: IsNull(), invalidatedAt: IsNull() },
        { invalidatedAt: now },
      );

      const token = randomBytes(32).toString('base64url');
      await manager.getRepository(PasswordResetToken).save(
        manager.getRepository(PasswordResetToken).create({
          userId: lockedUser.id,
          tokenHash: this.hashToken(token),
          expiresAt: new Date(
            now.getTime() + RESET_TOKEN_TTL_MINUTES * 60 * 1000,
          ),
          usedAt: null,
          invalidatedAt: null,
          requestedIp: sourceIp,
        }),
      );

      return {
        userId: lockedUser.id,
        email: lockedUser.email,
        fullName: lockedUser.fullName,
        token,
      };
    });

    if (request) {
      try {
        await this.emailDelivery.sendPasswordResetEmail(
          request.email,
          request.fullName,
          request.token,
        );
      } catch {
        await this.dataSource.getRepository(PasswordResetToken).update(
          { userId: request.userId, tokenHash: this.hashToken(request.token) },
          { invalidatedAt: new Date() },
        );
        this.logger.warn('Password reset email delivery failed.');
      }
    }

    return { message: GENERIC_RESET_MESSAGE };
  }

  async resetPassword(
    tokenInput: unknown,
    newPasswordInput: unknown,
    metadata: PasswordRecoveryMetadata = {},
  ): Promise<void> {
    if (
      typeof tokenInput !== 'string' ||
      !/^[A-Za-z0-9_-]{43}$/.test(tokenInput)
    ) {
      throw new UnauthorizedException('Invalid or expired password reset link.');
    }
    this.validateNewPassword(newPasswordInput);

    const tokenHash = this.hashToken(tokenInput);
    const tokenReference = await this.dataSource
      .getRepository(PasswordResetToken)
      .findOne({
        where: { tokenHash },
        select: { id: true, userId: true },
      });

    if (!tokenReference) {
      throw new UnauthorizedException('Invalid or expired password reset link.');
    }

    await this.dataSource.transaction(async (manager) => {
      const usersRepository = manager.getRepository(User);
      const user = await usersRepository.findOne({
        where: { id: tokenReference.userId },
        lock: { mode: 'pessimistic_write' },
        select: {
          id: true,
          fullName: true,
          email: true,
          passwordHash: true,
          status: true,
          approvalStatus: true,
          deactivatedAt: true,
        },
      });

      if (!user) {
        throw new UnauthorizedException('Invalid or expired password reset link.');
      }

      const resetToken = await manager.getRepository(PasswordResetToken).findOne({
        where: {
          id: tokenReference.id,
          userId: user.id,
          tokenHash,
        },
        lock: { mode: 'pessimistic_write' },
      });

      const now = new Date();
      if (
        !resetToken ||
        resetToken.usedAt !== null ||
        resetToken.invalidatedAt !== null ||
        resetToken.expiresAt <= now
      ) {
        throw new UnauthorizedException('Invalid or expired password reset link.');
      }

      if (await argon2.verify(user.passwordHash, newPasswordInput)) {
        throw new BadRequestException('Choose a password you have not used before.');
      }

      user.passwordHash = await argon2.hash(newPasswordInput, {
        type: argon2.argon2id,
      });
      await usersRepository.save(user);

      resetToken.usedAt = now;
      await manager.getRepository(PasswordResetToken).save(resetToken);
      await manager.query(
        `UPDATE password_reset_tokens
         SET invalidated_at = $1
         WHERE user_id = $2
           AND id <> $3
           AND used_at IS NULL
           AND invalidated_at IS NULL`,
        [now, user.id, resetToken.id],
      );

      await manager.getRepository(AuthSession).update(
        { userId: user.id, revokedAt: IsNull() },
        { revokedAt: now, revocationReason: 'password_reset' },
      );

      await manager.getRepository(PlatformAuditLog).save(
        manager.getRepository(PlatformAuditLog).create({
          actorUserId: null,
          action: 'auth.password_reset.completed',
          entityType: 'user_account',
          entityId: user.id,
          outcome: 'success',
          reason: 'Self-service password reset completed.',
          sourceIp: metadata.sourceIp ?? null,
          userAgent: metadata.userAgent?.slice(0, 1000) ?? null,
          metadata: { flow: 'password_reset', sessionsRevoked: true },
        }),
      );
    });
  }

  async changePassword(
    userId: string,
    currentPasswordInput: unknown,
    newPasswordInput: unknown,
    metadata: PasswordRecoveryMetadata = {},
  ): Promise<void> {
    if (
      typeof currentPasswordInput !== 'string' ||
      currentPasswordInput.length === 0 ||
      currentPasswordInput.length > MAX_PASSWORD_LENGTH
    ) {
      throw new UnauthorizedException('Current password is incorrect.');
    }
    this.validateNewPassword(newPasswordInput);

    await this.dataSource.transaction(async (manager) => {
      const usersRepository = manager.getRepository(User);
      const user = await usersRepository.findOne({
        where: { id: userId },
        lock: { mode: 'pessimistic_write' },
        select: {
          id: true,
          passwordHash: true,
          status: true,
          approvalStatus: true,
          deactivatedAt: true,
        },
      });

      if (
        !user ||
        user.status !== UserStatus.ACTIVE ||
        user.approvalStatus !== UserApprovalStatus.APPROVED ||
        user.deactivatedAt !== null ||
        !(await argon2.verify(user.passwordHash, currentPasswordInput))
      ) {
        throw new UnauthorizedException('Current password is incorrect.');
      }

      if (await argon2.verify(user.passwordHash, newPasswordInput)) {
        throw new BadRequestException('Choose a password you have not used before.');
      }

      const now = new Date();
      user.passwordHash = await argon2.hash(newPasswordInput, {
        type: argon2.argon2id,
      });
      await usersRepository.save(user);

      // Revoke every session and require a fresh login after a password change.
      await manager.getRepository(AuthSession).update(
        { userId: user.id, revokedAt: IsNull() },
        { revokedAt: now, revocationReason: 'password_changed' },
      );

      await manager.getRepository(PasswordResetToken).update(
        { userId: user.id, usedAt: IsNull(), invalidatedAt: IsNull() },
        { invalidatedAt: now },
      );

      await manager.getRepository(PlatformAuditLog).save(
        manager.getRepository(PlatformAuditLog).create({
          actorUserId: user.id,
          action: 'auth.password_changed',
          entityType: 'user_account',
          entityId: user.id,
          outcome: 'success',
          reason: 'Authenticated password change completed.',
          sourceIp: metadata.sourceIp ?? null,
          userAgent: metadata.userAgent?.slice(0, 1000) ?? null,
          metadata: { flow: 'authenticated_password_change', sessionsRevoked: true },
        }),
      );
    });
  }
}
