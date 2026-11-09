import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export enum PermissionScope { PLATFORM = 'platform', ORGANIZATION = 'organization', PERSONAL = 'personal' }

@Entity('permissions')
@Index('uq_permissions_key', ['key'], { unique: true })
export class Permission {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'varchar', length: 120 }) key: string;
  @Column({ type: 'varchar', length: 200 }) name: string;
  @Column({ type: 'text' }) description: string;
  @Column({ type: 'enum', enum: PermissionScope, enumName: 'permission_scope' }) scope: PermissionScope;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
}
