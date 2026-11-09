import {
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as argon2 from 'argon2';
import { createHash, randomBytes } from 'node:crypto';
import { DataSource, IsNull, MoreThan, Repository } from 'typeorm';
import { User, UserStatus } from '../identity/entities/user.entity';
import { EmailVerification } from './email-verification.entity';
import { EmailDeliveryService } from './email-delivery.service';

const VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;
const GENERIC_MESSAGE = 'If the address can be registered, a verification email will be sent shortly.';
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
    const token = randomBytes(32).toString('base64url');
    const tokenHash = hashToken(token);

    try {
      const user = await this.dataSource.transaction(async (manager) => {
        const userRepo = manager.getRepository(User);
        const verificationRepo = manager.getRepository(EmailVerification);
        const created = await userRepo.save(userRepo.create({
          fullName,
          email,
          passwordHash,
          status: UserStatus.INACTIVE,
          emailVerifiedAt: null,
          isFoundingAssetManager: false,
          lastLoginAt: null,
          deactivatedAt: null,
        }));
        await verificationRepo.save(verificationRepo.create({
          userId: created.id,
          tokenHash,
          expiresAt: new Date(Date.now() + VERIFICATION_TTL_MS),
          usedAt: null,
        }));
        return created;
      });

      try {
        await this.email.sendVerificationEmail(user.email, user.fullName, token);
      } catch {
        logger.error('Verification email delivery failed.');
      }
      return { message: GENERIC_MESSAGE };
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

      if (user.status === UserStatus.INACTIVE) user.status = UserStatus.ACTIVE;
      user.emailVerifiedAt = user.emailVerifiedAt ?? new Date();
      await userRepo.save(user);

      await verificationRepo.createQueryBuilder()
        .update()
        .set({ usedAt: new Date() })
        .where('user_id = :userId AND used_at IS NULL', { userId: user.id })
        .execute();

      return { message: 'Your email address has been verified. You can now sign in.' };
    });
  }

  async resend(emailInput: string) {
    const email = typeof emailInput === 'string' ? emailInput.trim().toLowerCase() : '';
    if (!email || email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new BadRequestException('Enter a valid email address.');
    }

    const user = await this.users.findOne({
      where: { email, status: UserStatus.INACTIVE, emailVerifiedAt: IsNull(), deactivatedAt: IsNull() },
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
