import {
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createHash,
  randomBytes,
  randomUUID,
} from 'node:crypto';
import {
  DataSource,
  EntityManager,
  IsNull,
} from 'typeorm';

import { AuthSession } from './auth-session.entity';
import {
  User,
  UserStatus,
} from '../identity/entities/user.entity';

export interface SessionMetadata {
  sourceIp?: string | null;
  userAgent?: string | null;
}

export interface CreatedRefreshSession {
  refreshToken: string;
  sessionId: string;
}

export interface RotatedRefreshSession {
  refreshToken: string;
  sessionId: string;
  user: Pick<User, 'id' | 'fullName' | 'email' | 'status'>;
}

type RotationOutcome =
  | {
      kind: 'success';
      result: RotatedRefreshSession;
    }
  | {
      kind: 'invalid' | 'reuse' | 'expired' | 'account_unavailable';
    };

@Injectable()
export class RefreshTokenService {
  private readonly refreshTokenTtlDays: number;

  constructor(
    private readonly dataSource: DataSource,
    private readonly configService: ConfigService,
  ) {
    this.refreshTokenTtlDays =
      this.configService.getOrThrow<number>(
        'REFRESH_TOKEN_TTL_DAYS',
      );
  }

  private generateRefreshToken(): string {
    return randomBytes(32).toString('base64url');
  }

  private hashToken(token: string): string {
    return createHash('sha256')
      .update(token)
      .digest('hex');
  }

  private getExpiryDate(): Date {
    return new Date(
      Date.now() +
        this.refreshTokenTtlDays * 24 * 60 * 60 * 1000,
    );
  }

  private async revokeFamily(
    manager: EntityManager,
    familyId: string,
    reason: string,
    revokedAt: Date,
  ): Promise<void> {
    await manager.getRepository(AuthSession).update(
      {
        familyId,
        revokedAt: IsNull(),
      },
      {
        revokedAt,
        revocationReason: reason,
      },
    );
  }

  /**
   * All session mutations use the same lock order:
   * 1. User row (pessimistic_write).
   * 2. Relevant session row(s) (pessimistic_write).
   *
   * This serializes concurrent session mutations for one user and
   * prevents inconsistent lock ordering between login, refresh,
   * logout, and logout-all.
   */
  async createSession(
    userId: string,
    metadata: SessionMetadata = {},
  ): Promise<CreatedRefreshSession> {
    return this.dataSource.transaction(async (manager) => {
      const usersRepository = manager.getRepository(User);

      const user = await usersRepository.findOne({
        where: { id: userId },
        lock: { mode: 'pessimistic_write' },
      });

      if (
        !user ||
        user.status !== UserStatus.ACTIVE ||
        user.deactivatedAt !== null
      ) {
        throw new UnauthorizedException(
          'Authentication is no longer valid.',
        );
      }

      const refreshToken = this.generateRefreshToken();

      const session = manager.getRepository(AuthSession).create({
        userId: user.id,
        tokenHash: this.hashToken(refreshToken),
        familyId: randomUUID(),
        expiresAt: this.getExpiryDate(),
        sourceIp: metadata.sourceIp ?? null,
        userAgent: metadata.userAgent?.slice(0, 1000) ?? null,
      });

      const savedSession = await manager
        .getRepository(AuthSession)
        .save(session);

      return {
        refreshToken,
        sessionId: savedSession.id,
      };
    });
  }

  async rotate(
    refreshToken: string,
    metadata: SessionMetadata = {},
  ): Promise<RotatedRefreshSession> {
    if (!refreshToken || refreshToken.length > 256) {
      throw new UnauthorizedException(
        'Invalid or expired refresh token.',
      );
    }

    const tokenHash = this.hashToken(refreshToken);

    const outcome: RotationOutcome =
      await this.dataSource.transaction(async (manager) => {
        const sessionsRepository =
          manager.getRepository(AuthSession);

        // This initial lookup only identifies which user must be locked.
        // It deliberately does not lock the session.
        const sessionReference = await sessionsRepository.findOne({
          where: { tokenHash },
          select: {
            id: true,
            userId: true,
          },
        });

        if (!sessionReference) {
          return { kind: 'invalid' };
        }

        // Always acquire the user lock before any session write lock.
        const user = await manager.getRepository(User).findOne({
          where: { id: sessionReference.userId },
          lock: { mode: 'pessimistic_write' },
        });

        if (!user) {
          return { kind: 'invalid' };
        }

        // Re-read and lock the session after obtaining the user lock.
        // Its state may have changed while this transaction was waiting.
        const session = await sessionsRepository.findOne({
          where: {
            tokenHash,
            userId: user.id,
          },
          lock: { mode: 'pessimistic_write' },
        });

        if (!session) {
          return { kind: 'invalid' };
        }

        const now = new Date();

        if (session.revokedAt !== null) {
          if (session.revocationReason === 'rotated') {
            await this.revokeFamily(
              manager,
              session.familyId,
              'token_reuse',
              now,
            );

            return { kind: 'reuse' };
          }

          return { kind: 'invalid' };
        }

        if (session.expiresAt <= now) {
          session.revokedAt = now;
          session.revocationReason = 'expired';

          await sessionsRepository.save(session);

          return { kind: 'expired' };
        }

        if (
          user.status !== UserStatus.ACTIVE ||
          user.deactivatedAt !== null
        ) {
          await this.revokeFamily(
            manager,
            session.familyId,
            'account_unavailable',
            now,
          );

          return { kind: 'account_unavailable' };
        }

        const newRefreshToken = this.generateRefreshToken();

        const replacement = sessionsRepository.create({
          userId: user.id,
          tokenHash: this.hashToken(newRefreshToken),
          familyId: session.familyId,
          expiresAt: this.getExpiryDate(),
          sourceIp: metadata.sourceIp ?? null,
          userAgent: metadata.userAgent?.slice(0, 1000) ?? null,
        });

        const savedReplacement =
          await sessionsRepository.save(replacement);

        session.revokedAt = now;
        session.lastUsedAt = now;
        session.revocationReason = 'rotated';
        session.replacedBySessionId = savedReplacement.id;

        await sessionsRepository.save(session);

        return {
          kind: 'success',
          result: {
            refreshToken: newRefreshToken,
            sessionId: savedReplacement.id,
            user: {
              id: user.id,
              fullName: user.fullName,
              email: user.email,
              status: user.status,
            },
          },
        };
      });

    if (outcome.kind === 'success') {
      return outcome.result;
    }

    if (outcome.kind === 'account_unavailable') {
      throw new UnauthorizedException(
        'Authentication is no longer valid.',
      );
    }

    throw new UnauthorizedException(
      'Invalid or expired refresh token.',
    );
  }

  async revoke(
    refreshToken: string,
    reason = 'logout',
  ): Promise<void> {
    if (!refreshToken || refreshToken.length > 256) {
      return;
    }

    const tokenHash = this.hashToken(refreshToken);

    await this.dataSource.transaction(async (manager) => {
      const sessionsRepository =
        manager.getRepository(AuthSession);

      // Identify the owner without taking a session lock first.
      const sessionReference = await sessionsRepository.findOne({
        where: { tokenHash },
        select: {
          id: true,
          userId: true,
        },
      });

      if (!sessionReference) {
        return;
      }

      // Maintain the global user -> session lock order.
      const user = await manager.getRepository(User).findOne({
        where: { id: sessionReference.userId },
        lock: { mode: 'pessimistic_write' },
      });

      if (!user) {
        return;
      }

      const session = await sessionsRepository.findOne({
        where: {
          tokenHash,
          userId: user.id,
        },
        lock: { mode: 'pessimistic_write' },
      });

      if (!session || session.revokedAt !== null) {
        return;
      }

      session.revokedAt = new Date();
      session.revocationReason = reason.slice(0, 100);

      await sessionsRepository.save(session);
    });
  }

  async revokeAllForUser(
    userId: string,
    reason = 'logout_all',
  ): Promise<number> {
    return this.dataSource.transaction(async (manager) => {
      // Even bulk session revocation participates in the same
      // per-user serialization protocol.
      const user = await manager.getRepository(User).findOne({
        where: { id: userId },
        lock: { mode: 'pessimistic_write' },
        select: {
          id: true,
        },
      });

      if (!user) {
        return 0;
      }

      const result = await manager
        .getRepository(AuthSession)
        .update(
          {
            userId,
            revokedAt: IsNull(),
          },
          {
            revokedAt: new Date(),
            revocationReason: reason.slice(0, 100),
          },
        );

      return result.affected ?? 0;
    });
  }
}
