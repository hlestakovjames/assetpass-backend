import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export enum AssetRegistrationStatus {
  DRAFT = 'draft',
  SUBMITTED = 'submitted',
  UNDER_REVIEW = 'under_review',
  APPROVED = 'approved',
  REJECTED = 'rejected',
  CANCELLED = 'cancelled',
}

@Entity('asset_registration_applications')
@Index('idx_asset_registration_applicant_status', ['applicantUserId', 'status'])
@Index('idx_asset_registration_context_status', ['registrationContextPartyId', 'status'])
@Index('UQ_asset_registration_approved_asset', ['approvedAssetId'], { unique: true, where: '"approved_asset_id" IS NOT NULL' })
export class AssetRegistrationApplication {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'application_reference', type: 'varchar', length: 64, unique: true }) applicationReference: string;
  @Column({ name: 'applicant_user_id', type: 'uuid' }) applicantUserId: string;
  @Column({ name: 'registration_context_party_id', type: 'uuid' }) registrationContextPartyId: string;
  @Column({ name: 'proposed_owner_party_id', type: 'uuid', nullable: true }) proposedOwnerPartyId: string | null;
  @Column({ type: 'enum', enum: AssetRegistrationStatus, enumName: 'asset_registration_status', default: AssetRegistrationStatus.DRAFT }) status: AssetRegistrationStatus;
  @Column({ name: 'asset_name', type: 'varchar', length: 200 }) assetName: string;
  @Column({ name: 'description', type: 'text', nullable: true }) description: string | null;
  @Column({ name: 'serial_number', type: 'varchar', length: 200, nullable: true }) serialNumber: string | null;
  @Column({ name: 'manufacturer', type: 'varchar', length: 150, nullable: true }) manufacturer: string | null;
  @Column({ name: 'model', type: 'varchar', length: 150, nullable: true }) model: string | null;
  @Column({ name: 'condition_label', type: 'varchar', length: 50 }) conditionLabel: string;
  @Column({ name: 'acquisition_date', type: 'date', nullable: true }) acquisitionDate: string | null;
  @Column({ name: 'acquisition_cost', type: 'numeric', precision: 14, scale: 2, nullable: true }) acquisitionCost: string | null;
  @Column({ name: 'currency_code', type: 'char', length: 3, nullable: true }) currencyCode: string | null;
  @Column({ name: 'ownership_basis', type: 'varchar', length: 80 }) ownershipBasis: string;
  @Column({ name: 'evidence_reference', type: 'text', nullable: true }) evidenceReference: string | null;
  @Column({ name: 'submitted_at', type: 'timestamptz', nullable: true }) submittedAt: Date | null;
  @Column({ name: 'reviewed_by_user_id', type: 'uuid', nullable: true }) reviewedByUserId: string | null;
  @Column({ name: 'reviewed_at', type: 'timestamptz', nullable: true }) reviewedAt: Date | null;
  @Column({ name: 'decision_reason', type: 'text', nullable: true }) decisionReason: string | null;
  @Column({ name: 'approved_asset_id', type: 'uuid', nullable: true }) approvedAssetId: string | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt: Date;
}