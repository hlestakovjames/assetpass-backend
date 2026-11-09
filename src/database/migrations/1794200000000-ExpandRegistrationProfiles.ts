import { MigrationInterface, QueryRunner } from 'typeorm';

export class ExpandRegistrationProfiles1794200000000 implements MigrationInterface {
  name = 'ExpandRegistrationProfiles1794200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "user_profiles" (
        "user_id" uuid NOT NULL,
        "first_name" varchar(100) NOT NULL,
        "middle_name" varchar(100),
        "last_name" varchar(100) NOT NULL,
        "phone_number" varchar(40) NOT NULL,
        "alternative_phone" varchar(40),
        "country_code" varchar(2) NOT NULL DEFAULT 'KE',
        "county" varchar(160),
        "city" varchar(160),
        "physical_address" text,
        "postal_address" varchar(200),
        "occupation" varchar(160),
        "preferred_contact_method" varchar(20) NOT NULL DEFAULT 'email',
        "profile_photo_url" text,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_user_profiles" PRIMARY KEY ("user_id"),
        CONSTRAINT "FK_user_profiles_user" FOREIGN KEY ("user_id")
          REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "CHK_user_profiles_contact_method"
          CHECK ("preferred_contact_method" IN ('email', 'phone'))
      )
    `);

    await queryRunner.query(`
      ALTER TABLE "organizations"
        ADD COLUMN "organization_type" varchar(80),
        ADD COLUMN "industry_sector" varchar(120),
        ADD COLUMN "legal_structure" varchar(80),
        ADD COLUMN "registration_authority" varchar(160),
        ADD COLUMN "registration_date" date,
        ADD COLUMN "alternative_email" varchar(320),
        ADD COLUMN "postal_address" varchar(200),
        ADD COLUMN "postal_code" varchar(30),
        ADD COLUMN "physical_address" text,
        ADD COLUMN "tax_identifier" varchar(100),
        ADD COLUMN "logo_url" text
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_user_profiles_phone" ON "user_profiles" ("phone_number")
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_organizations_type_status" ON "organizations" ("organization_type", "status")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX "idx_organizations_type_status"');
    await queryRunner.query('DROP INDEX "idx_user_profiles_phone"');
    await queryRunner.query(`
      ALTER TABLE "organizations"
        DROP COLUMN "logo_url",
        DROP COLUMN "tax_identifier",
        DROP COLUMN "physical_address",
        DROP COLUMN "postal_code",
        DROP COLUMN "postal_address",
        DROP COLUMN "alternative_email",
        DROP COLUMN "registration_date",
        DROP COLUMN "registration_authority",
        DROP COLUMN "legal_structure",
        DROP COLUMN "industry_sector",
        DROP COLUMN "organization_type"
    `);
    await queryRunner.query('DROP TABLE "user_profiles"');
  }
}
