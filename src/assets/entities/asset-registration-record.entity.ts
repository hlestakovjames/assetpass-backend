import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('asset_registration_records')
@Index('idx_asset_registration_records_asset_time', ['assetId', 'registeredAt'])
export class AssetRegistrationRecord {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'asset_id', type: 'uuid' }) assetId: string;
  @Column({ name: 'registered_by_user_id', type: 'uuid' }) registeredByUserId: string;
  @Column({ name: 'registration_context_party_id', type: 'uuid' }) registrationContextPartyId: string;
  @Column({ name: 'registration_context_type', type: 'varchar', length: 30 }) registrationContextType: string;
  @Column({ name: 'evidence_reference', type: 'text', nullable: true }) evidenceReference: string | null;
  @Column({ name: 'registration_notes', type: 'text', nullable: true }) registrationNotes: string | null;
  @CreateDateColumn({ name: 'registered_at', type: 'timestamptz' }) registeredAt: Date;
}