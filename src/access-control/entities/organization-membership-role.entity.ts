import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('organization_membership_roles')
@Index('uq_membership_role_assignment', ['membershipId', 'roleId'], { unique: true })
export class OrganizationMembershipRole {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'membership_id', type: 'uuid' }) membershipId: string;
  @Column({ name: 'role_id', type: 'uuid' }) roleId: string;
  @Column({ name: 'assigned_by_user_id', type: 'uuid', nullable: true }) assignedByUserId: string | null;
  @CreateDateColumn({ name: 'assigned_at', type: 'timestamptz' }) assignedAt: Date;
}
