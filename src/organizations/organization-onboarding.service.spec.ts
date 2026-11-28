import { ConflictException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { PlatformAuditLog } from '../audit/entities/platform-audit-log.entity';
import { OrganizationRole } from '../access-control/entities/organization-role.entity';
import { OrganizationMembershipRole } from '../access-control/entities/organization-membership-role.entity';
import { User } from '../identity/entities/user.entity';
import { Organization, OrganizationStatus } from './entities/organization.entity';
import { OrganizationMembership } from './entities/organization-membership.entity';
import { OrganizationMembershipEvent } from './entities/organization-membership-event.entity';
import { OrganizationOnboardingApplication, OrganizationOnboardingStatus } from './entities/organization-onboarding-application.entity';
import { OrganizationOnboardingSession } from './entities/organization-onboarding-session.entity';
import { OrganizationOnboardingService } from './organization-onboarding.service';

describe('OrganizationOnboardingService', () => {
  const application = {
    id: 'application-1',
    representativeFirstName: 'Amina',
    representativeLastName: 'Director',
    representativeEmail: 'amina@example.org',
    representativePosition: 'Director',
    registrationRelationship: 'Director',
    authorityConfirmedAt: new Date(),
    privacyNoticeAcknowledgedAt: new Date(),
    privacyNoticeVersion: '2026-11-09',
    organizationData: {
      displayName: 'Example Foundation',
      organizationType: 'NGO',
      industrySector: 'Community development',
      contactEmail: 'info@example.org',
      contactPhone: '+254700000000',
      physicalAddress: 'Nairobi, Kenya',
      countryCode: 'KE',
    },
    verificationTokenHash: 'hash',
    verificationExpiresAt: new Date(Date.now() + 60_000),
    emailVerifiedAt: null,
    organizationId: null,
    claimedByUserId: null,
    claimedAt: null,
    status: OrganizationOnboardingStatus.PENDING_EMAIL_VERIFICATION,
    updatedAt: new Date(0),
  };

  function setup() {
    const appRepo = { save: jest.fn(async (value) => ({ ...value, id: value.id ?? 'application-1' })), findOneBy: jest.fn() };
    const orgRepo = { save: jest.fn(async (value) => ({ ...value, id: 'organization-1', status: 'pending_review' })), findOneBy: jest.fn() };
    const membershipQueryBuilder = {
      setLock: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(null),
    };
    const membershipRepo = {
      findOneBy: jest.fn(),
      createQueryBuilder: jest.fn().mockReturnValue(membershipQueryBuilder),
      save: jest.fn(async (value) => ({ ...value, id: 'membership-1' })),
    };
    const membershipRoleRepo = { save: jest.fn(), update: jest.fn(), delete: jest.fn() };
    const membershipEventRepo = { create: jest.fn((value) => value), save: jest.fn(async (value) => value) };
    const roleRepo = { findOne: jest.fn().mockResolvedValue({ id: 'owner-role' }) };
    const userRepo = { findOneBy: jest.fn() };
    const auditRepo = { save: jest.fn() };
    const sessionRepo = { create: jest.fn((value) => value), save: jest.fn(async (value) => value), update: jest.fn(), findOneBy: jest.fn().mockResolvedValue({ id: 'session-1', applicationId: 'application-1', revokedAt: null }) };
    const repos = new Map<unknown, unknown>([
      [OrganizationOnboardingApplication, appRepo],
      [OrganizationOnboardingSession, sessionRepo],
      [Organization, orgRepo],
      [OrganizationMembership, membershipRepo],
      [OrganizationMembershipRole, membershipRoleRepo],
      [OrganizationMembershipEvent, membershipEventRepo],
      [OrganizationRole, roleRepo],
      [User, userRepo],
      [PlatformAuditLog, auditRepo],
    ]);
    const manager = {
      query: jest.fn(),
      getRepository: jest.fn((entity: unknown) => repos.get(entity)),
    };
    const dataSource = {
      getRepository: jest.fn((entity: unknown) => repos.get(entity)),
      query: jest.fn(),
      transaction: jest.fn(async (callback: (value: EntityManager) => unknown) => callback(manager as unknown as EntityManager)),
    };
    const email = { sendOrganizationOnboardingVerificationEmail: jest.fn().mockResolvedValue(undefined), sendOrganizationClaimInvitationEmail: jest.fn().mockResolvedValue(undefined) };
    const service = new OrganizationOnboardingService(
      dataSource as unknown as DataSource,
      appRepo as never,
      email as never,
    );
    return { service, manager, repos, appRepo, orgRepo, membershipRepo, membershipRoleRepo, roleRepo, userRepo, auditRepo, sessionRepo, dataSource, email };
  }

  it('accepts an organization application without creating a personal user account', async () => {
    const { service, appRepo, email, repos, dataSource } = setup();
    const result = await service.submit({
      representativeFirstName: 'Amina',
      representativeLastName: 'Director',
      representativeEmail: 'amina@example.org',
      representativePosition: 'Director',
      registrationRelationship: 'Director',
      authorityConfirmation: 'yes',
      privacyNoticeAcknowledged: true,
      organizationDisplayName: 'Example Foundation',
      organizationType: 'NGO',
      contactEmail: 'info@example.org',
      contactPhone: '+254700000000',
      physicalAddress: 'Nairobi, Kenya',
    });
    expect(result.status).toBe(OrganizationOnboardingStatus.PENDING_EMAIL_VERIFICATION);
    expect(appRepo.save).toHaveBeenCalledWith(expect.objectContaining({
      representativeEmail: 'amina@example.org',
      status: OrganizationOnboardingStatus.PENDING_EMAIL_VERIFICATION,
      organizationId: null,
    }));
    expect(email.sendOrganizationOnboardingVerificationEmail).toHaveBeenCalledWith(
      'amina@example.org', 'Amina', expect.any(String),
    );
    expect(repos.get(User)).toBeDefined();
    expect((repos.get(User) as { findOneBy: jest.Mock }).findOneBy).not.toHaveBeenCalled();
    expect(dataSource.transaction).toHaveBeenCalledTimes(1);
  });

  it('rejects email verification tokens that do not resolve to a pending application', async () => {
    const { service, manager, orgRepo } = setup();
    manager.query.mockResolvedValue([]);
    await expect(service.verify('v'.repeat(43))).rejects.toThrow('This organisation verification link is invalid or has expired.');
    expect(orgRepo.save).not.toHaveBeenCalled();
  });

  it('creates a pending-review organization only after representative email verification', async () => {
    const { service, manager, appRepo, orgRepo, sessionRepo } = setup();
    manager.query.mockResolvedValue([{ id: application.id }]);
    appRepo.findOneBy.mockResolvedValue({ ...application });
    const result = await service.verify('v'.repeat(43));
    expect(orgRepo.save).toHaveBeenCalledWith(expect.objectContaining({
      displayName: 'Example Foundation',
      status: 'pending_review',
      createdByUserId: null,
    }));
    expect(appRepo.save).toHaveBeenCalledWith(expect.objectContaining({
      status: OrganizationOnboardingStatus.SUBMITTED_FOR_REVIEW,
      organizationId: 'organization-1',
      emailVerifiedAt: expect.any(Date),
    }));
    expect(result.organizationId).toBe('organization-1');
    expect(result.onboardingSessionToken).toEqual(expect.any(String));
    expect(result.onboardingSessionExpiresAt).toEqual(expect.any(Date));
    expect(sessionRepo.save).toHaveBeenCalledWith(expect.objectContaining({
      applicationId: 'application-1', tokenHash: expect.any(String), scopes: ['application.read'],
      expiresAt: expect.any(Date), revokedAt: null,
    }));
  });

  it('requires an active account with the matching representative email and valid claim code', async () => {
    const { service, manager, dataSource, appRepo, userRepo, orgRepo, membershipRepo } = setup();
    dataSource.query.mockResolvedValue([{ organizationId: 'organization-1' }]);
    manager.query.mockResolvedValue([{ id: application.id }]);
    appRepo.findOneBy.mockResolvedValue({ ...application, status: OrganizationOnboardingStatus.SUBMITTED_FOR_REVIEW, organizationId: 'organization-1', emailVerifiedAt: new Date() });
    userRepo.findOneBy.mockResolvedValue({ id: 'user-1', email: 'other@example.org', emailVerifiedAt: null, status: 'active', approvalStatus: 'approved' });
    dataSource.query.mockResolvedValue([{ organizationId: 'organization-1' }]);
    await expect(service.claimWithToken('user-1', 'c'.repeat(43))).rejects.toBeInstanceOf(ConflictException);
    expect(orgRepo.findOneBy).not.toHaveBeenCalled();
    expect(membershipRepo.save).not.toHaveBeenCalled();
  });

  it('links the verified representative account as Organization Owner after platform approval', async () => {
    const { service, manager, dataSource, appRepo, userRepo, orgRepo, membershipRepo, membershipRoleRepo, auditRepo } = setup();
    dataSource.query.mockResolvedValue([{ organizationId: 'organization-1' }]);
    manager.query.mockResolvedValue([{ id: application.id }]);
    appRepo.findOneBy.mockResolvedValue({ ...application, status: OrganizationOnboardingStatus.SUBMITTED_FOR_REVIEW, organizationId: 'organization-1', emailVerifiedAt: new Date() });
    userRepo.findOneBy.mockResolvedValue({ id: 'user-1', email: 'amina@example.org', emailVerifiedAt: null, status: 'active', approvalStatus: 'approved' });
    orgRepo.findOneBy.mockResolvedValue({ id: 'organization-1', status: 'active' });
    membershipRepo.findOneBy.mockResolvedValue(null);
    const result = await service.claimWithToken('user-1', 'c'.repeat(43));
    expect(membershipRepo.save).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: 'organization-1', userId: 'user-1', status: 'active',
    }));
    expect(membershipRoleRepo.save).toHaveBeenCalledWith(expect.objectContaining({
      membershipId: 'membership-1', roleId: 'owner-role', assignedByUserId: 'user-1',
    }));
    expect(appRepo.save).toHaveBeenCalledWith(expect.objectContaining({
      status: OrganizationOnboardingStatus.CLAIMED, claimedByUserId: 'user-1',
    }));
    expect(auditRepo.save).toHaveBeenCalledWith(expect.objectContaining({
      action: 'organization.onboarding.claimed', actorUserId: 'user-1',
    }));
    expect(result.status).toBe('active');
  });
  it('returns only the application details needed by its restricted representative session', async () => {
    const { service, appRepo, orgRepo } = setup();
    appRepo.findOneBy.mockResolvedValue({
      ...application,
      status: OrganizationOnboardingStatus.SUBMITTED_FOR_REVIEW,
      organizationId: 'organization-1',
    });
    orgRepo.findOneBy.mockResolvedValue({
      id: 'organization-1',
      displayName: 'Example Foundation',
      status: OrganizationStatus.PENDING_REVIEW,
      decisionNote: null,
    });
    const result = await service.getOnboardingSession('application-1');
    expect(result).toEqual(expect.objectContaining({
      applicationId: 'application-1',
      status: OrganizationOnboardingStatus.SUBMITTED_FOR_REVIEW,
      representative: { firstName: 'Amina', lastName: 'Director', email: 'amina@example.org' },
      organization: expect.objectContaining({ id: 'organization-1', displayName: 'Example Foundation' }),
    }));
    expect(result).not.toHaveProperty('organizationData');
    expect(result).not.toHaveProperty('verificationTokenHash');
    expect(result).not.toHaveProperty('claimTokenHash');
  });

  it('closes a restricted onboarding session without affecting an AssetPass account', async () => {
    const { service, sessionRepo } = setup();
    await expect(service.closeOnboardingSession('session-1')).resolves.toEqual({ closed: true });
    expect(sessionRepo.save).toHaveBeenCalledWith(expect.objectContaining({ id: 'session-1', revokedAt: expect.any(Date) }));
  });

  it('issues a one-time claim invitation only for an approved organisation application', async () => {
    const { service, manager, appRepo, email } = setup();
    manager.query.mockResolvedValue([{ id: application.id }]);
    appRepo.findOneBy.mockResolvedValue({
      ...application,
      organizationId: 'organization-1',
      status: OrganizationOnboardingStatus.SUBMITTED_FOR_REVIEW,
    });
    const result = await service.issueClaimInvitation('organization-1', 'reviewer-1');
    expect(result).toEqual({ invitationIssued: true, emailSent: true });
    expect(appRepo.save).toHaveBeenCalledWith(expect.objectContaining({
      claimTokenHash: expect.any(String),
      claimTokenIssuedAt: expect.any(Date),
      claimTokenExpiresAt: expect.any(Date),
    }));
    expect(email.sendOrganizationClaimInvitationEmail).toHaveBeenCalledWith(
      'amina@example.org', 'Amina', 'Example Foundation', expect.any(String),
    );
  });

  it('rejects invalid or expired claim tokens before opening a claim transaction', async () => {
    const { service, dataSource } = setup();
    dataSource.query.mockResolvedValue([]);
    await expect(service.claimWithToken('user-1', 'x'.repeat(43))).rejects.toThrow(
      'This organisation claim code is invalid or has expired.',
    );
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

});
