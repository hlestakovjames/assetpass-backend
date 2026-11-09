import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('organization_roles')
@Index('uq_organization_roles_system_key', ['key'], { unique: true, where: '"organization_id" IS NULL' })
@Index('uq_organization_roles_org_key', ['organizationId', 'key'], { unique: true, where: '"organization_id" IS NOT NULL' })
export class OrganizationRole {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'organization_id', type: 'uuid', nullable: true }) organizationId: string | null;
  @Column({ type: 'varchar', length: 80 }) key: string;
  @Column({ type: 'varchar', length: 120 }) name: string;
  @Column({ type: 'text', nullable: true }) description: string | null;
  @Column({ name: 'is_system', type: 'boolean', default: false }) isSystem: boolean;
  @Column({ name: 'is_active', type: 'boolean', default: true }) isActive: boolean;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt: Date;
}
