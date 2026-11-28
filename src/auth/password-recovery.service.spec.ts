import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { DataSource } from 'typeorm';

import { PlatformAuditLog } from '../audit/entities/platform-audit-log.entity';
import { User, UserApprovalStatus, UserStatus } from '../identity/entities/user.entity';
import { AuthSession } from './auth-session.entity';
import { EmailDeliveryService } from './email-delivery.service';
import { PasswordResetRequestEvent } from './entities/password-reset-request-event.entity';
import { PasswordResetToken } from './entities/password-reset-token.entity';
import { PasswordRecoveryService } from './password-recovery.service';

jest.mock('argon2', () => ({
  hash: jest.fn(),
  verify: jest.fn(),
}));

describe('PasswordRecoveryService', () => {
  const user = {
    id: '9fed3a07-5a17-4b94-8437-552edeebf5a6',
    fullName: 'Test User',
    email: 'person@example.com',
    passwordHash: 'old-argon2id-hash',
    status: UserStatus.ACTIVE,
    approvalStatus: UserApprovalStatus.APPROVED,
    deactivatedAt: null,
  };

  let service: PasswordRecoveryService;
  let dataSource: DataSource;
  let manager: {
    query: jest.Mock;
    getRepository: jest.Mock;
  };
  let userRepository: {
    findOne: jest.Mock;
    save: jest.Mock;
  };
  let resetTokenRepository: {
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    update: jest.Mock;
  };
  let requestEventRepository: {
    create: jest.Mock;
    save: jest.Mock;
  };
  let sessionRepository: { update: jest.Mock };
  let auditRepository: { create: jest.Mock; save: jest.Mock };
  let emailDelivery: { sendPasswordResetEmail: jest.Mock };

  beforeEach(() => {
    jest.clearAllMocks();

    userRepository = {
      findOne: jest.fn().mockResolvedValue(null),
      save: jest.fn().mockImplementation(async (value) => value),
    };
    resetTokenRepository = {
      findOne: jest.fn(),
      create: jest.fn((value) => value),
      save: jest.fn().mockImplementation(async (value) => value),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    requestEventRepository = {
      create: jest.fn((value) => value),
      save: jest.fn().mockImplementation(async (value) => value),
    };
    sessionRepository = { update: jest.fn().mockResolvedValue({ affected: 1 }) };
    auditRepository = {
      create: jest.fn((value) => value),
      save: jest.fn().mockImplementation(async (value) => value),
    };

    manager = {
      query: jest.fn().mockImplementation(async (sql: string) => {
        if (sql.includes('COUNT(*)')) return [{ count: 0 }];
        return [];
      }),
      getRepository: jest.fn((entity) => {
        if (entity === User) return userRepository;
        if (entity === PasswordResetToken) return resetTokenRepository;
        if (entity === PasswordResetRequestEvent) return requestEventRepository;
        if (entity === AuthSession) return sessionRepository;
        if (entity === PlatformAuditLog) return auditRepository;
        throw new Error('Unexpected repository requested.');
      }),
    };

    dataSource = {
      transaction: jest.fn(async (callback) => callback(manager)),
      getRepository: jest.fn(() => resetTokenRepository),
    } as unknown as DataSource;

    emailDelivery = {
      sendPasswordResetEmail: jest.fn().mockResolvedValue(undefined),
    };

    service = new PasswordRecoveryService(
      dataSource,
      {
        getOrThrow: jest.fn().mockReturnValue('a'.repeat(64)),
      } as never,
      emailDelivery as unknown as EmailDeliveryService,
    );
  });

  it('returns a generic response for an unknown email without sending mail', async () => {
    const result = await service.requestPasswordReset('unknown@example.com', {
      sourceIp: '127.0.0.1',
    });

    expect(result.message).toContain('If an account exists');
    expect(emailDelivery.sendPasswordResetEmail).not.toHaveBeenCalled();
    expect(requestEventRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ requestedIp: '127.0.0.1' }),
    );
  });

  it('creates a hashed, expiring token and sends the reset email for an existing account', async () => {
    userRepository.findOne.mockResolvedValue(user);

    const result = await service.requestPasswordReset(' PERSON@example.com ', {
      sourceIp: '127.0.0.1',
    });

    expect(result.message).toContain('If an account exists');
    expect(resetTokenRepository.update).toHaveBeenCalledWith(
      expect.objectContaining({ userId: user.id }),
      expect.objectContaining({ invalidatedAt: expect.any(Date) }),
    );
    const savedToken = resetTokenRepository.create.mock.calls[0][0];
    expect(savedToken.userId).toBe(user.id);
    expect(savedToken.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(savedToken.tokenHash).not.toHaveLength(43);
    expect(savedToken.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(emailDelivery.sendPasswordResetEmail).toHaveBeenCalledWith(
      user.email,
      user.fullName,
      expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
      undefined,
    );
  });

  it('does not issue another token after the per-email request limit is reached', async () => {
    manager.query.mockImplementation(async (sql: string) => {
      if (sql.includes('COUNT(*)') && sql.includes('email_hash')) return [{ count: 3 }];
      if (sql.includes('COUNT(*)')) return [{ count: 0 }];
      return [];
    });

    const result = await service.requestPasswordReset('person@example.com', {
      sourceIp: '127.0.0.1',
    });

    expect(result.message).toContain('If an account exists');
    expect(userRepository.findOne).not.toHaveBeenCalled();
    expect(resetTokenRepository.save).not.toHaveBeenCalled();
    expect(emailDelivery.sendPasswordResetEmail).not.toHaveBeenCalled();
  });

  it('rejects a malformed or unknown reset token', async () => {
    await expect(
      service.resetPassword('not-a-token', 'a-strong-password-123'),
    ).rejects.toThrow(UnauthorizedException);
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it('consumes a reset token and revokes all sessions atomically', async () => {
    const tokenRow = {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      userId: user.id,
      tokenHash: 'b'.repeat(64),
      expiresAt: new Date(Date.now() + 60_000),
      usedAt: null,
      invalidatedAt: null,
    };
    resetTokenRepository.findOne
      .mockResolvedValueOnce({ id: tokenRow.id, userId: user.id })
      .mockResolvedValueOnce(tokenRow);
    userRepository.findOne.mockResolvedValue({ ...user });

    jest.mocked(argon2.verify).mockResolvedValue(false);
    jest.mocked(argon2.hash).mockResolvedValue('new-argon2id-hash');

    await service.resetPassword('a'.repeat(43), 'a-strong-new-password-123', {
      sourceIp: '127.0.0.1',
      userAgent: 'Test browser',
    });

    expect(userRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ passwordHash: 'new-argon2id-hash' }),
    );
    expect(resetTokenRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ usedAt: expect.any(Date) }),
    );
    expect(manager.query).toHaveBeenCalledWith(
      expect.stringContaining('id <>'),
      expect.arrayContaining([expect.any(Date), user.id, tokenRow.id]),
    );
    expect(sessionRepository.update).toHaveBeenCalledWith(
      { userId: user.id, revokedAt: expect.anything() },
      { revokedAt: expect.any(Date), revocationReason: 'password_reset' },
    );
    expect(auditRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: null,
        action: 'auth.password_reset.completed',
        outcome: 'success',
      }),
    );
  });

  it('requires the current password for an authenticated password change', async () => {
    userRepository.findOne.mockResolvedValue({ ...user });
    jest.mocked(argon2.verify).mockResolvedValue(false);

    await expect(
      service.changePassword(user.id, 'wrong-current-password', 'a-new-password-123'),
    ).rejects.toThrow(UnauthorizedException);

    expect(userRepository.save).not.toHaveBeenCalled();
    expect(sessionRepository.update).not.toHaveBeenCalled();
  });

  it('changes an authenticated password and revokes all sessions', async () => {
    userRepository.findOne.mockResolvedValue({ ...user });
    jest.mocked(argon2.verify)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    jest.mocked(argon2.hash).mockResolvedValue('changed-argon2id-hash');

    await service.changePassword(user.id, 'current-password', 'a-new-password-123');

    expect(userRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ passwordHash: 'changed-argon2id-hash' }),
    );
    expect(sessionRepository.update).toHaveBeenCalledWith(
      { userId: user.id, revokedAt: expect.anything() },
      { revokedAt: expect.any(Date), revocationReason: 'password_changed' },
    );
    expect(auditRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: user.id,
        action: 'auth.password_changed',
        outcome: 'success',
      }),
    );
  });

  it('rejects a password that is shorter than the registration policy', async () => {
    await expect(
      service.changePassword(user.id, 'current-password', 'short'),
    ).rejects.toThrow(BadRequestException);
  });
});
