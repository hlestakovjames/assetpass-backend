import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export enum OrganizationOnboardingStatus {
  PENDING_EMAIL_VERIFICATION = 'pending_email_verification',
  SUBMITTED_FOR_REVIEW = 'submitted_for_review',
  CLAIMED = 'claimed',
}

@Entity('organization_onboarding_applications')
@Index('idx_org_onboarding_status_created', ['status', 'createdAt'])
@Index('idx_org_onboarding_organization', ['organizationId'])
export class OrganizationOnboardingApplication {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'representative_first_name', type: 'varchar', length: 100 }) representativeFirstName: string;
  @Column({ name: 'representative_last_name', type: 'varchar', length: 100 }) representativeLastName: string;
  @Column({ name: 'representative_email', type: 'varchar', length: 320 }) representativeEmail: string;
  @Column({ name: 'representative_position', type: 'varchar', length: 160 }) representativePosition: string;
  @Column({ name: 'registration_relationship', type: 'varchar', length: 120 }) registrationRelationship: string;
  @Column({ name: 'authority_confirmed_at', type: 'timestamptz' }) authorityConfirmedAt: Date;
  @Column({ name: 'organization_data', type: 'jsonb' }) organizationData: Record<string, unknown>;
  @Column({ name: 'verification_token_hash', type: 'varchar', length: 64 }) verificationTokenHash: string;
  @Column({ name: 'verification_expires_at', type: 'timestamptz' }) verificationExpiresAt: Date;
  @Column({ name: 'email_verified_at', type: 'timestamptz', nullable: true }) emailVerifiedAt: Date | null;
  @Column({ name: 'organization_id', type: 'uuid', nullable: true }) organizationId: string | null;
  @Column({ name: 'claimed_by_user_id', type: 'uuid', nullable: true }) claimedByUserId: string | null;
  @Column({ name: 'claimed_at', type: 'timestamptz', nullable: true }) claimedAt: Date | null;
  @Column({ type: 'varchar', length: 40, default: OrganizationOnboardingStatus.PENDING_EMAIL_VERIFICATION }) status: OrganizationOnboardingStatus;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt: Date;
}
