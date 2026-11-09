import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUserInternalApproval1794100000000 implements MigrationInterface {
  name = 'AddUserInternalApproval1794100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "user_approval_status" AS ENUM (
        'pending_review',
        'approved',
        'rejected'
      )
    `);

    // Existing accounts are grandfathered as approved. Only registrations
    // created after this migration enter the pending-review state.
    await queryRunner.query(`
      ALTER TABLE "users"
      ADD COLUMN "approval_status" "user_approval_status" NOT NULL DEFAULT 'approved',
      ADD COLUMN "approval_reviewed_by_user_id" uuid,
      ADD COLUMN "approval_reviewed_at" timestamptz,
      ADD COLUMN "approval_note" text
    `);

    await queryRunner.query(`
      ALTER TABLE "users"
      ADD CONSTRAINT "FK_users_approval_reviewer"
      FOREIGN KEY ("approval_reviewed_by_user_id")
      REFERENCES "users"("id")
      ON DELETE RESTRICT
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_users_approval_status_created"
      ON "users" ("approval_status", "created_at")
    `);

    await queryRunner.query(`
      INSERT INTO "permissions" ("key", "name", "description", "scope")
      VALUES (
        'platform.users.review',
        'Review platform registrations',
        'Approve or reject newly registered AssetPass user accounts.',
        'platform'
      )
      ON CONFLICT ("key") DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM "platform_role_permissions"
      WHERE "permission_id" IN (
        SELECT "id" FROM "permissions" WHERE "key" = 'platform.users.review'
      )
    `);
    await queryRunner.query(`DELETE FROM "permissions" WHERE "key" = 'platform.users.review'`);
    await queryRunner.query(`DROP INDEX "idx_users_approval_status_created"`);
    await queryRunner.query(`ALTER TABLE "users" DROP CONSTRAINT "FK_users_approval_reviewer"`);
    await queryRunner.query(`
      ALTER TABLE "users"
      DROP COLUMN "approval_note",
      DROP COLUMN "approval_reviewed_at",
      DROP COLUMN "approval_reviewed_by_user_id",
      DROP COLUMN "approval_status"
    `);
    await queryRunner.query(`DROP TYPE "user_approval_status"`);
  }
}
