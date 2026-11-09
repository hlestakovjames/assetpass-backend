import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('asset_ownership')
@Index('idx_asset_ownership_asset_valid_from', ['assetId', 'validFrom'])
@Index('idx_asset_ownership_owner_valid_from', ['ownerPartyId', 'validFrom'])
@Index('UQ_asset_ownership_one_current', ['assetId'], { unique: true, where: '"valid_to" IS NULL' })
export class AssetOwnership {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'asset_id', type: 'uuid' }) assetId: string;
  @Column({ name: 'owner_party_id', type: 'uuid' }) ownerPartyId: string;
  @Column({ name: 'ownership_basis', type: 'varchar', length: 80 }) ownershipBasis: string;
  @Column({ name: 'evidence_reference', type: 'text', nullable: true }) evidenceReference: string | null;
  @Column({ name: 'valid_from', type: 'timestamptz' }) validFrom: Date;
  @Column({ name: 'valid_to', type: 'timestamptz', nullable: true }) validTo: Date | null;
  @Column({ name: 'recorded_by_user_id', type: 'uuid' }) recordedByUserId: string;
  @CreateDateColumn({ name: 'recorded_at', type: 'timestamptz' }) recordedAt: Date;
  @Column({ name: 'change_reason', type: 'text', nullable: true }) changeReason: string | null;
}