import { MigrationInterface, QueryRunner } from 'typeorm';

export class SetNewUserApprovalDefaultPending1795300000000
  implements MigrationInterface
{
  name = 'SetNewUserApprovalDefaultPending1795300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Existing accounts retain their current approval state. Only the database
    // default for newly inserted accounts changes to the secure pending state.
    await queryRunner.query(`
      ALTER TABLE "users"
      ALTER COLUMN "approval_status" SET DEFAULT 'pending_review'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Rollback restores the former default without rewriting existing accounts.
    await queryRunner.query(`
      ALTER TABLE "users"
      ALTER COLUMN "approval_status" SET DEFAULT 'approved'
    `);
  }
}
