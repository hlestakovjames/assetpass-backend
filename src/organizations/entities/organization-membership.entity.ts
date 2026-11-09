import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export enum OrganizationMembershipStatus {
  PENDING = 'pending',
  ACTIVE = 'active',
  SUSPENDED = 'suspended',
  REJECTED = 'rejected',
  REMOVED = 'removed',
}

@Entity('organization_memberships')
@Index('uq_organization_memberships_user_org', ['userId', 'organizationId'], { unique: true })
@Index('idx_organization_memberships_org_status', ['organizationId', 'status'])
@Index('idx_organization_memberships_user_status', ['userId', 'status'])
export class OrganizationMembership {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'organization_id', type: 'uuid' }) organizationId: string;
  @Column({ name: 'user_id', type: 'uuid' }) userId: string;
  @Column({ type: 'enum', enum: OrganizationMembershipStatus, enumName: 'organization_membership_status', default: OrganizationMembershipStatus.PENDING }) status: OrganizationMembershipStatus;
  @Column({ name: 'invited_by_user_id', type: 'uuid', nullable: true }) invitedByUserId: string | null;
  @Column({ name: 'joined_at', type: 'timestamptz', nullable: true }) joinedAt: Date | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt: Date;
}
