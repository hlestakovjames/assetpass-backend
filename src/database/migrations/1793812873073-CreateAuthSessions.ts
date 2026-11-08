import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAuthSessions1793812873073
  implements MigrationInterface
{
  name = 'CreateAuthSessions1793812873073';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "auth_sessions" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "user_id" uuid NOT NULL,
        "token_hash" char(64) NOT NULL,
        "family_id" uuid NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "expires_at" timestamptz NOT NULL,
        "last_used_at" timestamptz,
        "revoked_at" timestamptz,
        "replaced_by_session_id" uuid,
        "revocation_reason" varchar(100),
        "source_ip" inet,
        "user_agent" varchar(1000),
        CONSTRAINT "PK_auth_sessions" PRIMARY KEY ("id"),
        CONSTRAINT "FK_auth_sessions_user"
          FOREIGN KEY ("user_id")
          REFERENCES "users"("id")
          ON DELETE RESTRICT,
        CONSTRAINT "FK_auth_sessions_replacement"
          FOREIGN KEY ("replaced_by_session_id")
          REFERENCES "auth_sessions"("id")
          ON DELETE RESTRICT,
        CONSTRAINT "CHK_auth_sessions_token_hash"
          CHECK ("token_hash" ~ '^[a-f0-9]{64}$'),
        CONSTRAINT "CHK_auth_sessions_expiry"
          CHECK ("expires_at" > "created_at")
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_auth_sessions_token_hash"
      ON "auth_sessions" ("token_hash")
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_auth_sessions_user_active"
      ON "auth_sessions" ("user_id", "expires_at")
      WHERE "revoked_at" IS NULL
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_auth_sessions_family"
      ON "auth_sessions" ("family_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "auth_sessions"`);
  }
}
