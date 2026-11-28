import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreatePasswordRecoveryFoundation1795000000000
  implements MigrationInterface
{
  name = 'CreatePasswordRecoveryFoundation1795000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "password_reset_tokens" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "token_hash" varchar(128) NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "expires_at" timestamptz NOT NULL,
        "used_at" timestamptz,
        "invalidated_at" timestamptz,
        "requested_ip" inet,
        CONSTRAINT "CHK_password_reset_token_expiry"
          CHECK ("expires_at" > "created_at")
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_password_reset_tokens_token_hash"
      ON "password_reset_tokens" ("token_hash")
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_password_reset_tokens_user_created"
      ON "password_reset_tokens" ("user_id", "created_at")
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_password_reset_tokens_expiry"
      ON "password_reset_tokens" ("expires_at")
    `);

    await queryRunner.query(`
      CREATE TABLE "password_reset_request_events" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "email_hash" char(64) NOT NULL,
        "requested_ip" inet,
        "created_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_password_reset_request_email_time"
      ON "password_reset_request_events" ("email_hash", "created_at")
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_password_reset_request_ip_time"
      ON "password_reset_request_events" ("requested_ip", "created_at")
      WHERE "requested_ip" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE "password_reset_request_events"');
    await queryRunner.query('DROP TABLE "password_reset_tokens"');
  }
}
