import { RegistrationService } from './registration.service';
import { PlatformAuditLog } from '../audit/entities/platform-audit-log.entity';
import { User, UserApprovalStatus, UserStatus } from '../identity/entities/user.entity';

jest.mock('argon2', () => ({
  hash: jest.fn().mockResolvedValue('hashed-password'),
}));

describe('RegistrationService early-launch access policy', () => {
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
    const auditRepository = { save: jest.fn(async (value) => value) };
    const manager = {
      getRepository: jest.fn((entity) => {
        if (entity === User) return userRepository;
        if (entity === PlatformAuditLog) return auditRepository;
        return verificationRepository;
      }),
    };
    const dataSource = {
      transaction: jest.fn(async (callback: (value: typeof manager) => unknown) => callback(manager)),
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
      auditRepository,
      email,
    };
  };

  it('creates an active, approved and internally verified account without sending email', async () => {
    const { service, userRepository, verificationRepository, auditRepository, email } = makeService();

    const result = await service.register({
      fullName: 'New AssetPass User',
      email: 'new.user@example.com',
      password: 'a-secure-password-123',
    });

    expect(userRepository.create).toHaveBeenCalledWith(expect.objectContaining({
      status: UserStatus.ACTIVE,
      approvalStatus: UserApprovalStatus.APPROVED,
      emailVerifiedAt: expect.any(Date),
      approvalReviewedByUserId: null,
      approvalReviewedAt: expect.any(Date),
      approvalNote: expect.stringContaining('early-launch'),
    }));
    expect(verificationRepository.save).not.toHaveBeenCalled();
    expect(email.sendVerificationEmail).not.toHaveBeenCalled();
    expect(auditRepository.save).toHaveBeenCalledWith(expect.objectContaining({
      actorUserId: null,
      action: 'auth.user.registered',
      entityType: 'user',
      outcome: 'success',
      metadata: expect.objectContaining({
        accountStatus: UserStatus.ACTIVE,
        approvalStatus: UserApprovalStatus.APPROVED,
        emailVerifiedInternally: true,
        emailVerificationEmailSent: false,
      }),
    }));
    expect(result.message).toContain('you can sign in now');
  });

  it('retains optional verification for legacy unverified accounts', async () => {
    const { service, userRepository, verificationRepository } = makeService();
    const verification = { id: 'verification-1', userId: 'user-1', usedAt: null };
    const user = {
      id: 'user-1',
      status: UserStatus.ACTIVE,
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
    verificationRepository.createQueryBuilder.mockReturnValueOnce(readQuery).mockReturnValueOnce(updateQuery);
    userRepository.findOne.mockResolvedValue(user);

    const result = await service.verify('b'.repeat(43));

    expect(user.status).toBe(UserStatus.ACTIVE);
    expect(user.emailVerifiedAt).toBeInstanceOf(Date);
    expect(result.message).toContain('approved and you can sign in');
  });
});
