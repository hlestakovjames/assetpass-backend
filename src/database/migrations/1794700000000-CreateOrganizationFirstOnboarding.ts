import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateOrganizationFirstOnboarding1794700000000 implements MigrationInterface {
  name = 'CreateOrganizationFirstOnboarding1794700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE "organizations" ALTER COLUMN "created_by_user_id" DROP NOT NULL');
    await queryRunner.query(`
      CREATE TABLE "organization_onboarding_applications" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "representative_first_name" varchar(100) NOT NULL,
        "representative_last_name" varchar(100) NOT NULL,
        "representative_email" varchar(320) NOT NULL,
        "representative_position" varchar(160) NOT NULL,
        "registration_relationship" varchar(120) NOT NULL,
        "authority_confirmed_at" timestamptz NOT NULL,
        "organization_data" jsonb NOT NULL,
        "verification_token_hash" varchar(64) NOT NULL,
        "verification_expires_at" timestamptz NOT NULL,
        "email_verified_at" timestamptz,
        "organization_id" uuid REFERENCES "organizations"("id") ON DELETE SET NULL,
        "claimed_by_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
        "claimed_at" timestamptz,
        "status" varchar(40) NOT NULL DEFAULT 'pending_email_verification',
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "chk_org_onboarding_status" CHECK ("status" IN ('pending_email_verification', 'submitted_for_review', 'claimed'))
      )
    `);
    await queryRunner.query('CREATE INDEX "idx_org_onboarding_status_created" ON "organization_onboarding_applications" ("status", "created_at")');
    await queryRunner.query('CREATE INDEX "idx_org_onboarding_organization" ON "organization_onboarding_applications" ("organization_id")');
    await queryRunner.query('CREATE INDEX "idx_org_onboarding_representative_email" ON "organization_onboarding_applications" (LOWER("representative_email"))');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE "organization_onboarding_applications"');
    await queryRunner.query('ALTER TABLE "organizations" ALTER COLUMN "created_by_user_id" SET NOT NULL');
  }
}
