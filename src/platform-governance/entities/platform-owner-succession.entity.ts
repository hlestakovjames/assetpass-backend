import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

export enum SuccessionStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
  COMPLETED = 'completed',
  CANCELLED = 'cancelled',
}

export enum SuccessionType {
  ROUTINE = 'routine',
  RECOVERY = 'recovery',
  DISPUTE = 'dispute',
  COMPROMISED_ACCOUNT = 'compromised_account',
}

@Entity('platform_owner_successions')
export class PlatformOwnerSuccession {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({
    name: 'succession_type',
    type: 'enum',
    enum: SuccessionType,
    enumName: 'succession_type',
  })
  successionType: SuccessionType;

  @Column({
    type: 'enum',
    enum: SuccessionStatus,
    enumName: 'succession_status',
    default: SuccessionStatus.PENDING,
  })
  status: SuccessionStatus;

  @Column({ name: 'initiated_by_user_id', type: 'uuid' })
  initiatedByUserId: string;

  @Column({ name: 'outgoing_owner_user_id', type: 'uuid', nullable: true })
  outgoingOwnerUserId: string | null;

  @Column({ name: 'proposed_successor_user_id', type: 'uuid' })
  proposedSuccessorUserId: string;

  @Column({ name: 'approved_by_user_id', type: 'uuid', nullable: true })
  approvedByUserId: string | null;

  @Column({ name: 'governance_approval_reference', type: 'text', nullable: true })
  governanceApprovalReference: string | null;

  @Column({ type: 'text' })
  reason: string;

  @CreateDateColumn({ name: 'initiated_at', type: 'timestamptz' })
  initiatedAt: Date;

  @Column({ name: 'approved_at', type: 'timestamptz', nullable: true })
  approvedAt: Date | null;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt: Date | null;

  @Column({ name: 'rejected_at', type: 'timestamptz', nullable: true })
  rejectedAt: Date | null;

  @Column({ name: 'rejection_reason', type: 'text', nullable: true })
  rejectionReason: string | null;

  @Column({ name: 'cancelled_at', type: 'timestamptz', nullable: true })
  cancelledAt: Date | null;

  @Column({ name: 'cancellation_reason', type: 'text', nullable: true })
  cancellationReason: string | null;

  @Column({ name: 'verification_metadata', type: 'jsonb', nullable: true })
  verificationMetadata: Record<string, unknown> | null;
}
