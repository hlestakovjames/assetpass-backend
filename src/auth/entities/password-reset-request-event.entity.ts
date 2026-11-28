import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('password_reset_request_events')
@Index('idx_password_reset_request_email_time', ['emailHash', 'createdAt'])
@Index('idx_password_reset_request_ip_time', ['requestedIp', 'createdAt'])
export class PasswordResetRequestEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'email_hash', type: 'char', length: 64 })
  emailHash: string;

  @Column({ name: 'requested_ip', type: 'inet', nullable: true })
  requestedIp: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
