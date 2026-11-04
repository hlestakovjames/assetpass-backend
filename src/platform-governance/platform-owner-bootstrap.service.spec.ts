import { DataSource } from 'typeorm';

import { PlatformAuditLog } from '../audit/entities/platform-audit-log.entity';
import { User, UserStatus } from '../identity/entities/user.entity';
import { PlatformGovernanceState } from './entities/platform-governance-state.entity';
import { PlatformRole, PlatformRoleName } from './entities/platform-role.entity';
import { completePlatformOwnerBootstrap } from './platform-owner-bootstrap.service';

describe('completePlatformOwnerBootstrap', () => {
  const ownerId = '9fed3a07-5a17-4b94-8437-552edeebf5a6';

  const input = {
    fullName: 'Test Platform Owner',
    email: 'test.owner@assetpass.example',
    passwordHash: 'test-argon2id-hash',
  };

  let dataSource: DataSource;
  let manager: {
    query: jest.Mock;
    getRepository: jest.Mock;
  };

  let userRepository: {
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
  };

  let roleRepository: {
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
  };

  let governanceRepository: {
    update: jest.Mock;
  };

  let auditRepository: {
    create: jest.Mock;
    save: jest.Mock;
  };

  let transaction: jest.Mock;

  beforeEach(() => {
    userRepository = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((value) => value),
      save: jest.fn().mockImplementation(async (user) => ({
        ...user,
        id: ownerId,
      })),
    };

    roleRepository = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((value) => value),
      save: jest.fn().mockImplementation(async (role) => role),
    };

    governanceRepository = {
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };

    auditRepository = {
      create: jest.fn((value) => value),
      save: jest.fn().mockImplementation(async (log) => log),
    };

    manager = {
      query: jest.fn().mockResolvedValue([
        {
          id: 1,
          bootstrap_completed_at: null,
          initial_owner_user_id: null,
        },
      ]),
      getRepository: jest.fn((entity) => {
        if (entity === User) return userRepository;
        if (entity === PlatformRole) return roleRepository;
        if (entity === PlatformGovernanceState) return governanceRepository;
        if (entity === PlatformAuditLog) return auditRepository;

        throw new Error('Unexpected repository requested.');
      }),
    };

    transaction = jest.fn(async (callback) => callback(manager));

    dataSource = {
      transaction,
    } as unknown as DataSource;
  });

  it('creates the initial owner, assigns the role, updates governance state, and records the audit event', async () => {
    const result = await completePlatformOwnerBootstrap(dataSource, input);

    expect(result.id).toBe(ownerId);
    expect(result.fullName).toBe(input.fullName);
    expect(result.email).toBe(input.email);
    expect(result.status).toBe(UserStatus.ACTIVE);
    expect(result.isFoundingAssetManager).toBe(false);

    expect(manager.query).toHaveBeenCalledWith(
      expect.stringContaining('FOR UPDATE'),
    );

    expect(userRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        fullName: input.fullName,
        email: input.email,
        passwordHash: input.passwordHash,
        status: UserStatus.ACTIVE,
        isFoundingAssetManager: false,
      }),
    );

    expect(roleRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: ownerId,
        role: PlatformRoleName.OWNER,
        assignedByUserId: null,
        revokedAt: null,
      }),
    );

    expect(governanceRepository.update).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1 }),
      expect.objectContaining({
        initialOwnerUserId: ownerId,
        bootstrapCompletedAt: expect.any(Date),
      }),
    );

    expect(auditRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: ownerId,
        action: 'platform.bootstrap.completed',
        entityType: 'platform_governance',
        entityId: ownerId,
        outcome: 'success',
      }),
    );
  });

  it('rejects when the governance state is missing', async () => {
    manager.query.mockResolvedValue([]);

    await expect(
      completePlatformOwnerBootstrap(dataSource, input),
    ).rejects.toThrow('Platform governance state is missing or invalid.');

    expect(userRepository.save).not.toHaveBeenCalled();
    expect(roleRepository.save).not.toHaveBeenCalled();
    expect(auditRepository.save).not.toHaveBeenCalled();
  });

  it('rejects when bootstrap has already been completed', async () => {
    manager.query.mockResolvedValue([
      {
        id: 1,
        bootstrap_completed_at: new Date(),
        initial_owner_user_id: ownerId,
      },
    ]);

    await expect(
      completePlatformOwnerBootstrap(dataSource, input),
    ).rejects.toThrow('Platform bootstrap has already been completed.');

    expect(roleRepository.findOne).not.toHaveBeenCalled();
    expect(userRepository.save).not.toHaveBeenCalled();
  });

  it('rejects when an active Platform Owner already exists', async () => {
    roleRepository.findOne.mockResolvedValue({
      userId: ownerId,
      role: PlatformRoleName.OWNER,
    });

    await expect(
      completePlatformOwnerBootstrap(dataSource, input),
    ).rejects.toThrow('An active Platform Owner already exists.');

    expect(userRepository.findOne).not.toHaveBeenCalled();
    expect(userRepository.save).not.toHaveBeenCalled();
  });

  it('rejects when the email address already belongs to a user', async () => {
    userRepository.findOne.mockResolvedValue({
      id: ownerId,
      email: input.email,
    });

    await expect(
      completePlatformOwnerBootstrap(dataSource, input),
    ).rejects.toThrow('A user with this email already exists.');

    expect(userRepository.save).not.toHaveBeenCalled();
    expect(roleRepository.save).not.toHaveBeenCalled();
  });

  it('aborts when the governance state update does not affect exactly one row', async () => {
    governanceRepository.update.mockResolvedValue({ affected: 0 });

    await expect(
      completePlatformOwnerBootstrap(dataSource, input),
    ).rejects.toThrow('Bootstrap state update failed. Transaction aborted.');

    expect(auditRepository.save).not.toHaveBeenCalled();
  });

  it('propagates transaction failures', async () => {
    transaction.mockRejectedValueOnce(new Error('Simulated transaction failure'));

    await expect(
      completePlatformOwnerBootstrap(dataSource, input),
    ).rejects.toThrow('Simulated transaction failure');
  });
});
