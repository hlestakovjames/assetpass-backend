import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddEmailVerification1794000000000 implements MigrationInterface {
  name = 'AddEmailVerification1794000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" ADD COLUMN "email_verified_at" timestamptz`);
    // Existing accounts predate mandatory verification and remain trusted.
    await queryRunner.query(`UPDATE "users" SET "email_verified_at" = COALESCE("created_at", now()) WHERE "email_verified_at" IS NULL`);
    await queryRunner.query(`
      CREATE TABLE "email_verifications" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "token_hash" char(64) NOT NULL,
        "expires_at" timestamptz NOT NULL,
        "used_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "CHK_email_verifications_token_hash" CHECK ("token_hash" ~ '^[a-f0-9]{64}$'),
        CONSTRAINT "CHK_email_verifications_expiry" CHECK ("expires_at" > "created_at")
      )
    `);
    await queryRunner.query(`CREATE UNIQUE INDEX "uq_email_verifications_token_hash" ON "email_verifications" ("token_hash")`);
    await queryRunner.query(`CREATE INDEX "idx_email_verifications_user_active" ON "email_verifications" ("user_id", "expires_at") WHERE "used_at" IS NULL`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "email_verifications"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "email_verified_at"`);
  }
}
