import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateIndividualWorkspaceActivation1794500000000 implements MigrationInterface {
  name = 'CreateIndividualWorkspaceActivation1794500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "individual_workspace_status" AS ENUM ('active', 'inactive')`,
    );

    await queryRunner.query(`
      CREATE TABLE "individual_workspaces" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "user_id" uuid NOT NULL,
        "status" "individual_workspace_status" NOT NULL DEFAULT 'active',
        "activated_at" timestamptz,
        "deactivated_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "uq_individual_workspaces_user" UNIQUE ("user_id"),
        CONSTRAINT "fk_individual_workspaces_user"
          FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT,
        CONSTRAINT "chk_individual_workspace_lifecycle" CHECK (
          ("status" = 'active' AND "activated_at" IS NOT NULL AND "deactivated_at" IS NULL)
          OR
          ("status" = 'inactive' AND "deactivated_at" IS NOT NULL)
        )
      )
    `);

    // Preserve the current experience for all existing accounts. Accounts
    // registered after this migration may remain without an Individual Workspace.
    await queryRunner.query(`
      INSERT INTO "individual_workspaces"
        ("user_id", "status", "activated_at", "deactivated_at")
      SELECT "id", 'active', COALESCE("created_at", now()), NULL
      FROM "users"
      ON CONFLICT ("user_id") DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE "individual_workspaces"');
    await queryRunner.query('DROP TYPE "individual_workspace_status"');
  }
}
