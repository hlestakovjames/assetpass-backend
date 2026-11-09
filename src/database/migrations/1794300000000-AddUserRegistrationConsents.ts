import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUserRegistrationConsents1794300000000 implements MigrationInterface {
  name = 'AddUserRegistrationConsents1794300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "user_consents" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "user_id" uuid NOT NULL,
        "consent_type" varchar(40) NOT NULL,
        "version" varchar(40) NOT NULL,
        "accepted_at" timestamptz NOT NULL,
        "source" varchar(40) NOT NULL DEFAULT 'self_service_registration',
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_user_consents" PRIMARY KEY ("id"),
        CONSTRAINT "FK_user_consents_user" FOREIGN KEY ("user_id")
          REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "CHK_user_consents_type"
          CHECK ("consent_type" IN ('terms_of_service', 'privacy_notice')),
        CONSTRAINT "UQ_user_consents_user_type_version"
          UNIQUE ("user_id", "consent_type", "version")
      )
    `);
    await queryRunner.query('CREATE INDEX "idx_user_consents_user_accepted" ON "user_consents" ("user_id", "accepted_at")');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX "idx_user_consents_user_accepted"');
    await queryRunner.query('DROP TABLE "user_consents"');
  }
}
