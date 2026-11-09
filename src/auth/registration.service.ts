import { BadRequestException, ConflictException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as argon2 from 'argon2';
import { createHash, randomBytes } from 'node:crypto';
import { DataSource, IsNull, MoreThan, Repository } from 'typeorm';
import { User, UserApprovalStatus, UserStatus } from '../identity/entities/user.entity';
import { UserProfile } from '../identity/entities/user-profile.entity';
import { PlatformAuditLog } from '../audit/entities/platform-audit-log.entity';
import { Organization, OrganizationStatus } from '../organizations/entities/organization.entity';
import { OrganizationMembership, OrganizationMembershipStatus } from '../organizations/entities/organization-membership.entity';
import { EmailVerification } from './email-verification.entity';
import { EmailDeliveryService } from './email-delivery.service';

const VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;
const GENERIC_MESSAGE = 'Registration received. If this is a new account, it is ready for sign-in.';
const REGISTRATION_SUCCESS_MESSAGE = 'Registration successful. Your account is active and you can sign in now.';
const ORGANIZATION_SUCCESS_MESSAGE = 'Your AssetPass account is active. Your organization registration has been submitted for platform review.';
const logger = new Logger('RegistrationService');

type CommonRegistration = {
  accountType?: 'individual' | 'organization';
  firstName?: string;
  middleName?: string;
  lastName?: string;
  fullName?: string;
  email: string;
  password: string;
  phoneNumber?: string;
  alternativePhone?: string;
  countryCode?: string;
  county?: string;
  city?: string;
  physicalAddress?: string;
  postalAddress?: string;
  occupation?: string;
  preferredContactMethod?: 'email' | 'phone';
};

type OrganizationRegistration = CommonRegistration & {
  accountType: 'organization';
  organizationDisplayName: string;
  legalName?: string;
  organizationType: string;
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
  postalCode?: string;
  taxIdentifier?: string;
  position?: string;
  registrationRelationship?: string;
  authorityConfirmation?: string;
};

@Injectable()
export class RegistrationService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(EmailVerification) private readonly verifications: Repository<EmailVerification>,
    private readonly dataSource: DataSource,
    private readonly email: EmailDeliveryService,
  ) {}

  async register(input: CommonRegistration | OrganizationRegistration) {
    if (!input || typeof input !== 'object') throw new BadRequestException('Registration details are required.');

    const accountType = input.accountType ?? 'individual';
    if (accountType !== 'individual' && accountType !== 'organization') {
      throw new BadRequestException('Choose an individual or organization account.');
    }

    const email = normalizeEmail(input.email);
    const password = input.password;
    const parts = resolveNameParts(input);
    const fullName = [parts.firstName, parts.middleName, parts.lastName].filter(Boolean).join(' ').trim();
    const phoneNumber = normalizePhone(input.phoneNumber);

    if (!parts.firstName || !parts.lastName || parts.firstName.length > 100 || (parts.middleName?.length ?? 0) > 100 || parts.lastName.length > 100) {
      throw new BadRequestException('Enter your first and last name. Middle name is optional.');
    }
    if (!email || email.length > 320 || !isEmail(email)) throw new BadRequestException('Enter a valid email address.');
    if (typeof password !== 'string' || password.length < 12 || password.length > 1024) {
      throw new BadRequestException('Use a password containing at least 12 characters.');
    }
    if (!phoneNumber || !isPhone(phoneNumber)) throw new BadRequestException('Enter a valid mobile phone number.');
    if (input.alternativePhone && !isPhone(normalizePhone(input.alternativePhone))) {
      throw new BadRequestException('Enter a valid alternative phone number.');
    }

    const organizationInput = accountType === 'organization' ? input as OrganizationRegistration : null;
    const organization = organizationInput ? validateOrganization(organizationInput) : null;
    const passwordHash = await argon2.hash(password);
    const now = new Date();

    try {
      await this.dataSource.transaction(async (manager) => {
        const userRepo = manager.getRepository(User);
        const created = await userRepo.save(userRepo.create({
          fullName,
          email,
          passwordHash,
          status: UserStatus.ACTIVE,
          approvalStatus: UserApprovalStatus.APPROVED,
          approvalReviewedByUserId: null,
          approvalReviewedAt: now,
          approvalNote: 'Automatically approved under the early-launch registration access policy.',
          emailVerifiedAt: now,
          isFoundingAssetManager: false,
          lastLoginAt: null,
          deactivatedAt: null,
        }));

        await manager.getRepository(UserProfile).save(manager.getRepository(UserProfile).create({
          userId: created.id,
          firstName: parts.firstName,
          middleName: parts.middleName || null,
          lastName: parts.lastName,
          phoneNumber,
          alternativePhone: input.alternativePhone ? normalizePhone(input.alternativePhone) : null,
          countryCode: normalizeCountryCode(input.countryCode),
          county: cleanOptional(input.county, 160),
          city: cleanOptional(input.city, 160),
          physicalAddress: cleanOptional(input.physicalAddress, 2000),
          postalAddress: cleanOptional(input.postalAddress, 200),
          occupation: cleanOptional(input.occupation, 160),
          preferredContactMethod: input.preferredContactMethod === 'phone' ? 'phone' : 'email',
        }));

        if (organization) {
          const organizationRepo = manager.getRepository(Organization);
          const createdOrganization = await organizationRepo.save(organizationRepo.create({
            displayName: organization.displayName,
            legalName: organization.legalName,
            category: organization.industrySector || organization.organizationType,
            organizationType: organization.organizationType,
            primaryContactPosition: organization.primaryContactPosition,
            registrationContactRelationship: organization.registrationContactRelationship,
            authorityConfirmedAt: organization.authorityConfirmedAt,
            industrySector: organization.industrySector,
            legalStructure: organization.legalStructure,
            registrationNumber: organization.registrationNumber,
            registrationAuthority: organization.registrationAuthority,
            registrationDate: organization.registrationDate,
            contactEmail: organization.contactEmail,
            alternativeEmail: organization.alternativeEmail,
            contactPhone: organization.contactPhone,
            website: organization.website,
            description: organization.description,
            countryCode: organization.countryCode,
            county: organization.county,
            city: organization.city,
            physicalAddress: organization.physicalAddress,
            postalAddress: organization.postalAddress,
            postalCode: organization.postalCode,
            taxIdentifier: organization.taxIdentifier,
            status: OrganizationStatus.PENDING_REVIEW,
            createdByUserId: created.id,
          }));

          await manager.getRepository(OrganizationMembership).save(
            manager.getRepository(OrganizationMembership).create({
              organizationId: createdOrganization.id,
              userId: created.id,
              status: OrganizationMembershipStatus.PENDING,
              invitedByUserId: null,
              joinedAt: null,
            }),
          );

          await manager.getRepository(PlatformAuditLog).save({
            actorUserId: created.id,
            action: 'organization.registration.submitted',
            entityType: 'organization',
            entityId: createdOrganization.id,
            outcome: 'success',
            reason: null,
            metadata: {
              registrationMethod: 'self_service',
              organizationStatus: createdOrganization.status,
              initialMembershipStatus: OrganizationMembershipStatus.PENDING,
            },
          });
        }

        await manager.getRepository(PlatformAuditLog).save({
          actorUserId: null,
          action: 'auth.user.registered',
          entityType: 'user',
          entityId: created.id,
          outcome: 'success',
          reason: 'Automatic activation under the early-launch registration access policy.',
          metadata: {
            registrationMethod: 'self_service',
            accountType,
            accountStatus: created.status,
            approvalStatus: created.approvalStatus,
            emailVerifiedInternally: Boolean(created.emailVerifiedAt),
            emailVerificationEmailSent: false,
          },
        });
      });

      return { message: organization ? ORGANIZATION_SUCCESS_MESSAGE : REGISTRATION_SUCCESS_MESSAGE };
    } catch (error) {
      if (isUniqueViolation(error)) {
        if (organization?.registrationNumber) throw new ConflictException('An organization with this registration number already exists.');
        return { message: GENERIC_MESSAGE };
      }
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
      user.emailVerifiedAt = user.emailVerifiedAt ?? new Date();
      await userRepo.save(user);
      await verificationRepo.createQueryBuilder().update().set({ usedAt: new Date() })
        .where('user_id = :userId AND used_at IS NULL', { userId: user.id }).execute();

      if (user.approvalStatus === UserApprovalStatus.APPROVED) {
        return { message: 'Your email address has been verified. Your account is approved and you can sign in.' };
      }
      if (user.approvalStatus === UserApprovalStatus.REJECTED) {
        return { message: 'Your email address has been verified, but this account was not approved for access.' };
      }
      return { message: 'Your email address has been verified. Your account is awaiting AssetPass administrator approval before sign-in.' };
    });
  }

  async resend(emailInput: string) {
    const email = typeof emailInput === 'string' ? emailInput.trim().toLowerCase() : '';
    if (!email || email.length > 320 || !isEmail(email)) throw new BadRequestException('Enter a valid email address.');

    const user = await this.users.findOne({
      where: {
        email, status: UserStatus.INACTIVE,
        approvalStatus: UserApprovalStatus.APPROVED,
        emailVerifiedAt: IsNull(), deactivatedAt: IsNull(),
      },
    });
    if (!user) return { message: GENERIC_MESSAGE };

    const recentlyIssued = await this.verifications.findOne({
      where: { userId: user.id, createdAt: MoreThan(new Date(Date.now() - 60_000)) },
      order: { createdAt: 'DESC' },
    });
    if (recentlyIssued) return { message: GENERIC_MESSAGE };

    const token = randomBytes(32).toString('base64url');
    await this.dataSource.transaction(async (manager) => {
      await manager.getRepository(EmailVerification).createQueryBuilder().update().set({ usedAt: new Date() })
        .where('user_id = :userId AND used_at IS NULL', { userId: user.id }).execute();
      await manager.getRepository(EmailVerification).save({
        userId: user.id, tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + VERIFICATION_TTL_MS), usedAt: null,
      });
    });

    try { await this.email.sendVerificationEmail(user.email, user.fullName, token); }
    catch { logger.error('Verification email resend failed.'); }
    return { message: GENERIC_MESSAGE };
  }
}

function resolveNameParts(input: CommonRegistration) {
  if (input.firstName || input.lastName) {
    return {
      firstName: input.firstName?.trim() ?? '',
      middleName: input.middleName?.trim() ?? '',
      lastName: input.lastName?.trim() ?? '',
    };
  }
  const legacy = typeof input.fullName === 'string' ? input.fullName.trim().split(/\s+/) : [];
  return {
    firstName: legacy[0] ?? '',
    middleName: legacy.length > 2 ? legacy.slice(1, -1).join(' ') : '',
    lastName: legacy.length > 1 ? legacy[legacy.length - 1] : '',
  };
}

function validateOrganization(input: OrganizationRegistration) {
  const displayName = cleanRequired(input.organizationDisplayName, 200);
  const organizationType = cleanRequired(input.organizationType, 80);
  const contactEmail = normalizeEmail(input.contactEmail);
  const contactPhone = normalizePhone(input.contactPhone);
  const physicalAddress = cleanRequired(input.physicalAddress, 2000);
  const primaryContactPosition = cleanRequired(input.position, 160);
  const registrationContactRelationship = cleanRequired(input.registrationRelationship, 120);
  const authorityConfirmed = typeof input.authorityConfirmation === 'string' && input.authorityConfirmation.trim().toLowerCase() === 'yes';
  const registrationNumber = cleanOptional(input.registrationNumber, 100);
  const registrationDate = cleanOptional(input.registrationDate, 10);
  if (!displayName || !organizationType || !contactEmail || !isEmail(contactEmail) || !contactPhone || !isPhone(contactPhone) || !physicalAddress || !primaryContactPosition || !registrationContactRelationship || !authorityConfirmed) {
    throw new BadRequestException('Organization name, type, official email, official phone, physical address, contact position and registration authority confirmation are required.');
  }
  if (registrationDate && (!/^\d{4}-\d{2}-\d{2}$/.test(registrationDate) || Number.isNaN(Date.parse(registrationDate)) || new Date(registrationDate).toISOString().slice(0, 10) !== registrationDate)) {
    throw new BadRequestException('Enter a valid registration date in YYYY-MM-DD format.');
  }
  if (registrationNumber && !registrationDate && input.registrationDate) {
    throw new BadRequestException('Enter a valid registration date.');
  }
  const countryCode = normalizeCountryCode(input.countryCode);
  return {
    displayName,
    organizationType,
    primaryContactPosition,
    registrationContactRelationship,
    authorityConfirmedAt: new Date(),
    legalName: cleanOptional(input.legalName, 250),
    industrySector: cleanOptional(input.industrySector, 120),
    legalStructure: cleanOptional(input.legalStructure, 80),
    registrationNumber,
    registrationAuthority: cleanOptional(input.registrationAuthority, 160),
    registrationDate,
    contactEmail,
    contactPhone,
    alternativeEmail: cleanOptional(input.alternativeEmail, 320),
    website: cleanOptional(input.website, 500),
    description: cleanOptional(input.description, 10000),
    countryCode,
    county: cleanOptional(input.county, 160),
    city: cleanOptional(input.city, 160),
    physicalAddress,
    postalAddress: cleanOptional(input.postalAddress, 200),
    postalCode: cleanOptional(input.postalCode, 30),
    taxIdentifier: cleanOptional(input.taxIdentifier, 100),
  };
}

function cleanRequired(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}
function cleanOptional(value: unknown, max: number): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const result = value.trim();
  if (result.length > max) throw new BadRequestException('One or more fields exceed the allowed length.');
  return result;
}
function normalizeEmail(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}
function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}
function normalizePhone(value: unknown): string {
  return typeof value === 'string' ? value.trim().replace(/[\s()-]/g, '') : '';
}
function isPhone(value: string): boolean {
  return /^\+?[0-9]{9,15}$/.test(value);
}
function normalizeCountryCode(value: unknown): string {
  const code = typeof value === 'string' ? value.trim().toUpperCase() : 'KE';
  return /^[A-Z]{2}$/.test(code) ? code : 'KE';
}
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: string }).code === '23505';
}
