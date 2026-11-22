import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateSessionWorkspaceContext1794600000000 implements MigrationInterface {
  name = 'CreateSessionWorkspaceContext1794600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "auth_session_contexts" (
        "session_id" uuid PRIMARY KEY,
        "context_type" varchar(20) NOT NULL,
        "context_id" uuid,
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "fk_auth_session_contexts_session"
          FOREIGN KEY ("session_id") REFERENCES "auth_sessions"("id") ON DELETE CASCADE,
        CONSTRAINT "chk_auth_session_contexts_type"
          CHECK ("context_type" IN ('platform', 'individual', 'organization')),
        CONSTRAINT "chk_auth_session_contexts_identifier"
          CHECK (
            ("context_type" = 'platform' AND "context_id" IS NULL)
            OR
            ("context_type" IN ('individual', 'organization') AND "context_id" IS NOT NULL)
          )
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_auth_session_contexts_type_id"
      ON "auth_session_contexts" ("context_type", "context_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE "auth_session_contexts"');
  }
}
