import { RegistrationService } from './registration.service';
import { EmailVerification } from './email-verification.entity';
import { User, UserApprovalStatus, UserStatus } from '../identity/entities/user.entity';

jest.mock('argon2', () => ({
  hash: jest.fn().mockResolvedValue('hashed-password'),
}));

describe('RegistrationService account approval gate', () => {
  const makeService = () => {
    const userRepository = {
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => ({ ...value, id: value.id ?? 'user-1' })),
      findOne: jest.fn(),
    };
    const verificationRepository = {
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => value),
      findOne: jest.fn(),
      createQueryBuilder: jest.fn(),
    };
    const manager = {
      getRepository: jest.fn((entity) =>
        entity === User ? userRepository : verificationRepository,
      ),
    };
    const dataSource = {
      transaction: jest.fn(async (callback: (value: typeof manager) => unknown) =>
        callback(manager),
      ),
    };
    const email = { sendVerificationEmail: jest.fn().mockResolvedValue(undefined) };

    return {
      service: new RegistrationService(
        userRepository as never,
        verificationRepository as never,
        dataSource as never,
        email as never,
      ),
      userRepository,
      verificationRepository,
      dataSource,
      email,
      manager,
    };
  };

  it('creates every new registration inactive and pending internal review', async () => {
    const { service, userRepository, email } = makeService();

    await service.register({
      fullName: 'New AssetPass User',
      email: 'new.user@example.com',
      password: 'a-secure-password-123',
    });

    expect(userRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        status: UserStatus.INACTIVE,
        approvalStatus: UserApprovalStatus.PENDING_REVIEW,
        emailVerifiedAt: null,
      }),
    );
    expect(email.sendVerificationEmail).toHaveBeenCalledTimes(1);
  });

  it('does not activate an email-verified account while internal approval is pending', async () => {
    const { service, userRepository, verificationRepository } = makeService();
    const verification = {
      id: 'verification-1',
      userId: 'user-1',
      usedAt: null,
    };
    const user = {
      id: 'user-1',
      status: UserStatus.INACTIVE,
      approvalStatus: UserApprovalStatus.PENDING_REVIEW,
      emailVerifiedAt: null,
      deactivatedAt: null,
    };
    const readQuery = {
      setLock: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(verification),
    };
    const updateQuery = {
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    verificationRepository.createQueryBuilder
      .mockReturnValueOnce(readQuery)
      .mockReturnValueOnce(updateQuery);
    userRepository.findOne.mockResolvedValue(user);

    const result = await service.verify('a'.repeat(43));

    expect(user.emailVerifiedAt).toBeInstanceOf(Date);
    expect(user.status).toBe(UserStatus.INACTIVE);
    expect(result.message).toContain('awaiting AssetPass administrator approval');
  });

  it('activates an account only when email verification and internal approval are both complete', async () => {
    const { service, userRepository, verificationRepository } = makeService();
    const verification = {
      id: 'verification-2',
      userId: 'user-2',
      usedAt: null,
    };
    const user = {
      id: 'user-2',
      status: UserStatus.INACTIVE,
      approvalStatus: UserApprovalStatus.APPROVED,
      emailVerifiedAt: null,
      deactivatedAt: null,
    };
    const readQuery = {
      setLock: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(verification),
    };
    const updateQuery = {
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    verificationRepository.createQueryBuilder
      .mockReturnValueOnce(readQuery)
      .mockReturnValueOnce(updateQuery);
    userRepository.findOne.mockResolvedValue(user);

    const result = await service.verify('b'.repeat(43));

    expect(user.status).toBe(UserStatus.ACTIVE);
    expect(user.emailVerifiedAt).toBeInstanceOf(Date);
    expect(result.message).toContain('You can now sign in');
  });
});
