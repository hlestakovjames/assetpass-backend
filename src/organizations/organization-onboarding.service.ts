import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomBytes } from 'node:crypto';
import { DataSource, IsNull, Repository } from 'typeorm';
import { PlatformAuditLog } from '../audit/entities/platform-audit-log.entity';
import { OrganizationRole } from '../access-control/entities/organization-role.entity';
import { OrganizationMembershipRole } from '../access-control/entities/organization-membership-role.entity';
import { User, UserApprovalStatus, UserStatus } from '../identity/entities/user.entity';
import { Organization, OrganizationStatus } from './entities/organization.entity';
import { OrganizationMembership, OrganizationMembershipStatus } from './entities/organization-membership.entity';
import { OrganizationOnboardingApplication, OrganizationOnboardingStatus } from './entities/organization-onboarding-application.entity';
import { EmailDeliveryService } from '../auth/email-delivery.service';

const VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;
const GENERIC_RESEND_MESSAGE = 'If a pending organisation application exists for that representative email, a verification link will be sent.';

export interface OrganizationFirstApplicationInput {
  representativeFirstName: string;
  representativeLastName: string;
  representativeEmail: string;
  representativePosition: string;
  registrationRelationship: string;
  authorityConfirmation: string;
  privacyNoticeAcknowledged: boolean;
  organizationDisplayName: string;
  organizationType: string;
  legalName?: string;
  industrySector?: string;
  legalStructure?: string;
  registrationNumber?: string;
  registrationAuthority?: string;
  registrationDate?: string;
  contactEmail: string;
  contactPhone: string;
  alternativeEmail?: string;
  website?: string;
  description?: string;
  countryCode?: string;
  county?: string;
  city?: string;
  physicalAddress: string;
  postalAddress?: string;
  postalCode?: string;
  taxIdentifier?: string;
}

@Injectable()
export class OrganizationOnboardingService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(OrganizationOnboardingApplication)
    private readonly applications: Repository<OrganizationOnboardingApplication>,
    private readonly email: EmailDeliveryService,
  ) {}

  async submit(input: OrganizationFirstApplicationInput) {
    const data = validateApplication(input);
    const token = randomBytes(32).toString('base64url');
    const application = await this.dataSource.transaction(async (manager) => {
      const record = await manager.getRepository(OrganizationOnboardingApplication).save({
        representativeFirstName: data.representativeFirstName,
        representativeLastName: data.representativeLastName,
        representativeEmail: data.representativeEmail,
        representativePosition: data.representativePosition,
        registrationRelationship: data.registrationRelationship,
        authorityConfirmedAt: new Date(),
        organizationData: data.organizationData,
        verificationTokenHash: hashToken(token),
        verificationExpiresAt: new Date(Date.now() + VERIFICATION_TTL_MS),
        emailVerifiedAt: null,
        organizationId: null,
        claimedByUserId: null,
        claimedAt: null,
        status: OrganizationOnboardingStatus.PENDING_EMAIL_VERIFICATION,
      });
      await manager.getRepository(PlatformAuditLog).save({
        actorUserId: null,
        action: 'organization.onboarding.application.submitted',
        entityType: 'organization_onboarding_application',
        entityId: record.id,
        outcome: 'success',
        reason: null,
        metadata: { representativeEmail: data.representativeEmail, status: record.status },
      });
      return record;
    });

    await this.email.sendOrganizationOnboardingVerificationEmail(
      application.representativeEmail,
      application.representativeFirstName,
      token,
    );
    return {
      applicationId: application.id,
      status: application.status,
      message: 'Your organisation application has been received. Verify the representative email address to submit it for platform review.',
    };
  }

  async resendVerification(emailInput: string) {
    const email = typeof emailInput === 'string' ? emailInput.trim().toLowerCase() : '';
    if (!isEmail(email)) throw new BadRequestException('Enter a valid representative email address.');
    const application = await this.applications.findOne({
      where: { representativeEmail: email, status: OrganizationOnboardingStatus.PENDING_EMAIL_VERIFICATION },
      order: { createdAt: 'DESC' },
    });
    if (!application || application.updatedAt.getTime() > Date.now() - 60_000) {
      return { message: GENERIC_RESEND_MESSAGE };
    }
    const token = randomBytes(32).toString('base64url');
    application.verificationTokenHash = hashToken(token);
    application.verificationExpiresAt = new Date(Date.now() + VERIFICATION_TTL_MS);
    await this.applications.save(application);
    try {
      await this.email.sendOrganizationOnboardingVerificationEmail(
        application.representativeEmail,
        application.representativeFirstName,
        token,
      );
    } catch {
      // Keep the response generic so application existence is not disclosed.
    }
    return { message: GENERIC_RESEND_MESSAGE };
  }

  async verify(tokenInput: string) {
    if (typeof tokenInput !== 'string' || tokenInput.length < 32 || tokenInput.length > 200) {
      throw new BadRequestException('This organisation verification link is invalid or has expired.');
    }
    return this.dataSource.transaction(async (manager) => {
      const rows = await manager.query(
        'SELECT id FROM organization_onboarding_applications WHERE verification_token_hash = $1 AND status = $2 AND verification_expires_at > NOW() FOR UPDATE',
        [hashToken(tokenInput), OrganizationOnboardingStatus.PENDING_EMAIL_VERIFICATION],
      ) as Array<{ id: string }>;
      if (!rows.length) throw new BadRequestException('This organisation verification link is invalid or has expired.');
      const applicationRepo = manager.getRepository(OrganizationOnboardingApplication);
      const application = await applicationRepo.findOneBy({ id: rows[0].id });
      if (!application) throw new BadRequestException('This organisation verification link is invalid or has expired.');
      const data = application.organizationData as Record<string, string | null>;
      const organization = await manager.getRepository(Organization).save({
        displayName: data.displayName,
        legalName: data.legalName,
        category: data.industrySector || data.organizationType,
        organizationType: data.organizationType,
        primaryContactPosition: application.representativePosition,
        registrationContactRelationship: application.registrationRelationship,
        authorityConfirmedAt: application.authorityConfirmedAt,
        industrySector: data.industrySector,
        legalStructure: data.legalStructure,
        registrationNumber: data.registrationNumber,
        registrationAuthority: data.registrationAuthority,
        registrationDate: data.registrationDate,
        contactEmail: data.contactEmail,
        alternativeEmail: data.alternativeEmail,
        contactPhone: data.contactPhone,
        website: data.website,
        description: data.description,
        countryCode: data.countryCode,
        county: data.county,
        city: data.city,
        physicalAddress: data.physicalAddress,
        postalAddress: data.postalAddress,
        postalCode: data.postalCode,
        taxIdentifier: data.taxIdentifier,
        status: OrganizationStatus.PENDING_REVIEW,
        createdByUserId: null,
      });
      application.emailVerifiedAt = new Date();
      application.organizationId = organization.id;
      application.status = OrganizationOnboardingStatus.SUBMITTED_FOR_REVIEW;
      application.verificationTokenHash = hashToken(randomBytes(32).toString('base64url'));
      await applicationRepo.save(application);
      await manager.getRepository(PlatformAuditLog).save({
        actorUserId: null,
        action: 'organization.onboarding.email.verified',
        entityType: 'organization',
        entityId: organization.id,
        outcome: 'success',
        reason: null,
        metadata: { applicationId: application.id, representativeEmail: application.representativeEmail },
      });
      return {
        applicationId: application.id,
        organizationId: organization.id,
        status: OrganizationOnboardingStatus.SUBMITTED_FOR_REVIEW,
        organizationStatus: organization.status,
        message: 'Representative email verified. The organisation application has been submitted for platform review.',
      };
    });
  }

  async claim(organizationId: string, userId: string) {
    return this.dataSource.transaction(async (manager) => {
      const rows = await manager.query(
        'SELECT id FROM organization_onboarding_applications WHERE organization_id = $1 AND status = $2 FOR UPDATE',
        [organizationId, OrganizationOnboardingStatus.SUBMITTED_FOR_REVIEW],
      ) as Array<{ id: string }>;
      if (!rows.length) throw new NotFoundException('An unclaimed organisation application was not found.');
      const applicationRepo = manager.getRepository(OrganizationOnboardingApplication);
      const application = await applicationRepo.findOneBy({ id: rows[0].id });
      const user = await manager.getRepository(User).findOneBy({ id: userId, status: UserStatus.ACTIVE, approvalStatus: UserApprovalStatus.APPROVED });
      if (!application || !user || !user.emailVerifiedAt || user.email.toLowerCase() !== application.representativeEmail) {
        throw new ConflictException('Use an active AssetPass account with a verified email address matching the organisation representative email.');
      }
      const organization = await manager.getRepository(Organization).findOneBy({
        id: organizationId,
        status: OrganizationStatus.ACTIVE,
      });
      if (!organization) throw new ConflictException('The organisation must be approved and active before it can be claimed.');
      const membershipRepo = manager.getRepository(OrganizationMembership);
      const existing = await membershipRepo.findOneBy({ organizationId, userId });
      if (existing && existing.status !== OrganizationMembershipStatus.REMOVED) {
        throw new ConflictException('This account already has an organisation membership.');
      }
      let membership: OrganizationMembership;
      if (existing) {
        membership = await membershipRepo.save({
          ...existing,
          status: OrganizationMembershipStatus.ACTIVE,
          invitedByUserId: null,
          joinedAt: new Date(),
        });
        await manager.getRepository(OrganizationMembershipRole).delete({ membershipId: membership.id });
      } else {
        membership = await membershipRepo.save({
          organizationId,
          userId,
          status: OrganizationMembershipStatus.ACTIVE,
          invitedByUserId: null,
          joinedAt: new Date(),
        });
      }
      const ownerRole = await manager.getRepository(OrganizationRole).findOne({
        where: { organizationId: IsNull(), key: 'organization_owner', isActive: true },
      });
      if (!ownerRole) throw new Error('System organization owner role is missing.');
      await manager.getRepository(OrganizationMembershipRole).save({
        membershipId: membership.id,
        roleId: ownerRole.id,
        assignedByUserId: null,
      });
      application.status = OrganizationOnboardingStatus.CLAIMED;
      application.claimedByUserId = userId;
      application.claimedAt = new Date();
      await applicationRepo.save(application);
      await manager.getRepository(PlatformAuditLog).save({
        actorUserId: userId,
        action: 'organization.onboarding.claimed',
        entityType: 'organization',
        entityId: organizationId,
        outcome: 'success',
        reason: null,
        metadata: { applicationId: application.id, membershipId: membership.id },
      });
      return { organizationId, membershipId: membership.id, status: OrganizationMembershipStatus.ACTIVE };
    });
  }
}

function validateApplication(input: OrganizationFirstApplicationInput) {
  if (!input || typeof input !== 'object') throw new BadRequestException('Organisation application details are required.');
  const required = (value: unknown, max: number) => typeof value === 'string' ? value.trim() : '';
  const first = required(input.representativeFirstName, 100);
  const last = required(input.representativeLastName, 100);
  const representativeEmail = required(input.representativeEmail, 320).toLowerCase();
  const position = required(input.representativePosition, 160);
  const relationship = required(input.registrationRelationship, 120);
  const displayName = required(input.organizationDisplayName, 200);
  const organizationType = required(input.organizationType, 80);
  const contactEmail = required(input.contactEmail, 320).toLowerCase();
  const contactPhone = normalizePhone(input.contactPhone);
  const physicalAddress = required(input.physicalAddress, 2000);
  if (!first || first.length > 100 || !last || last.length > 100 || !isEmail(representativeEmail) ||
      !position || position.length > 160 || !relationship || relationship.length > 120 ||
      !displayName || displayName.length > 200 || !organizationType || organizationType.length > 80 ||
      !isEmail(contactEmail) || !isPhone(contactPhone) || !physicalAddress || physicalAddress.length > 2000 ||
      typeof input.authorityConfirmation !== 'string' || input.authorityConfirmation.trim().toLowerCase() !== 'yes' || input.privacyNoticeAcknowledged !== true) {
    throw new BadRequestException('Provide valid representative details, organisation name and type, official contact details, physical address, confirm authority to submit this application, and acknowledge the privacy notice.');
  }
  const alternativeEmail = optional(input.alternativeEmail, 320)?.toLowerCase() ?? null;
  if (alternativeEmail && !isEmail(alternativeEmail)) throw new BadRequestException('Enter a valid alternative organisation email.');
  const website = optional(input.website, 500);
  if (website) {
    try { const url = new URL(website); if (!['http:', 'https:'].includes(url.protocol)) throw new Error(); }
    catch { throw new BadRequestException('Enter a valid organisation website URL including https://.'); }
  }
  const registrationDate = optional(input.registrationDate, 10);
  if (registrationDate && (!/^\d{4}-\d{2}-\d{2}$/.test(registrationDate) || Number.isNaN(Date.parse(registrationDate)))) {
    throw new BadRequestException('Enter a valid registration date in YYYY-MM-DD format.');
  }
  const countryCode = typeof input.countryCode === 'string' && /^[A-Za-z]{2}$/.test(input.countryCode.trim()) ? input.countryCode.trim().toUpperCase() : 'KE';
  return {
    representativeFirstName: first,
    representativeLastName: last,
    representativeEmail,
    representativePosition: position,
    registrationRelationship: relationship,
    organizationData: {
      displayName, organizationType,
      legalName: optional(input.legalName, 250),
      industrySector: optional(input.industrySector, 120),
      legalStructure: optional(input.legalStructure, 80),
      registrationNumber: optional(input.registrationNumber, 100),
      registrationAuthority: optional(input.registrationAuthority, 160),
      registrationDate,
      contactEmail,
      alternativeEmail,
      contactPhone,
      website,
      description: optional(input.description, 10000),
      countryCode,
      county: optional(input.county, 160),
      city: optional(input.city, 160),
      physicalAddress,
      postalAddress: optional(input.postalAddress, 200),
      postalCode: optional(input.postalCode, 30),
      taxIdentifier: optional(input.taxIdentifier, 100),
    },
  };
}
function optional(value: unknown, max: number): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const result = value.trim();
  if (result.length > max) throw new BadRequestException('One or more fields exceed the allowed length.');
  return result;
}
function normalizePhone(value: unknown): string { return typeof value === 'string' ? value.trim().replace(/[\s()-]/g, '') : ''; }
function isPhone(value: string): boolean { return /^\+?[0-9]{9,15}$/.test(value); }
function isEmail(value: string): boolean { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value); }
function hashToken(value: string): string { return createHash('sha256').update(value).digest('hex'); }
