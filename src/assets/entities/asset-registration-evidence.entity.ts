import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export enum EvidenceVerificationStatus {
  PENDING = 'pending',
  VERIFIED = 'verified',
  REJECTED = 'rejected',
}

@Entity('asset_registration_evidence')
@Index('idx_asset_registration_evidence_application', ['applicationId', 'evidenceType'])
export class AssetRegistrationEvidence {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'application_id', type: 'uuid' }) applicationId: string;
  @Column({ name: 'evidence_type', type: 'varchar', length: 80 }) evidenceType: string;
  @Column({ name: 'object_reference', type: 'text' }) objectReference: string;
  @Column({ name: 'uploaded_by_user_id', type: 'uuid' }) uploadedByUserId: string;
  @Column({ name: 'verification_status', type: 'varchar', length: 30, default: EvidenceVerificationStatus.PENDING }) verificationStatus: EvidenceVerificationStatus;
  @Column({ name: 'verified_by_user_id', type: 'uuid', nullable: true }) verifiedByUserId: string | null;
  @Column({ name: 'verified_at', type: 'timestamptz', nullable: true }) verifiedAt: Date | null;
  @Column({ name: 'verification_notes', type: 'text', nullable: true }) verificationNotes: string | null;
  @CreateDateColumn({ name: 'uploaded_at', type: 'timestamptz' }) uploadedAt: Date;
}