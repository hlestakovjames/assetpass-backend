import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('platform_role_permissions')
@Index('uq_platform_role_permission', ['role', 'permissionId'], { unique: true })
export class PlatformRolePermission {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'varchar', length: 30 }) role: string;
  @Column({ name: 'permission_id', type: 'uuid' }) permissionId: string;
  @Column({ name: 'granted_by_user_id', type: 'uuid', nullable: true }) grantedByUserId: string | null;
  @CreateDateColumn({ name: 'granted_at', type: 'timestamptz' }) grantedAt: Date;
}
