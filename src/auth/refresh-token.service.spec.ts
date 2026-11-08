import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource, EntityManager, Repository } from 'typeorm';

import { AuthSession } from './auth-session.entity';
import { RefreshTokenService } from './refresh-token.service';
import { User, UserStatus } from '../identity/entities/user.entity';

describe('RefreshTokenService', () => {
  let service: RefreshTokenService;

  let sessionsRepository: {
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    update: jest.Mock;
  };

  let usersRepository: {
    findOne: jest.Mock;
  };

  let manager: EntityManager;
  let dataSource: DataSource;
  let transactionCommitted: boolean;

  const replacementSessionId =
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

  const activeUser = {
    id: '9fed3a07-5a17-4b94-8437-552edeebf5a6',
    fullName: 'Platform Owner',
    email: 'owner@example.com',
    status: UserStatus.ACTIVE,
    deactivatedAt: null,
  };

  const activeSession = {
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    userId: activeUser.id,
    tokenHash: 'a'.repeat(64),
    familyId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    revokedAt: null,
    revocationReason: null,
    lastUsedAt: null,
    replacedBySessionId: null,
  };

  beforeEach(() => {
    transactionCommitted = false;

    sessionsRepository = {
      findOne: jest.fn(),
      create: jest.fn((values) => values),
      save: jest.fn(async (value) => ({
        ...value,
        id: value.id ?? replacementSessionId,
      })),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };

    usersRepository = {
      findOne: jest.fn().mockResolvedValue(activeUser),
    };

    manager = {
      getRepository: jest.fn((entity: unknown) => {
        if (entity === AuthSession) {
          return sessionsRepository;
        }

        return usersRepository;
      }),
    } as unknown as EntityManager;

    const transaction = jest.fn(
      async (
        callback: (manager: EntityManager) => Promise<unknown>,
      ) => {
        const result = await callback(manager);

        // A resolved callback represents a committed transaction.
        transactionCommitted = true;

        return result;
      },
    );

    dataSource = {
      transaction,
      getRepository: jest.fn(() => sessionsRepository),
    } as unknown as DataSource;

    const configService = {
      getOrThrow: jest.fn().mockReturnValue(30),
    } as unknown as ConfigService;

    service = new RefreshTokenService(
      dataSource,
      configService,
    );
  });

  describe('createSession', () => {
    it('creates a refresh session for an active user', async () => {
      usersRepository.findOne.mockResolvedValue(activeUser);
      sessionsRepository.save.mockImplementation(
        async (value) => ({
          ...value,
          id: replacementSessionId,
        }),
      );

      const token = await service.createSession(
        activeUser.id,
        {
          sourceIp: '127.0.0.1',
          userAgent: 'AssetPass test client',
        },
      );

      expect(token).toEqual({
        refreshToken: expect.any(String),
        sessionId: replacementSessionId,
      });
      expect(token.refreshToken).toHaveLength(43);

      expect(sessionsRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: activeUser.id,
          tokenHash: expect.any(String),
          familyId: expect.any(String),
          sourceIp: '127.0.0.1',
          userAgent: 'AssetPass test client',
        }),
      );

      expect(sessionsRepository.create.mock.calls[0][0])
        .not.toHaveProperty('refreshToken');

      expect(usersRepository.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: activeUser.id },
          lock: { mode: 'pessimistic_write' },
        }),
      );

      expect(transactionCommitted).toBe(true);
    });

    it('rejects session creation for an inactive user', async () => {
      usersRepository.findOne.mockResolvedValue({
        ...activeUser,
        status: UserStatus.INACTIVE,
      });

      await expect(
        service.createSession(activeUser.id),
      ).rejects.toThrow(UnauthorizedException);

      expect(sessionsRepository.save).not.toHaveBeenCalled();
    });

    it('rejects session creation for a deactivated user', async () => {
      usersRepository.findOne.mockResolvedValue({
        ...activeUser,
        deactivatedAt: new Date(),
      });

      await expect(
        service.createSession(activeUser.id),
      ).rejects.toThrow(UnauthorizedException);

      expect(sessionsRepository.save).not.toHaveBeenCalled();
    });
  });

  describe('rotate', () => {
    it('rotates a valid refresh token', async () => {
      sessionsRepository.findOne.mockResolvedValue({
        ...activeSession,
      });

      usersRepository.findOne.mockResolvedValue(activeUser);

      const result = await service.rotate('old-refresh-token', {
        sourceIp: '127.0.0.1',
        userAgent: 'AssetPass test client',
      });

      expect(result.refreshToken).toEqual(expect.any(String));
      expect(result.refreshToken).not.toBe('old-refresh-token');

      expect(result.user).toEqual({
        id: activeUser.id,
        fullName: activeUser.fullName,
        email: activeUser.email,
        status: activeUser.status,
      });

      expect(sessionsRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: activeUser.id,
          familyId: activeSession.familyId,
          sourceIp: '127.0.0.1',
          userAgent: 'AssetPass test client',
        }),
      );

      expect(sessionsRepository.save).toHaveBeenCalledTimes(2);

      expect(sessionsRepository.findOne).toHaveBeenCalledTimes(2);

      expect(usersRepository.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: activeUser.id },
          lock: { mode: 'pessimistic_write' },
        }),
      );

      expect(
        usersRepository.findOne.mock.invocationCallOrder[0],
      ).toBeLessThan(
        sessionsRepository.findOne.mock.invocationCallOrder[1],
      );

      expect(sessionsRepository.findOne).toHaveBeenLastCalledWith(
        expect.objectContaining({
          where: {
            tokenHash: expect.any(String),
            userId: activeUser.id,
          },
          lock: { mode: 'pessimistic_write' },
        }),
      );

      expect(sessionsRepository.save).toHaveBeenLastCalledWith(
        expect.objectContaining({
          revokedAt: expect.any(Date),
          revocationReason: 'rotated',
          replacedBySessionId: replacementSessionId,
        }),
      );

      expect(transactionCommitted).toBe(true);
    });

    it('rejects an unknown refresh token', async () => {
      sessionsRepository.findOne.mockResolvedValue(null);

      await expect(
        service.rotate('unknown-refresh-token'),
      ).rejects.toThrow(UnauthorizedException);

      expect(transactionCommitted).toBe(true);
      expect(sessionsRepository.update).not.toHaveBeenCalled();
    });

    it('commits family revocation before rejecting a reused token', async () => {
      sessionsRepository.findOne.mockResolvedValue({
        ...activeSession,
        revokedAt: new Date(),
        revocationReason: 'rotated',
      });

      await expect(
        service.rotate('reused-refresh-token'),
      ).rejects.toThrow(UnauthorizedException);

      expect(sessionsRepository.update).toHaveBeenCalledWith(
        {
          familyId: activeSession.familyId,
          revokedAt: expect.anything(),
        },
        {
          revokedAt: expect.any(Date),
          revocationReason: 'token_reuse',
        },
      );

      // This proves the transaction callback resolved before
      // rotate() raised its authentication exception.
      expect(transactionCommitted).toBe(true);
    });

    it('commits expiry revocation before rejecting an expired token', async () => {
      sessionsRepository.findOne.mockResolvedValue({
        ...activeSession,
        expiresAt: new Date(Date.now() - 60 * 1000),
      });

      await expect(
        service.rotate('expired-refresh-token'),
      ).rejects.toThrow(UnauthorizedException);

      expect(sessionsRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          revokedAt: expect.any(Date),
          revocationReason: 'expired',
        }),
      );

      expect(transactionCommitted).toBe(true);
    });

    it('commits family revocation when the account is unavailable', async () => {
      sessionsRepository.findOne.mockResolvedValue({
        ...activeSession,
      });

      usersRepository.findOne.mockResolvedValue({
        ...activeUser,
        status: UserStatus.SUSPENDED,
      });

      await expect(
        service.rotate('valid-refresh-token'),
      ).rejects.toThrow(
        'Authentication is no longer valid.',
      );

      expect(sessionsRepository.update).toHaveBeenCalledWith(
        {
          familyId: activeSession.familyId,
          revokedAt: expect.anything(),
        },
        {
          revokedAt: expect.any(Date),
          revocationReason: 'account_unavailable',
        },
      );

      expect(transactionCommitted).toBe(true);
    });

    it('rejects malformed refresh tokens before opening a transaction', async () => {
      await expect(
        service.rotate(''),
      ).rejects.toThrow(UnauthorizedException);

      await expect(
        service.rotate('x'.repeat(257)),
      ).rejects.toThrow(UnauthorizedException);

      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('rejects a previously revoked token without revoking its family again', async () => {
      sessionsRepository.findOne.mockResolvedValue({
        ...activeSession,
        revokedAt: new Date(),
        revocationReason: 'logout',
      });

      await expect(
        service.rotate('logged-out-refresh-token'),
      ).rejects.toThrow(UnauthorizedException);

      expect(sessionsRepository.update).not.toHaveBeenCalled();
      expect(transactionCommitted).toBe(true);
    });
  });

  describe('revoke', () => {
    it('revokes an active refresh session', async () => {
      sessionsRepository.findOne.mockResolvedValue({
        ...activeSession,
      });

      await service.revoke('current-refresh-token');

      expect(sessionsRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          revokedAt: expect.any(Date),
          revocationReason: 'logout',
        }),
      );

      expect(sessionsRepository.findOne).toHaveBeenCalledTimes(2);

      expect(
        usersRepository.findOne.mock.invocationCallOrder[0],
      ).toBeLessThan(
        sessionsRepository.findOne.mock.invocationCallOrder[1],
      );

      expect(transactionCommitted).toBe(true);
    });

    it('does not modify a session that is already revoked', async () => {
      sessionsRepository.findOne.mockResolvedValue({
        ...activeSession,
        revokedAt: new Date(),
        revocationReason: 'rotated',
      });

      await service.revoke('already-revoked-token');

      expect(sessionsRepository.save).not.toHaveBeenCalled();
      expect(transactionCommitted).toBe(true);
    });

    it('ignores malformed refresh tokens', async () => {
      await service.revoke('');

      await service.revoke('x'.repeat(257));

      expect(dataSource.transaction).not.toHaveBeenCalled();
    });
  });

  describe('revokeAllForUser', () => {
    it('revokes every active session belonging to a user', async () => {
      sessionsRepository.update.mockResolvedValue({
        affected: 3,
      });

      const count = await service.revokeAllForUser(
        activeUser.id,
      );

      expect(count).toBe(3);

      expect(sessionsRepository.update).toHaveBeenCalledWith(
        {
          userId: activeUser.id,
          revokedAt: expect.anything(),
        },
        {
          revokedAt: expect.any(Date),
          revocationReason: 'logout_all',
        },
      );

      expect(usersRepository.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: activeUser.id },
          lock: { mode: 'pessimistic_write' },
        }),
      );

      expect(transactionCommitted).toBe(true);
    });

    it('returns zero when no active sessions were affected', async () => {
      sessionsRepository.update.mockResolvedValue({
        affected: undefined,
      });

      const count = await service.revokeAllForUser(
        activeUser.id,
      );

      expect(count).toBe(0);
    });
  });
});
