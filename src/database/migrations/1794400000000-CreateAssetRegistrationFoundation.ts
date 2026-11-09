import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAssetRegistrationFoundation1794400000000 implements MigrationInterface {
  name = 'CreateAssetRegistrationFoundation1794400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TYPE "asset_party_type" AS ENUM ('individual', 'organization', 'platform', 'external')`);
    await queryRunner.query(`CREATE TYPE "asset_registration_status" AS ENUM ('draft', 'submitted', 'under_review', 'approved', 'rejected', 'cancelled')`);
    await queryRunner.query(`CREATE TYPE "asset_status" AS ENUM ('active', 'under_maintenance', 'retired', 'disposed')`);
    await queryRunner.query(`CREATE SEQUENCE "assetpass_asset_id_seq" START 1 INCREMENT 1 NO CYCLE`);

    await queryRunner.query(`
      CREATE TABLE "asset_parties" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "party_type" "asset_party_type" NOT NULL,
        "user_id" uuid REFERENCES "users"("id") ON DELETE RESTRICT,
        "organization_id" uuid REFERENCES "organizations"("id") ON DELETE RESTRICT,
        "external_asset_party_id" uuid,
        "is_assetpass_platform_party" boolean NOT NULL DEFAULT false,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "CHK_asset_parties_exactly_one_subject" CHECK (
          ("party_type" = 'individual' AND "user_id" IS NOT NULL AND "organization_id" IS NULL AND "external_asset_party_id" IS NULL AND "is_assetpass_platform_party" = false)
          OR ("party_type" = 'organization' AND "user_id" IS NULL AND "organization_id" IS NOT NULL AND "external_asset_party_id" IS NULL AND "is_assetpass_platform_party" = false)
          OR ("party_type" = 'platform' AND "user_id" IS NULL AND "organization_id" IS NULL AND "external_asset_party_id" IS NULL AND "is_assetpass_platform_party" = true)
          OR ("party_type" = 'external' AND "user_id" IS NULL AND "organization_id" IS NULL AND "external_asset_party_id" IS NOT NULL AND "is_assetpass_platform_party" = false)
        )
      )
    `);
    await queryRunner.query(`CREATE UNIQUE INDEX "UQ_asset_parties_user" ON "asset_parties" ("user_id") WHERE "user_id" IS NOT NULL`);
    await queryRunner.query(`CREATE UNIQUE INDEX "UQ_asset_parties_organization" ON "asset_parties" ("organization_id") WHERE "organization_id" IS NOT NULL`);
    await queryRunner.query(`CREATE TABLE "external_asset_parties" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "display_name" varchar(200) NOT NULL, "party_kind" varchar(50) NOT NULL, "jurisdiction_code" varchar(10), "external_reference" varchar(150), "created_at" timestamptz NOT NULL DEFAULT now(), "updated_at" timestamptz NOT NULL DEFAULT now(), "deactivated_at" timestamptz)`);
    await queryRunner.query(`ALTER TABLE "asset_parties" ADD CONSTRAINT "FK_asset_parties_external" FOREIGN KEY ("external_asset_party_id") REFERENCES "external_asset_parties"("id") ON DELETE RESTRICT`);
    await queryRunner.query(`CREATE UNIQUE INDEX "UQ_asset_parties_external" ON "asset_parties" ("external_asset_party_id") WHERE "external_asset_party_id" IS NOT NULL`);
    await queryRunner.query(`CREATE UNIQUE INDEX "UQ_asset_parties_platform" ON "asset_parties" ("is_assetpass_platform_party") WHERE "is_assetpass_platform_party" = true`);

    await queryRunner.query(`
      CREATE TABLE "assets" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "assetpass_id" varchar(64) NOT NULL UNIQUE,
        "organization_id" uuid REFERENCES "organizations"("id") ON DELETE RESTRICT,
        "asset_tag" varchar(100),
        "name" varchar(200) NOT NULL,
        "description" text,
        "serial_number" varchar(200),
        "manufacturer" varchar(150),
        "model" varchar(150),
        "acquisition_date" date,
        "acquisition_cost" numeric(14,2),
        "currency_code" char(3),
        "status" "asset_status" NOT NULL DEFAULT 'active',
        "condition_label" varchar(50) NOT NULL,
        "registered_by_user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "retired_at" timestamptz,
        "disposed_at" timestamptz,
        "deactivated_at" timestamptz
      )
    `);
    await queryRunner.query(`CREATE UNIQUE INDEX "UQ_assets_org_asset_tag" ON "assets" ("organization_id", "asset_tag") WHERE "organization_id" IS NOT NULL AND "asset_tag" IS NOT NULL`);
    await queryRunner.query(`CREATE INDEX "idx_assets_status_condition" ON "assets" ("status", "condition_label")`);
    await queryRunner.query(`
      CREATE TABLE "asset_registration_applications" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "application_reference" varchar(64) NOT NULL UNIQUE,
        "applicant_user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
        "registration_context_party_id" uuid NOT NULL REFERENCES "asset_parties"("id") ON DELETE RESTRICT,
        "proposed_owner_party_id" uuid REFERENCES "asset_parties"("id") ON DELETE RESTRICT,
        "status" "asset_registration_status" NOT NULL DEFAULT 'draft',
        "asset_name" varchar(200) NOT NULL,
        "description" text,
        "serial_number" varchar(200),
        "manufacturer" varchar(150),
        "model" varchar(150),
        "condition_label" varchar(50) NOT NULL,
        "acquisition_date" date,
        "acquisition_cost" numeric(14,2),
        "currency_code" char(3),
        "ownership_basis" varchar(80) NOT NULL,
        "evidence_reference" text,
        "submitted_at" timestamptz,
        "reviewed_by_user_id" uuid REFERENCES "users"("id") ON DELETE RESTRICT,
        "reviewed_at" timestamptz,
        "decision_reason" text,
        "approved_asset_id" uuid UNIQUE,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE INDEX "idx_asset_registration_applicant_status" ON "asset_registration_applications" ("applicant_user_id", "status")`);
    await queryRunner.query(`CREATE INDEX "idx_asset_registration_context_status" ON "asset_registration_applications" ("registration_context_party_id", "status")`);
    await queryRunner.query(`
      CREATE TABLE "asset_registration_evidence" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "application_id" uuid NOT NULL REFERENCES "asset_registration_applications"("id") ON DELETE RESTRICT,
        "evidence_type" varchar(80) NOT NULL,
        "object_reference" text NOT NULL,
        "uploaded_by_user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
        "uploaded_at" timestamptz NOT NULL DEFAULT now(),
        "verification_status" varchar(30) NOT NULL DEFAULT 'pending',
        "verified_by_user_id" uuid REFERENCES "users"("id") ON DELETE RESTRICT,
        "verified_at" timestamptz,
        "verification_notes" text,
        CONSTRAINT "CHK_asset_registration_evidence_status" CHECK ("verification_status" IN ('pending', 'verified', 'rejected'))
      )
    `);
    await queryRunner.query(`CREATE INDEX "idx_asset_registration_evidence_application" ON "asset_registration_evidence" ("application_id", "evidence_type")`);

    await queryRunner.query(`
      CREATE TABLE "asset_ownership" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "asset_id" uuid NOT NULL REFERENCES "assets"("id") ON DELETE RESTRICT,
        "owner_party_id" uuid NOT NULL REFERENCES "asset_parties"("id") ON DELETE RESTRICT,
        "ownership_basis" varchar(80) NOT NULL,
        "evidence_reference" text,
        "valid_from" timestamptz NOT NULL,
        "valid_to" timestamptz,
        "recorded_by_user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
        "recorded_at" timestamptz NOT NULL DEFAULT now(),
        "change_reason" text,
        CONSTRAINT "CHK_asset_ownership_valid_period" CHECK ("valid_to" IS NULL OR "valid_to" > "valid_from")
      )
    `);
    await queryRunner.query(`CREATE UNIQUE INDEX "UQ_asset_ownership_one_current" ON "asset_ownership" ("asset_id") WHERE "valid_to" IS NULL`);
    await queryRunner.query(`CREATE INDEX "idx_asset_ownership_owner_valid_from" ON "asset_ownership" ("owner_party_id", "valid_from")`);

    await queryRunner.query(`
      CREATE TABLE "asset_registration_records" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "asset_id" uuid NOT NULL REFERENCES "assets"("id") ON DELETE RESTRICT,
        "registered_by_user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
        "registration_context_party_id" uuid NOT NULL REFERENCES "asset_parties"("id") ON DELETE RESTRICT,
        "registration_context_type" varchar(30) NOT NULL,
        "registered_at" timestamptz NOT NULL DEFAULT now(),
        "evidence_reference" text,
        "registration_notes" text,
        CONSTRAINT "CHK_asset_registration_context_type" CHECK ("registration_context_type" IN ('individual', 'organization', 'platform'))
      )
    `);
    await queryRunner.query(`CREATE INDEX "idx_asset_registration_records_asset_time" ON "asset_registration_records" ("asset_id", "registered_at")`);

    await queryRunner.query(`
      ALTER TABLE "asset_registration_applications"
      ADD CONSTRAINT "FK_asset_registration_approved_asset"
      FOREIGN KEY ("approved_asset_id") REFERENCES "assets"("id") ON DELETE RESTRICT
    `);

    await queryRunner.query(`
      INSERT INTO "permissions" ("key", "name", "description", "scope")
      VALUES
        ('organization.assets.review', 'Review organization asset registrations', 'Review and decide asset registration applications submitted in the assigned organization.', 'organization'),
        ('platform.assets.review', 'Review individual asset registrations', 'Review individual asset registration applications and apply platform-level risk controls.', 'platform')
      ON CONFLICT ("key") DO NOTHING
    `);
    await queryRunner.query(`
      INSERT INTO "organization_role_permissions" ("role_id", "permission_id")
      SELECT r.id, p.id FROM "organization_roles" r CROSS JOIN "permissions" p
      WHERE r.key IN ('organization_owner', 'organization_admin', 'asset_manager')
        AND p.key = 'organization.assets.review'
      ON CONFLICT DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM "organization_role_permissions" WHERE "permission_id" IN (SELECT id FROM "permissions" WHERE "key" = 'organization.assets.review')`);
    await queryRunner.query(`DELETE FROM "permissions" WHERE "key" IN ('organization.assets.review', 'platform.assets.review')`);
    await queryRunner.query(`ALTER TABLE "asset_registration_applications" DROP CONSTRAINT "FK_asset_registration_approved_asset"`);
    await queryRunner.query(`DROP TABLE "asset_registration_records"`);
    await queryRunner.query(`DROP TABLE "asset_ownership"`);
    await queryRunner.query(`DROP TABLE "asset_registration_evidence"`);
    await queryRunner.query(`DROP TABLE "asset_registration_applications"`);
    await queryRunner.query(`DROP TABLE "assets"`);
    await queryRunner.query(`DROP TABLE "asset_parties"`);
    await queryRunner.query(`DROP TABLE "external_asset_parties"`);
    await queryRunner.query(`DROP SEQUENCE "assetpass_asset_id_seq"`);
    await queryRunner.query(`DROP TYPE "asset_status"`);
    await queryRunner.query(`DROP TYPE "asset_registration_status"`);
    await queryRunner.query(`DROP TYPE "asset_party_type"`);
  }
}