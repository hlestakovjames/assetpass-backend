import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export enum AssetStatus { ACTIVE = 'active', UNDER_MAINTENANCE = 'under_maintenance', RETIRED = 'retired', DISPOSED = 'disposed' }

@Entity('assets')
@Index('UQ_assets_assetpass_id', ['assetpassId'], { unique: true })
@Index('UQ_assets_org_asset_tag', ['organizationId', 'assetTag'], { unique: true, where: '"organization_id" IS NOT NULL AND "asset_tag" IS NOT NULL' })
export class Asset {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'assetpass_id', type: 'varchar', length: 64, unique: true }) assetpassId: string;
  @Column({ name: 'organization_id', type: 'uuid', nullable: true }) organizationId: string | null;
  @Column({ name: 'asset_tag', type: 'varchar', length: 100, nullable: true }) assetTag: string | null;
  @Column({ type: 'varchar', length: 200 }) name: string;
  @Column({ type: 'text', nullable: true }) description: string | null;
  @Column({ name: 'serial_number', type: 'varchar', length: 200, nullable: true }) serialNumber: string | null;
  @Column({ type: 'varchar', length: 150, nullable: true }) manufacturer: string | null;
  @Column({ type: 'varchar', length: 150, nullable: true }) model: string | null;
  @Column({ name: 'acquisition_date', type: 'date', nullable: true }) acquisitionDate: string | null;
  @Column({ name: 'acquisition_cost', type: 'numeric', precision: 14, scale: 2, nullable: true }) acquisitionCost: string | null;
  @Column({ name: 'currency_code', type: 'char', length: 3, nullable: true }) currencyCode: string | null;
  @Column({ type: 'enum', enum: AssetStatus, enumName: 'asset_status', default: AssetStatus.ACTIVE }) status: AssetStatus;
  @Column({ name: 'condition_label', type: 'varchar', length: 50 }) conditionLabel: string;
  @Column({ name: 'registered_by_user_id', type: 'uuid' }) registeredByUserId: string;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt: Date;
  @Column({ name: 'retired_at', type: 'timestamptz', nullable: true }) retiredAt: Date | null;
  @Column({ name: 'disposed_at', type: 'timestamptz', nullable: true }) disposedAt: Date | null;
  @Column({ name: 'deactivated_at', type: 'timestamptz', nullable: true }) deactivatedAt: Date | null;
}