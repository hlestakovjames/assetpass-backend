import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('organization_onboarding_sessions')
@Index('uq_org_onboarding_session_token_hash', ['tokenHash'], { unique: true })
@Index('idx_org_onboarding_session_application', ['applicationId', 'revokedAt'])
export class OrganizationOnboardingSession {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'application_id', type: 'uuid' }) applicationId: string;
  @Column({ name: 'token_hash', type: 'varchar', length: 64, select: false }) tokenHash: string;
  @Column({ type: 'varchar', array: true, default: () => "ARRAY['application.read']::varchar[]" }) scopes: string[];
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
  @Column({ name: 'last_seen_at', type: 'timestamptz' }) lastSeenAt: Date;
  @Column({ name: 'expires_at', type: 'timestamptz' }) expiresAt: Date;
  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true }) revokedAt: Date | null;
}
