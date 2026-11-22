import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateOrganizationOnboardingSessions1794800000000 implements MigrationInterface {
  name = 'CreateOrganizationOnboardingSessions1794800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "organization_onboarding_sessions" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "application_id" uuid NOT NULL REFERENCES "organization_onboarding_applications"("id") ON DELETE CASCADE,
        "token_hash" varchar(64) NOT NULL UNIQUE,
        "scopes" varchar[] NOT NULL DEFAULT ARRAY['application.read']::varchar[],
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "last_seen_at" timestamptz NOT NULL DEFAULT now(),
        "expires_at" timestamptz NOT NULL,
        "revoked_at" timestamptz,
        CONSTRAINT "chk_org_onboarding_session_scopes"
          CHECK ("scopes" <@ ARRAY['application.read']::varchar[])
      )
    `);
    await queryRunner.query('CREATE INDEX "idx_org_onboarding_session_application" ON "organization_onboarding_sessions" ("application_id", "revoked_at")');
    await queryRunner.query('CREATE INDEX "idx_org_onboarding_session_expiry" ON "organization_onboarding_sessions" ("expires_at")');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE "organization_onboarding_sessions"');
  }
}
