import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { OrganizationMembershipStatus } from './organization-membership.entity';

export enum OrganizationMembershipEventType {
  MEMBERSHIP_CREATED = 'membership_created',
  MEMBERSHIP_INVITED = 'membership_invited',
  INVITATION_ACCEPTED = 'invitation_accepted',
  MEMBERSHIP_ACTIVATED = 'membership_activated',
  MEMBERSHIP_SUSPENDED = 'membership_suspended',
  MEMBERSHIP_REACTIVATED = 'membership_reactivated',
  MEMBERSHIP_REJECTED = 'membership_rejected',
  MEMBERSHIP_REMOVED = 'membership_removed',
  MEMBERSHIP_REINVITED = 'membership_reinvited',
  MEMBERSHIP_REJOINED = 'membership_rejoined',
  MEMBERSHIP_BASELINE_RECORDED = 'membership_baseline_recorded',
}

@Entity('organization_membership_events')
@Index('idx_organization_membership_events_membership_sequence', ['membershipId', 'eventSequence'])
@Index('idx_organization_membership_events_actor_recorded', ['actorUserId', 'recordedAt'])
@Index('idx_organization_membership_events_type_recorded', ['eventType', 'recordedAt'])
export class OrganizationMembershipEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'event_sequence', type: 'bigint', generated: 'increment', unique: true })
  eventSequence: string;

  @Column({ name: 'membership_id', type: 'uuid' })
  membershipId: string;

  @Column({
    name: 'event_type',
    type: 'enum',
    enum: OrganizationMembershipEventType,
    enumName: 'organization_membership_event_type',
  })
  eventType: OrganizationMembershipEventType;

  @Column({
    name: 'previous_status',
    type: 'enum',
    enum: OrganizationMembershipStatus,
    enumName: 'organization_membership_status',
    nullable: true,
  })
  previousStatus: OrganizationMembershipStatus | null;

  @Column({
    name: 'new_status',
    type: 'enum',
    enum: OrganizationMembershipStatus,
    enumName: 'organization_membership_status',
    nullable: true,
  })
  newStatus: OrganizationMembershipStatus | null;

  @Column({ name: 'actor_user_id', type: 'uuid', nullable: true })
  actorUserId: string | null;

  @Column({ name: 'effective_at', type: 'timestamptz' })
  effectiveAt: Date;

  @CreateDateColumn({ name: 'recorded_at', type: 'timestamptz' })
  recordedAt: Date;

  @Column({ type: 'text', nullable: true })
  reason: string | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, unknown> | null;
}
