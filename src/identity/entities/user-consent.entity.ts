import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('user_consents')
@Index('uq_user_consents_user_type_version', ['userId', 'consentType', 'version'], { unique: true })
@Index('idx_user_consents_user_accepted', ['userId', 'acceptedAt'])
export class UserConsent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ name: 'consent_type', type: 'varchar', length: 40 })
  consentType: string;

  @Column({ type: 'varchar', length: 40 })
  version: string;

  @Column({ name: 'accepted_at', type: 'timestamptz' })
  acceptedAt: Date;

  @Column({ type: 'varchar', length: 40, default: 'self_service_registration' })
  source: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
