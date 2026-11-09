import { Check, Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export enum AssetPartyType {
  INDIVIDUAL = 'individual',
  ORGANIZATION = 'organization',
  PLATFORM = 'platform',
  EXTERNAL = 'external',
}

@Entity('asset_parties')
@Check('CHK_asset_parties_exactly_one_subject', `(
  (party_type = 'individual' AND user_id IS NOT NULL AND organization_id IS NULL AND external_asset_party_id IS NULL AND is_assetpass_platform_party = false)
  OR (party_type = 'organization' AND user_id IS NULL AND organization_id IS NOT NULL AND external_asset_party_id IS NULL AND is_assetpass_platform_party = false)
  OR (party_type = 'platform' AND user_id IS NULL AND organization_id IS NULL AND external_asset_party_id IS NULL AND is_assetpass_platform_party = true)
  OR (party_type = 'external' AND user_id IS NULL AND organization_id IS NULL AND external_asset_party_id IS NOT NULL AND is_assetpass_platform_party = false)
)`)
@Index('UQ_asset_parties_user', ['userId'], { unique: true, where: '"user_id" IS NOT NULL' })
@Index('UQ_asset_parties_organization', ['organizationId'], { unique: true, where: '"organization_id" IS NOT NULL' })
@Index('UQ_asset_parties_platform', ['isAssetpassPlatformParty'], { unique: true, where: '"is_assetpass_platform_party" = true' })
export class AssetParty {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'party_type', type: 'enum', enum: AssetPartyType, enumName: 'asset_party_type' }) partyType: AssetPartyType;
  @Column({ name: 'user_id', type: 'uuid', nullable: true }) userId: string | null;
  @Column({ name: 'organization_id', type: 'uuid', nullable: true }) organizationId: string | null;
  @Column({ name: 'external_asset_party_id', type: 'uuid', nullable: true }) externalAssetPartyId: string | null;
  @Column({ name: 'is_assetpass_platform_party', type: 'boolean', default: false }) isAssetpassPlatformParty: boolean;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
}