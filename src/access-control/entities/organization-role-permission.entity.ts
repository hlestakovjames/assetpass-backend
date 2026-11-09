import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('organization_role_permissions')
@Index('uq_organization_role_permission', ['roleId', 'permissionId'], { unique: true })
export class OrganizationRolePermission {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'role_id', type: 'uuid' }) roleId: string;
  @Column({ name: 'permission_id', type: 'uuid' }) permissionId: string;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
}
