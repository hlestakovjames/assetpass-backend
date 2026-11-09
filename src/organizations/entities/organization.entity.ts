import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export enum OrganizationStatus {
  PENDING_REVIEW = 'pending_review',
  ACTIVE = 'active',
  SUSPENDED = 'suspended',
  REJECTED = 'rejected',
}

@Entity('organizations')
@Index('idx_organizations_status_created', ['status', 'createdAt'])
@Index('uq_organizations_registration_number', ['registrationNumber'], { unique: true, where: '"registration_number" IS NOT NULL' })
export class Organization {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'display_name', type: 'varchar', length: 200 }) displayName: string;
  @Column({ name: 'legal_name', type: 'varchar', length: 250, nullable: true }) legalName: string | null;
  @Column({ type: 'varchar', length: 80 }) category: string;
  @Column({ name: 'registration_number', type: 'varchar', length: 100, nullable: true }) registrationNumber: string | null;
  @Column({ name: 'contact_email', type: 'varchar', length: 320 }) contactEmail: string;
  @Column({ name: 'contact_phone', type: 'varchar', length: 40, nullable: true }) contactPhone: string | null;
  @Column({ type: 'varchar', length: 500, nullable: true }) website: string | null;
  @Column({ type: 'text', nullable: true }) description: string | null;
  @Column({ name: 'country_code', type: 'varchar', length: 2, default: 'KE' }) countryCode: string;
  @Column({ type: 'varchar', length: 160, nullable: true }) county: string | null;
  @Column({ type: 'varchar', length: 160, nullable: true }) city: string | null;
  @Column({ type: 'enum', enum: OrganizationStatus, enumName: 'organization_status', default: OrganizationStatus.PENDING_REVIEW }) status: OrganizationStatus;
  @Column({ name: 'created_by_user_id', type: 'uuid' }) createdByUserId: string;
  @Column({ name: 'reviewed_by_user_id', type: 'uuid', nullable: true }) reviewedByUserId: string | null;
  @Column({ name: 'reviewed_at', type: 'timestamptz', nullable: true }) reviewedAt: Date | null;
  @Column({ name: 'decision_note', type: 'text', nullable: true }) decisionNote: string | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt: Date;
}
