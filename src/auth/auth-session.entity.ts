import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { User } from '../identity/entities/user.entity';

@Entity('auth_sessions')
@Check(
  'CHK_auth_sessions_token_hash',
  `"token_hash" ~ '^[a-f0-9]{64}$'`,
)
@Check(
  'CHK_auth_sessions_expiry',
  '"expires_at" > "created_at"',
)
@Index('uq_auth_sessions_token_hash', ['tokenHash'], { unique: true })
@Index('idx_auth_sessions_user_active', ['userId', 'expiresAt'], {
  where: '"revoked_at" IS NULL',
})
@Index('idx_auth_sessions_family', ['familyId'])
export class AuthSession {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'token_hash', type: 'char', length: 64 })
  tokenHash: string;

  @Column({ name: 'family_id', type: 'uuid' })
  familyId: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;

  @Column({ name: 'last_used_at', type: 'timestamptz', nullable: true })
  lastUsedAt: Date | null;

  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt: Date | null;

  @Column({
    name: 'replaced_by_session_id',
    type: 'uuid',
    nullable: true,
  })
  replacedBySessionId: string | null;

  @Column({
    name: 'revocation_reason',
    type: 'varchar',
    length: 100,
    nullable: true,
  })
  revocationReason: string | null;

  @Column({ name: 'source_ip', type: 'inet', nullable: true })
  sourceIp: string | null;

  @Column({ name: 'user_agent', type: 'varchar', length: 1000, nullable: true })
  userAgent: string | null;
}
