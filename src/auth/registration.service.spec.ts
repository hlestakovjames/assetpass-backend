import { RegistrationService } from './registration.service';
import { PlatformAuditLog } from '../audit/entities/platform-audit-log.entity';
import { Organization } from '../organizations/entities/organization.entity';
import { OrganizationMembership } from '../organizations/entities/organization-membership.entity';
import { UserProfile } from '../identity/entities/user-profile.entity';
import { UserConsent } from '../identity/entities/user-consent.entity';
import { User, UserApprovalStatus, UserStatus } from '../identity/entities/user.entity';
import { EmailVerification } from './email-verification.entity';

jest.mock('argon2', () => ({ hash: jest.fn().mockResolvedValue('hashed-password') }));

describe('RegistrationService early-launch registration', () => {
  const makeService = () => {
    const makeRepo = () => ({
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => ({ ...value, id: value.id ?? 'record-1' })),
      findOne: jest.fn(),
      createQueryBuilder: jest.fn(),
    });
    const repositories = new Map<unknown, ReturnType<typeof makeRepo>>([
      [User, makeRepo()],
      [UserProfile, makeRepo()],
      [UserConsent, makeRepo()],
      [Organization, makeRepo()],
      [OrganizationMembership, makeRepo()],
      [PlatformAuditLog, makeRepo()],
      [EmailVerification, makeRepo()],
    ]);
    const manager = {
      getRepository: jest.fn((entity) => repositories.get(entity)!),
    };
    const dataSource = {
      transaction: jest.fn(async (callback: (value: typeof manager) => unknown) => callback(manager)),
    };
    const email = { sendVerificationEmail: jest.fn().mockResolvedValue(undefined) };
    const service = new RegistrationService(
      repositories.get(User) as never,
      repositories.get(EmailVerification) as never,
      dataSource as never,
      email as never,
    );
    return { service, repositories, manager, dataSource, email };
  };

  it('creates an active individual account and profile without sending verification email', async () => {
    const { service, repositories, email } = makeService();
    const userRepo = repositories.get(User)!;
    const profileRepo = repositories.get(UserProfile)!;
    const auditRepo = repositories.get(PlatformAuditLog)!;
    const verificationRepo = repositories.get(EmailVerification)!;
    const consentRepo = repositories.get(UserConsent)!;

    const result = await service.register({
      accountType: 'individual',
      firstName: 'New',
      middleName: 'AssetPass',
      lastName: 'User',
      email: 'new.user@example.com',
      password: 'a-secure-password-123',
      phoneNumber: '+254712345678',
      countryCode: 'KE',
      termsAccepted: true,
    });

    expect(userRepo.create).toHaveBeenCalledWith(expect.objectContaining({
      fullName: 'New AssetPass User',
      status: UserStatus.ACTIVE,
      approvalStatus: UserApprovalStatus.APPROVED,
      emailVerifiedAt: expect.any(Date),
      approvalReviewedByUserId: null,
    }));
    expect(profileRepo.create).toHaveBeenCalledWith(expect.objectContaining({
      firstName: 'New',
      middleName: 'AssetPass',
      lastName: 'User',
      phoneNumber: '+254712345678',
    }));
    expect(verificationRepo.save).not.toHaveBeenCalled();
    expect(consentRepo.save).toHaveBeenCalledWith([
      expect.objectContaining({ userId: 'record-1', consentType: 'terms_of_service', version: '2026-11-09', acceptedAt: expect.any(Date) }),
      expect.objectContaining({ userId: 'record-1', consentType: 'privacy_notice', version: '2026-11-09', acceptedAt: expect.any(Date) }),
    ]);
    expect(email.sendVerificationEmail).not.toHaveBeenCalled();
    expect(auditRepo.save).toHaveBeenCalledWith(expect.objectContaining({
      action: 'auth.user.registered',
      outcome: 'success',
      metadata: expect.objectContaining({
        accountType: 'individual',
        accountStatus: UserStatus.ACTIVE,
        approvalStatus: UserApprovalStatus.APPROVED,
        emailVerifiedInternally: true,
        emailVerificationEmailSent: false,
      }),
    }));
    expect(result.message).toContain('you can sign in now');
  });

  it('creates an organization and pending initial membership in the same transaction', async () => {
    const { service, repositories, dataSource, email } = makeService();
    const organizationRepo = repositories.get(Organization)!;
    const membershipRepo = repositories.get(OrganizationMembership)!;
    const result = await service.register({
      accountType: 'organization',
      firstName: 'Jane',
      lastName: 'Director',
      email: 'jane@example.com',
      password: 'a-secure-password-123',
      phoneNumber: '+254712345678',
      countryCode: 'KE',
      organizationDisplayName: 'Example Foundation',
      organizationType: 'NGO',
      industrySector: 'Community development',
      contactEmail: 'info@example.org',
      contactPhone: '+254700000000',
      physicalAddress: 'Kisumu, Kenya',
      termsAccepted: true,
      position: 'Director',
      registrationRelationship: 'Director',
      authorityConfirmation: 'YES',
    });

    expect(dataSource.transaction).toHaveBeenCalledTimes(1);
    expect(organizationRepo.create).toHaveBeenCalledWith(expect.objectContaining({
      displayName: 'Example Foundation',
      status: 'pending_review',
      physicalAddress: 'Kisumu, Kenya',
    }));
    expect(membershipRepo.create).toHaveBeenCalledWith(expect.objectContaining({
      status: 'pending',
      joinedAt: null,
    }));
    expect(email.sendVerificationEmail).not.toHaveBeenCalled();
    expect(result.message).toContain('submitted for platform review');
  });

  it('rejects organization registration without a physical address or official phone', async () => {
    const { service, dataSource } = makeService();
    await expect(service.register({
      accountType: 'organization',
      firstName: 'Jane',
      lastName: 'Director',
      email: 'jane@example.com',
      password: 'a-secure-password-123',
      phoneNumber: '+254712345678',
      organizationDisplayName: 'Example Foundation',
      organizationType: 'NGO',
      contactEmail: 'info@example.org',
      contactPhone: '',
      physicalAddress: '',
      termsAccepted: true,
      position: 'Director',
      registrationRelationship: 'Director',
      authorityConfirmation: 'YES',
    })).rejects.toThrow('Organization name, type, official email, official phone, physical address, contact position and registration authority confirmation are required.');
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it('retains optional verification for legacy unverified accounts', async () => {
    const { service, repositories, dataSource } = makeService();
    const verificationRepo = repositories.get(EmailVerification)!;
    const userRepo = repositories.get(User)!;
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
    verificationRepo.createQueryBuilder.mockReturnValueOnce(readQuery).mockReturnValueOnce(updateQuery);
    userRepo.findOne.mockResolvedValue(user);

    const result = await service.verify('b'.repeat(43));

    expect(dataSource.transaction).toHaveBeenCalled();
    expect(user.emailVerifiedAt).toBeInstanceOf(Date);
    expect(result.message).toContain('approved and you can sign in');
  });
});
