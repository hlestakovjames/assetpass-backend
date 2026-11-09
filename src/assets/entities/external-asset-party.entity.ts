import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('external_asset_parties')
export class ExternalAssetParty {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'display_name', type: 'varchar', length: 200 }) displayName: string;
  @Column({ name: 'party_kind', type: 'varchar', length: 50 }) partyKind: string;
  @Column({ name: 'jurisdiction_code', type: 'varchar', length: 10, nullable: true }) jurisdictionCode: string | null;
  @Column({ name: 'external_reference', type: 'varchar', length: 150, nullable: true }) externalReference: string | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
  @Column({ name: 'updated_at', type: 'timestamptz', default: () => 'now()' }) updatedAt: Date;
  @Column({ name: 'deactivated_at', type: 'timestamptz', nullable: true }) deactivatedAt: Date | null;
}