import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('platform_audit_logs')
@Check(
  'CHK_platform_audit_outcome',
  `"outcome" IN ('success', 'failure', 'denied')`,
)
@Index('idx_platform_audit_actor_time', ['actorUserId', 'occurredAt'])
@Index('idx_platform_audit_action_time', ['action', 'occurredAt'])
@Index('idx_platform_audit_entity', ['entityType', 'entityId', 'occurredAt'])
export class PlatformAuditLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'actor_user_id', type: 'uuid', nullable: true })
  actorUserId: string | null;

  @Column({ type: 'varchar', length: 150 })
  action: string;

  @Column({ name: 'entity_type', type: 'varchar', length: 100 })
  entityType: string;

  @Column({ name: 'entity_id', type: 'uuid', nullable: true })
  entityId: string | null;

  @CreateDateColumn({ name: 'occurred_at', type: 'timestamptz' })
  occurredAt: Date;

  @Column({ type: 'varchar', length: 30 })
  outcome: string;

  @Column({ type: 'text', nullable: true })
  reason: string | null;

  @Column({ name: 'request_id', type: 'varchar', length: 150, nullable: true })
  requestId: string | null;

  @Column({ name: 'source_ip', type: 'inet', nullable: true })
  sourceIp: string | null;

  @Column({ name: 'user_agent', type: 'text', nullable: true })
  userAgent: string | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, unknown> | null;
}
