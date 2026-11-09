import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { randomBytes } from 'node:crypto';
import { PlatformAuditLog } from '../audit/entities/platform-audit-log.entity';
import { Organization, OrganizationStatus } from '../organizations/entities/organization.entity';
import { OrganizationMembership, OrganizationMembershipStatus } from '../organizations/entities/organization-membership.entity';
import { AssetParty, AssetPartyType } from './entities/asset-party.entity';
import { AssetRegistrationApplication, AssetRegistrationStatus } from './entities/asset-registration-application.entity';
import { AssetRegistrationEvidence, EvidenceVerificationStatus } from './entities/asset-registration-evidence.entity';
import { AssetEvidenceUpload, AssetEvidenceUploadStatus } from './entities/asset-evidence-upload.entity';
import { Asset, AssetStatus } from './entities/asset.entity';
import { AssetOwnership } from './entities/asset-ownership.entity';
import { AssetRegistrationRecord } from './entities/asset-registration-record.entity';

type EvidenceInput = { evidenceType: string; uploadId: string };
export type CreateAssetRegistrationInput = {
  name: string;
  description?: string;
  serialNumber?: string;
  manufacturer?: string;
  model?: string;
  condition: string;
  acquisitionDate?: string;
  acquisitionCost?: number;
  currencyCode?: string;
  ownershipBasis: string;
  evidence: EvidenceInput[];
};

export type ReviewAssetRegistrationInput = { decision: 'approve' | 'reject'; reason: string };

type ValidatedAssetRegistration = { name: string; condition: string; ownershipBasis: string; evidence: EvidenceInput[]; description: string | null; serialNumber: string | null; manufacturer: string | null; model: string | null; acquisitionDate: string | null; acquisitionCost: string | null; currencyCode: string | null };

const OWNERSHIP_BASES = ['purchase', 'gift', 'inheritance', 'self_created', 'other'];
const CONDITIONS = ['new', 'excellent', 'good', 'fair', 'poor', 'unknown'];
const EVIDENCE_TYPES = ['proof_of_ownership', 'purchase_receipt', 'asset_photo', 'serial_number_photo', 'other'];

@Injectable()
export class AssetsService {
  constructor(private readonly dataSource: DataSource) {}

  private validateInput(input: CreateAssetRegistrationInput) {
    if (!input || typeof input !== 'object') throw new BadRequestException('Asset details are required.');
    const name = typeof input.name === 'string' ? input.name.trim() : '';
    const condition = typeof input.condition === 'string' ? input.condition.trim().toLowerCase() : '';
    const ownershipBasis = typeof input.ownershipBasis === 'string' ? input.ownershipBasis.trim().toLowerCase() : '';
    if (!name || name.length > 200) throw new BadRequestException('Enter an asset name of at most 200 characters.');
    if (!CONDITIONS.includes(condition)) throw new BadRequestException('Choose a valid asset condition.');
    if (!OWNERSHIP_BASES.includes(ownershipBasis)) throw new BadRequestException('Choose a valid ownership basis.');
    if (!Array.isArray(input.evidence) || input.evidence.length === 0 || input.evidence.length > 20) {
      throw new BadRequestException('Attach at least one ownership evidence reference.');
    }
    const evidence = input.evidence.map((item) => {
      const evidenceType = typeof item?.evidenceType === 'string' ? item.evidenceType.trim().toLowerCase() : '';
      const uploadId = typeof item?.uploadId === 'string' ? item.uploadId.trim() : '';
      if (!EVIDENCE_TYPES.includes(evidenceType) || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(uploadId)) {
        throw new BadRequestException('Evidence must reference a completed private upload and a valid evidence type.');
      }
      return { evidenceType, uploadId };
    });
    if (!evidence.some((item) => ['proof_of_ownership', 'purchase_receipt'].includes(item.evidenceType))) {
      throw new BadRequestException('Include proof of ownership or a purchase receipt.');
    }
    const cost = input.acquisitionCost;
    if (cost !== undefined && (!Number.isFinite(cost) || cost < 0 || cost > 999999999999.99)) {
      throw new BadRequestException('Enter a valid non-negative acquisition cost.');
    }
    const date = typeof input.acquisitionDate === 'string' ? input.acquisitionDate.trim() : input.acquisitionDate == null ? '' : 'invalid';
    if (date && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date)) {
      throw new BadRequestException('Enter the acquisition date in YYYY-MM-DD format.');
    }
    const currency = typeof input.currencyCode === 'string' ? input.currencyCode.trim().toUpperCase() : input.currencyCode == null ? '' : 'INVALID';
    if (currency && !/^[A-Z]{3}$/.test(currency)) throw new BadRequestException('Enter a valid three-letter currency code.');
    return {
      name, condition, ownershipBasis, evidence,
      description: optionalText(input.description, 10000),
      serialNumber: optionalText(input.serialNumber, 200),
      manufacturer: optionalText(input.manufacturer, 150),
      model: optionalText(input.model, 150),
      acquisitionDate: date || null,
      acquisitionCost: cost === undefined ? null : cost.toFixed(2),
      currencyCode: currency || null,
    };
  }

  async createIndividualRegistration(userId: string, input: CreateAssetRegistrationInput) {
    const data = this.validateInput(input);
    return this.dataSource.transaction(async (manager) => {
      const partyRepo = manager.getRepository(AssetParty);
      let party = await partyRepo.findOneBy({ userId });
      if (!party) party = await partyRepo.save(partyRepo.create({ partyType: AssetPartyType.INDIVIDUAL, userId, organizationId: null, isAssetpassPlatformParty: false }));
      return this.createApplication(manager, userId, party, null, data);
    });
  }

  async createOrganizationRegistration(userId: string, organizationId: string, input: CreateAssetRegistrationInput) {
    const data = this.validateInput(input);
    return this.dataSource.transaction(async (manager) => {
      const organization = await manager.getRepository(Organization).findOneBy({ id: organizationId, status: OrganizationStatus.ACTIVE });
      if (!organization) throw new NotFoundException('An active organization is required to register organization assets.');
      await this.assertOrganizationPermission(manager, userId, organizationId, 'organization.assets.manage');
      const partyRepo = manager.getRepository(AssetParty);
      let party = await partyRepo.findOneBy({ organizationId });
      if (!party) party = await partyRepo.save(partyRepo.create({ partyType: AssetPartyType.ORGANIZATION, userId: null, organizationId, isAssetpassPlatformParty: false }));
      return this.createApplication(manager, userId, party, organizationId, data);
    });
  }

  private async createApplication(manager: EntityManager, userId: string, party: AssetParty, organizationId: string | null, data: ValidatedAssetRegistration) {
    const uploadRepo = manager.getRepository(AssetEvidenceUpload);
    const evidenceUploads = await Promise.all(data.evidence.map(async (item) => {
      const upload = await uploadRepo.findOne({
        where: { id: item.uploadId, ownerUserId: userId, organizationId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!upload || upload.status !== AssetEvidenceUploadStatus.UPLOADED) {
        throw new BadRequestException('Each evidence item must be uploaded and completed by the submitting user for this registration context.');
      }
      return { item, upload };
    }));
    const applicationRepo = manager.getRepository(AssetRegistrationApplication);
    const applicationReference = `APR-${new Date().getUTCFullYear()}-${cryptoRandomReference()}`;
    const application = await applicationRepo.save(applicationRepo.create({
      applicationReference,
      applicantUserId: userId,
      registrationContextPartyId: party.id,
      proposedOwnerPartyId: party.id,
      status: AssetRegistrationStatus.UNDER_REVIEW,
      assetName: data.name,
      description: data.description,
      serialNumber: data.serialNumber,
      manufacturer: data.manufacturer,
      model: data.model,
      conditionLabel: data.condition,
      acquisitionDate: data.acquisitionDate,
      acquisitionCost: data.acquisitionCost,
      currencyCode: data.currencyCode,
      ownershipBasis: data.ownershipBasis,
      evidenceReference: null,
      submittedAt: new Date(),
      reviewedByUserId: null,
      reviewedAt: null,
      decisionReason: null,
      approvedAssetId: null,
    }));
    await manager.getRepository(AssetRegistrationEvidence).save(evidenceUploads.map(({ item, upload }) => ({
      applicationId: application.id, evidenceType: item.evidenceType, objectReference: upload.objectKey,
      uploadedByUserId: userId, verificationStatus: EvidenceVerificationStatus.PENDING,
    })));
    await uploadRepo.update(
      evidenceUploads.map(({ upload }) => upload.id),
      { status: AssetEvidenceUploadStatus.ATTACHED, attachedAt: new Date() },
    );
    await manager.getRepository(PlatformAuditLog).save({
      actorUserId: userId, action: 'asset.registration.submitted', entityType: 'asset_registration_application',
      entityId: application.id, outcome: 'success', reason: null,
      metadata: { applicationReference, contextType: organizationId ? 'organization' : 'individual', organizationId, evidenceCount: data.evidence.length },
    });
    return { id: application.id, applicationReference, status: application.status, submittedAt: application.submittedAt };
  }

  async listMine(userId: string) {
    const applications = await this.dataSource.getRepository(AssetRegistrationApplication).find({
      where: { applicantUserId: userId }, order: { createdAt: 'DESC' },
    });
    return applications.map((item) => this.toApplicationSummary(item));
  }

  async listOrganizationRegistrations(userId: string, organizationId: string) {
    await this.assertOrganizationPermission(this.dataSource.manager, userId, organizationId, 'organization.assets.review');
    const party = await this.dataSource.getRepository(AssetParty).findOneBy({ organizationId });
    if (!party) return [];
    const applications = await this.dataSource.getRepository(AssetRegistrationApplication).find({
      where: { registrationContextPartyId: party.id }, order: { createdAt: 'DESC' },
    });
    return applications.map((item) => this.toApplicationSummary(item));
  }

  async listIndividualRegistrations() {
    return (await this.dataSource.getRepository(AssetRegistrationApplication).createQueryBuilder('application')
      .innerJoin('asset_parties', 'party', 'party.id = application.registration_context_party_id')
      .where('party.party_type = :type', { type: AssetPartyType.INDIVIDUAL })
      .andWhere('application.status IN (:...statuses)', { statuses: [AssetRegistrationStatus.SUBMITTED, AssetRegistrationStatus.UNDER_REVIEW] })
      .orderBy('application.submitted_at', 'ASC').getMany()).map((item) => this.toApplicationSummary(item));
  }

  async reviewOrganizationRegistration(actorUserId: string, organizationId: string, applicationId: string, input: ReviewAssetRegistrationInput) {
    return this.review(actorUserId, applicationId, input, organizationId);
  }

  async reviewIndividualRegistration(actorUserId: string, applicationId: string, input: ReviewAssetRegistrationInput) {
    return this.review(actorUserId, applicationId, input, null);
  }

  private async review(actorUserId: string, applicationId: string, input: ReviewAssetRegistrationInput, organizationId: string | null) {
    if (!input || !['approve', 'reject'].includes(input.decision) || typeof input.reason !== 'string' || input.reason.trim().length < 5 || input.reason.trim().length > 2000) {
      throw new BadRequestException('Choose approve or reject and provide a decision reason of at least five characters.');
    }
    return this.dataSource.transaction(async (manager) => {
      if (organizationId) await this.assertOrganizationPermission(manager, actorUserId, organizationId, 'organization.assets.review');
      const appRepo = manager.getRepository(AssetRegistrationApplication);
      const application = await appRepo.findOne({ where: { id: applicationId }, lock: { mode: 'pessimistic_write' } });
      if (!application) throw new NotFoundException('Asset registration application not found.');
      const party = await manager.getRepository(AssetParty).findOneBy({ id: application.registrationContextPartyId });
      if (!party || (organizationId && party.organizationId !== organizationId) || (!organizationId && party.partyType !== AssetPartyType.INDIVIDUAL)) {
        throw new NotFoundException('Asset registration application not found in this review queue.');
      }
      if (application.status !== AssetRegistrationStatus.UNDER_REVIEW && application.status !== AssetRegistrationStatus.SUBMITTED) {
        throw new ConflictException('This registration application has already received a decision.');
      }
      const evidenceRepo = manager.getRepository(AssetRegistrationEvidence);
      const evidence = await evidenceRepo.find({ where: { applicationId } });
      if (!evidence.length) throw new BadRequestException('The application has no supporting evidence.');
      const now = new Date();
      if (input.decision === 'reject') {
        await evidenceRepo.update({ applicationId }, { verificationStatus: EvidenceVerificationStatus.REJECTED, verifiedByUserId: actorUserId, verifiedAt: now, verificationNotes: input.reason.trim() });
        application.status = AssetRegistrationStatus.REJECTED;
        application.reviewedByUserId = actorUserId;
        application.reviewedAt = now;
        application.decisionReason = input.reason.trim();
        await appRepo.save(application);
        await manager.getRepository(PlatformAuditLog).save({
          actorUserId, action: 'asset.registration.rejected', entityType: 'asset_registration_application',
          entityId: application.id, outcome: 'success', reason: input.reason.trim(), metadata: { applicationReference: application.applicationReference },
        });
        return this.toApplicationSummary(application);
      }

      if (!application.proposedOwnerPartyId) throw new BadRequestException('A legal owner must be validated before approval.');
      await evidenceRepo.update({ applicationId }, { verificationStatus: EvidenceVerificationStatus.VERIFIED, verifiedByUserId: actorUserId, verifiedAt: now, verificationNotes: input.reason.trim() });
      const sequence = await manager.query(`SELECT nextval('assetpass_asset_id_seq') AS value`);
      const serial = String(sequence[0].value).padStart(8, '0');
      const assetpassId = `AP-${now.getUTCFullYear()}-${serial}`;
      const asset = await manager.getRepository(Asset).save(manager.getRepository(Asset).create({
        assetpassId,
        organizationId: party.partyType === AssetPartyType.ORGANIZATION ? party.organizationId : null,
        assetTag: null,
        name: application.assetName,
        description: application.description,
        serialNumber: application.serialNumber,
        manufacturer: application.manufacturer,
        model: application.model,
        acquisitionDate: application.acquisitionDate,
        acquisitionCost: application.acquisitionCost,
        currencyCode: application.currencyCode,
        status: AssetStatus.ACTIVE,
        conditionLabel: application.conditionLabel,
        registeredByUserId: application.applicantUserId,
        retiredAt: null, disposedAt: null, deactivatedAt: null,
      }));
      await manager.getRepository(AssetOwnership).save(manager.getRepository(AssetOwnership).create({
        assetId: asset.id, ownerPartyId: application.proposedOwnerPartyId, ownershipBasis: application.ownershipBasis,
        evidenceReference: null, validFrom: now, validTo: null, recordedByUserId: actorUserId,
        changeReason: 'Initial ownership recorded after registration review.',
      }));
      await manager.getRepository(AssetRegistrationRecord).save(manager.getRepository(AssetRegistrationRecord).create({
        assetId: asset.id, registeredByUserId: application.applicantUserId,
        registrationContextPartyId: application.registrationContextPartyId,
        registrationContextType: party.partyType, evidenceReference: null,
        registrationNotes: application.applicationReference,
      }));
      application.status = AssetRegistrationStatus.APPROVED;
      application.reviewedByUserId = actorUserId;
      application.reviewedAt = now;
      application.decisionReason = input.reason.trim();
      application.approvedAssetId = asset.id;
      await appRepo.save(application);
      await manager.getRepository(PlatformAuditLog).save({
        actorUserId, action: 'asset.registration.approved', entityType: 'asset',
        entityId: asset.id, outcome: 'success', reason: input.reason.trim(),
        metadata: { applicationReference: application.applicationReference, assetpassId, ownerPartyId: application.proposedOwnerPartyId },
      });
      return { ...this.toApplicationSummary(application), asset: { id: asset.id, assetpassId: asset.assetpassId, name: asset.name, status: asset.status } };
    });
  }

  private async assertOrganizationPermission(manager: EntityManager, userId: string, organizationId: string, permissionKey: string) {
    const membership = await manager.getRepository(OrganizationMembership).findOneBy({
      organizationId, userId, status: OrganizationMembershipStatus.ACTIVE,
    });
    if (!membership) throw new ForbiddenException('An active organization membership is required.');
    const rows = await manager.query(`
      SELECT 1
      FROM organization_membership_roles mr
      JOIN organization_roles r ON r.id = mr.role_id AND r.is_active = true
      JOIN organization_role_permissions rp ON rp.role_id = r.id
      JOIN permissions p ON p.id = rp.permission_id
      WHERE mr.membership_id = $1 AND p.key = $2
      LIMIT 1
    `, [membership.id, permissionKey]);
    if (!rows.length) throw new ForbiddenException('You do not have permission to perform this asset operation.');
  }

  private toApplicationSummary(item: AssetRegistrationApplication) {
    return {
      id: item.id, applicationReference: item.applicationReference, status: item.status,
      name: item.assetName, description: item.description, serialNumber: item.serialNumber,
      manufacturer: item.manufacturer, model: item.model, condition: item.conditionLabel,
      ownershipBasis: item.ownershipBasis, submittedAt: item.submittedAt, reviewedAt: item.reviewedAt,
      decisionReason: item.decisionReason, assetId: item.approvedAssetId,
    };
  }
}

function optionalText(value: unknown, maxLength: number): string | null {
  if (value == null || value === '') return null;
  if (typeof value !== 'string') throw new BadRequestException('Optional asset details must be text.');
  const result = value.trim();
  return result ? result.slice(0, maxLength) : null;
}

function cryptoRandomReference() {
  return randomBytes(6).toString('hex').toUpperCase();
}