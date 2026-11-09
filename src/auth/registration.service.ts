import {
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as argon2 from 'argon2';
import { createHash, randomBytes } from 'node:crypto';
import { DataSource, In, IsNull, MoreThan, Repository } from 'typeorm';
import { User, UserApprovalStatus, UserStatus } from '../identity/entities/user.entity';
import { PlatformAuditLog } from '../audit/entities/platform-audit-log.entity';
import { EmailVerification } from './email-verification.entity';
import { EmailDeliveryService } from './email-delivery.service';

const VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;
const GENERIC_MESSAGE = 'Registration received. If this is a new account, it is ready for sign-in.';
const REGISTRATION_SUCCESS_MESSAGE = 'Registration successful. Your account is active and you can sign in now.';
const logger = new Logger('RegistrationService');

@Injectable()
export class RegistrationService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(EmailVerification) private readonly verifications: Repository<EmailVerification>,
    private readonly dataSource: DataSource,
    private readonly email: EmailDeliveryService,
  ) {}

  async register(input: { fullName: string; email: string; password: string }) {
    const fullName = input?.fullName?.trim();
    const email = input?.email?.trim().toLowerCase();
    const password = input?.password;

    if (!fullName || fullName.length < 2 || fullName.length > 200 ||
        !email || email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
        typeof password !== 'string' || password.length < 12 || password.length > 1024) {
      throw new BadRequestException('Enter a valid name and email address, and use a password of at least 12 characters.');
    }

    const passwordHash = await argon2.hash(password);
    try {
      const user = await this.dataSource.transaction(async (manager) => {
        const userRepo = manager.getRepository(User);
        const verificationRepo = manager.getRepository(EmailVerification);
        const created = await userRepo.save(userRepo.create({
          fullName,
          email,
          passwordHash,
          status: UserStatus.ACTIVE,
          approvalStatus: UserApprovalStatus.APPROVED,
          approvalReviewedByUserId: null,
          approvalReviewedAt: new Date(),
          approvalNote: 'Automatically approved under the early-launch registration access policy.',
          emailVerifiedAt: new Date(),
          isFoundingAssetManager: false,
          lastLoginAt: null,
          deactivatedAt: null,
        }));
        await manager.getRepository(PlatformAuditLog).save({
          actorUserId: null,
          action: 'auth.user.registered',
          entityType: 'user',
          entityId: created.id,
          outcome: 'success',
          reason: 'Automatic activation under the early-launch registration access policy.',
          metadata: {
            registrationMethod: 'self_service',
            accountStatus: created.status,
            approvalStatus: created.approvalStatus,
            emailVerifiedInternally: Boolean(created.emailVerifiedAt),
            emailVerificationEmailSent: false,
          },
        });
        return created;
      });

      return { message: REGISTRATION_SUCCESS_MESSAGE };
    } catch (error) {
      if (isUniqueViolation(error)) return { message: GENERIC_MESSAGE };
      throw error;
    }
  }

  async verify(token: string) {
    if (typeof token !== 'string' || token.length < 32 || token.length > 200) {
      throw new BadRequestException('This verification link is invalid or has expired.');
    }

    return this.dataSource.transaction(async (manager) => {
      const verificationRepo = manager.getRepository(EmailVerification);
      const verification = await verificationRepo.createQueryBuilder('verification')
        .setLock('pessimistic_write')
        .where('verification.token_hash = :tokenHash', { tokenHash: hashToken(token) })
        .andWhere('verification.used_at IS NULL')
        .andWhere('verification.expires_at > NOW()')
        .getOne();

      if (!verification) throw new BadRequestException('This verification link is invalid or has expired.');

      const userRepo = manager.getRepository(User);
      const user = await userRepo.findOne({ where: { id: verification.userId } });
      if (!user || user.deactivatedAt) throw new BadRequestException('This verification link is invalid or has expired.');

      verification.usedAt = new Date();
      await verificationRepo.save(verification);

      user.emailVerifiedAt = user.emailVerifiedAt ?? new Date();
      await userRepo.save(user);

      await verificationRepo.createQueryBuilder()
        .update()
        .set({ usedAt: new Date() })
        .where('user_id = :userId AND used_at IS NULL', { userId: user.id })
        .execute();

      if (user.approvalStatus === UserApprovalStatus.APPROVED) {
        return { message: 'Your email address has been verified. Your account is approved and you can sign in.' };
      }

      if (user.approvalStatus === UserApprovalStatus.REJECTED) {
        return { message: 'Your email address has been verified, but this account was not approved for access.' };
      }

      return { message: 'Your email address has been verified. Your account is awaiting AssetPass administrator approval before sign-in.' };
    });
  }

  async resend(emailInput: string) {
    const email = typeof emailInput === 'string' ? emailInput.trim().toLowerCase() : '';
    if (!email || email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new BadRequestException('Enter a valid email address.');
    }

    const user = await this.users.findOne({
      where: {
        email,
        status: UserStatus.INACTIVE,
        approvalStatus: In([UserApprovalStatus.PENDING_REVIEW, UserApprovalStatus.APPROVED]),
        emailVerifiedAt: IsNull(),
        deactivatedAt: IsNull(),
      },
    });
    if (!user) return { message: GENERIC_MESSAGE };

    const recentlyIssued = await this.verifications.findOne({
      where: { userId: user.id, createdAt: MoreThan(new Date(Date.now() - 60_000)) },
      order: { createdAt: 'DESC' },
    });
    if (recentlyIssued) return { message: GENERIC_MESSAGE };

    const token = randomBytes(32).toString('base64url');
    await this.dataSource.transaction(async (manager) => {
      await manager.getRepository(EmailVerification).createQueryBuilder()
        .update().set({ usedAt: new Date() })
        .where('user_id = :userId AND used_at IS NULL', { userId: user.id }).execute();
      await manager.getRepository(EmailVerification).save({
        userId: user.id,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + VERIFICATION_TTL_MS),
        usedAt: null,
      });
    });

    try {
      await this.email.sendVerificationEmail(user.email, user.fullName, token);
    } catch {
      logger.error('Verification email resend failed.');
    }
    return { message: GENERIC_MESSAGE };
  }
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null &&
    'code' in error && (error as { code?: string }).code === '23505';
}
