import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { PlatformAuditLog } from '../audit/entities/platform-audit-log.entity';
import { Organization, OrganizationStatus } from './entities/organization.entity';
import { OrganizationMembership, OrganizationMembershipStatus } from './entities/organization-membership.entity';
import { OrganizationRole } from '../access-control/entities/organization-role.entity';
import { OrganizationMembershipRole } from '../access-control/entities/organization-membership-role.entity';

export interface RegisterOrganizationInput {
  displayName: string; legalName?: string; category: string; registrationNumber?: string;
  contactEmail: string; contactPhone?: string; website?: string; description?: string;
  countryCode?: string; county?: string; city?: string;
}

@Injectable()
export class OrganizationsService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(Organization) private readonly organizations: Repository<Organization>,
    @InjectRepository(OrganizationMembership) private readonly memberships: Repository<OrganizationMembership>,
  ) {}

  async register(userId: string, input: RegisterOrganizationInput): Promise<Organization> {
    const displayName = input.displayName?.trim();
    const category = input.category?.trim();
    const contactEmail = input.contactEmail?.trim().toLowerCase();
    if (!displayName || displayName.length > 200 || !category || category.length > 80 || !contactEmail || contactEmail.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) {
      throw new BadRequestException('A valid organization name, category and contact email are required.');
    }
    const registrationNumber = input.registrationNumber?.trim() || null;
    if (registrationNumber && await this.organizations.exist({ where: { registrationNumber } })) {
      throw new ConflictException('An organization with this registration number already exists.');
    }
    return this.dataSource.transaction(async (manager) => {
      const orgRepo = manager.getRepository(Organization);
      const memberRepo = manager.getRepository(OrganizationMembership);
      const organization = await orgRepo.save(orgRepo.create({
        displayName, legalName: input.legalName?.trim() || null, category, registrationNumber,
        contactEmail, contactPhone: input.contactPhone?.trim() || null, website: input.website?.trim() || null,
        description: input.description?.trim() || null, countryCode: (input.countryCode?.trim().toUpperCase() || 'KE').slice(0, 2),
        county: input.county?.trim() || null, city: input.city?.trim() || null,
        status: OrganizationStatus.PENDING_REVIEW, createdByUserId: userId,
      }));
      await memberRepo.save(memberRepo.create({
        organizationId: organization.id, userId, status: OrganizationMembershipStatus.PENDING,
        invitedByUserId: null, joinedAt: null,
      }));
      await manager.getRepository(PlatformAuditLog).save({
        actorUserId: userId, action: 'organization.registration.submitted', entityType: 'organization',
        entityId: organization.id, outcome: 'success', reason: null, metadata: { status: organization.status },
      });
      return organization;
    });
  }

  async findMine(userId: string) {
    return this.memberships.createQueryBuilder('membership')
      .innerJoin('organizations', 'organization', 'organization.id = membership.organization_id')
      .where('membership.user_id = :userId', { userId })
      .andWhere('membership.status IN (:...statuses)', { statuses: [OrganizationMembershipStatus.ACTIVE, OrganizationMembershipStatus.PENDING] })
      .select([
        'membership.id AS membership_id', 'membership.status AS membership_status',
        'membership.created_at AS membership_created_at', 'organization.id AS id',
        'organization.display_name AS display_name', 'organization.category AS category',
        'organization.status AS status',
      ])
      .orderBy('membership.created_at', 'DESC').getRawMany();
  }

  async list(status?: OrganizationStatus) {
    if (status && !Object.values(OrganizationStatus).includes(status)) throw new BadRequestException('Invalid organization status filter.');
    return this.organizations.find({ where: status ? { status } : {}, order: { createdAt: 'DESC' } });
  }

  async review(id: string, actorUserId: string, status: OrganizationStatus, note?: string) {
    if (![OrganizationStatus.ACTIVE, OrganizationStatus.REJECTED, OrganizationStatus.SUSPENDED].includes(status)) throw new BadRequestException('Unsupported organization status transition.');
    if (status === OrganizationStatus.REJECTED && !note?.trim()) throw new BadRequestException('A reason is required when rejecting an organization.');
    return this.dataSource.transaction(async (manager) => {
      const rows = await manager.query('SELECT id, status FROM organizations WHERE id = $1 FOR UPDATE', [id]) as Array<{ id: string; status: OrganizationStatus }>;
      if (!rows.length) throw new NotFoundException('Organization not found.');
      const previousStatus = rows[0].status;
      if (previousStatus === OrganizationStatus.REJECTED) throw new ConflictException('A rejected registration cannot be changed.');
      if (previousStatus === OrganizationStatus.PENDING_REVIEW && status === OrganizationStatus.SUSPENDED) throw new BadRequestException('A pending registration must be approved or rejected first.');
      const orgRepo = manager.getRepository(Organization);
      await orgRepo.update(id, { status, reviewedByUserId: actorUserId, reviewedAt: new Date(), decisionNote: note?.trim() || null });
      if (status === OrganizationStatus.ACTIVE) {
        const memberRepo = manager.getRepository(OrganizationMembership);
        const membership = await memberRepo.findOne({ where: { organizationId: id, status: OrganizationMembershipStatus.PENDING } });
        if (membership) {
          membership.status = OrganizationMembershipStatus.ACTIVE;
          membership.joinedAt = new Date();
          await memberRepo.save(membership);
          const ownerRole = await manager.getRepository(OrganizationRole).findOne({ where: { organizationId: null, key: 'organization_owner', isActive: true } });
          if (!ownerRole) throw new Error('System organization owner role is missing.');
          await manager.query('INSERT INTO organization_membership_roles (membership_id, role_id, assigned_by_user_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [membership.id, ownerRole.id, actorUserId]);
        }
      } else if (status === OrganizationStatus.REJECTED) {
        await manager.getRepository(OrganizationMembership).update(
          { organizationId: id, status: OrganizationMembershipStatus.PENDING }, { status: OrganizationMembershipStatus.REJECTED },
        );
      }
      await manager.getRepository(PlatformAuditLog).save({
        actorUserId, action: 'organization.status.changed', entityType: 'organization', entityId: id,
        outcome: 'success', reason: note?.trim() || null, metadata: { previousStatus, newStatus: status },
      });
      return orgRepo.findOneByOrFail({ id });
    });
  }
}
