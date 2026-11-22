import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAssetEvidenceUploads1794500000000 implements MigrationInterface {
  name = 'CreateAssetEvidenceUploads1794500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TYPE "asset_evidence_upload_status" AS ENUM ('pending', 'uploaded', 'attached', 'expired')`);
    await queryRunner.query(`
      CREATE TABLE "asset_evidence_uploads" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "owner_user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
        "organization_id" uuid REFERENCES "organizations"("id") ON DELETE RESTRICT,
        "object_key" text NOT NULL UNIQUE,
        "original_file_name" varchar(255) NOT NULL,
        "content_type" varchar(100) NOT NULL,
        "size_bytes" integer NOT NULL CHECK ("size_bytes" > 0 AND "size_bytes" <= 15728640),
        "status" "asset_evidence_upload_status" NOT NULL DEFAULT 'pending',
        "expires_at" timestamptz NOT NULL,
        "uploaded_at" timestamptz,
        "attached_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE INDEX "idx_asset_evidence_upload_owner_status" ON "asset_evidence_uploads" ("owner_user_id", "status")`);
    await queryRunner.query(`CREATE INDEX "idx_asset_evidence_upload_expiry" ON "asset_evidence_uploads" ("status", "expires_at")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "idx_asset_evidence_upload_expiry"`);
    await queryRunner.query(`DROP INDEX "idx_asset_evidence_upload_owner_status"`);
    await queryRunner.query(`DROP TABLE "asset_evidence_uploads"`);
    await queryRunner.query(`DROP TYPE "asset_evidence_upload_status"`);
  }
}
