import { Check, Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('organization_membership_roles')
@Check('CHK_membership_role_revocation_after_assignment', '"revoked_at" IS NULL OR "revoked_at" >= "assigned_at"')
@Index('uq_membership_role_assignment_active', ['membershipId', 'roleId'], {
  unique: true,
  where: '"revoked_at" IS NULL',
})
@Index('idx_membership_role_assignment_active', ['membershipId', 'assignedAt'], {
  where: '"revoked_at" IS NULL',
})
export class OrganizationMembershipRole {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'membership_id', type: 'uuid' })
  membershipId: string;

  @Column({ name: 'role_id', type: 'uuid' })
  roleId: string;

  @Column({ name: 'assigned_by_user_id', type: 'uuid', nullable: true })
  assignedByUserId: string | null;

  @CreateDateColumn({ name: 'assigned_at', type: 'timestamptz' })
  assignedAt: Date;

  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt: Date | null;

  @Column({ name: 'revoked_by_user_id', type: 'uuid', nullable: true })
  revokedByUserId: string | null;

  @Column({ name: 'revocation_reason', type: 'text', nullable: true })
  revocationReason: string | null;
}
