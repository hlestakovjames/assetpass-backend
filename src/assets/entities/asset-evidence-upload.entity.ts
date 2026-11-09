import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export enum AssetEvidenceUploadStatus {
  PENDING = 'pending',
  UPLOADED = 'uploaded',
  ATTACHED = 'attached',
  EXPIRED = 'expired',
}

@Entity('asset_evidence_uploads')
@Index('idx_asset_evidence_upload_owner_status', ['ownerUserId', 'status'])
@Index('idx_asset_evidence_upload_expiry', ['status', 'expiresAt'])
export class AssetEvidenceUpload {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'owner_user_id', type: 'uuid' }) ownerUserId: string;
  @Column({ name: 'organization_id', type: 'uuid', nullable: true }) organizationId: string | null;
  @Column({ name: 'object_key', type: 'text', unique: true }) objectKey: string;
  @Column({ name: 'original_file_name', type: 'varchar', length: 255 }) originalFileName: string;
  @Column({ name: 'content_type', type: 'varchar', length: 100 }) contentType: string;
  @Column({ name: 'size_bytes', type: 'integer' }) sizeBytes: number;
  @Column({ type: 'enum', enum: AssetEvidenceUploadStatus, enumName: 'asset_evidence_upload_status', default: AssetEvidenceUploadStatus.PENDING }) status: AssetEvidenceUploadStatus;
  @Column({ name: 'expires_at', type: 'timestamptz' }) expiresAt: Date;
  @Column({ name: 'uploaded_at', type: 'timestamptz', nullable: true }) uploadedAt: Date | null;
  @Column({ name: 'attached_at', type: 'timestamptz', nullable: true }) attachedAt: Date | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
}
