import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export enum PlatformRoleName {
  OWNER = 'Platform Owner',
  ADMINISTRATOR = 'Platform Administrator',
}

@Entity('platform_roles')
@Index('uq_platform_roles_one_active_owner', ['role'], {
  unique: true,
  where: `"role" = 'Platform Owner' AND "revoked_at" IS NULL`,
})
@Index('uq_platform_roles_user_active_role', ['userId', 'role'], {
  unique: true,
  where: '"revoked_at" IS NULL',
})
export class PlatformRole {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ type: 'varchar', length: 30 })
  role: PlatformRoleName;

  @Column({ name: 'assigned_by_user_id', type: 'uuid', nullable: true })
  assignedByUserId: string | null;

  @CreateDateColumn({ name: 'assigned_at', type: 'timestamptz' })
  assignedAt: Date;

  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt: Date | null;

  @Column({ type: 'text', nullable: true })
  reason: string | null;
}
