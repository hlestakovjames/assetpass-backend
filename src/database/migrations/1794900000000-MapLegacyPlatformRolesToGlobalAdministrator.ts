import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Replaces legacy platform role labels without changing role/user/grant IDs.
 *
 * Existing Platform Owner becomes the top-level Global Administrator.
 * Existing Platform Administrator becomes Central Platform Administrator.
 * Role assignment timestamps, grant rows, governance ownership references,
 * succession history and audit records are intentionally preserved.
 */
export class MapLegacyPlatformRolesToGlobalAdministrator1794900000000
  implements MigrationInterface
{
  name = 'MapLegacyPlatformRolesToGlobalAdministrator1794900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const conflictingRows = (await queryRunner.query(`
      SELECT COUNT(*)::int AS count
      FROM "platform_roles"
      WHERE "role" IN (
        'Global Administrator',
        'Central Platform Administrator'
      )
    `)) as Array<{ count: number }>;

    if (Number(conflictingRows[0]?.count ?? 0) > 0) {
      throw new Error(
        'Global Administrator role migration found target role rows before conversion; reconcile them before retrying.',
      );
    }

    await queryRunner.query(`
      DROP INDEX IF EXISTS "uq_platform_roles_one_active_owner"
    `);
    await queryRunner.query(`
      ALTER TABLE "platform_roles"
      DROP CONSTRAINT IF EXISTS "CHK_platform_roles_role"
    `);

    await queryRunner.query(`
      UPDATE "platform_roles"
      SET "role" = CASE "role"
        WHEN 'Platform Owner' THEN 'Global Administrator'
        WHEN 'Platform Administrator' THEN 'Central Platform Administrator'
        ELSE "role"
      END
      WHERE "role" IN ('Platform Owner', 'Platform Administrator')
    `);

    await queryRunner.query(`
      ALTER TABLE "platform_roles"
      ADD CONSTRAINT "CHK_platform_roles_role"
      CHECK ("role" IN (
        'Global Administrator',
        'Central Platform Administrator'
      ))
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_platform_roles_one_active_owner"
      ON "platform_roles" ("role")
      WHERE "role" = 'Global Administrator'
        AND "revoked_at" IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const conflictingRows = (await queryRunner.query(`
      SELECT COUNT(*)::int AS count
      FROM "platform_roles"
      WHERE "role" IN (
        'Platform Owner',
        'Platform Administrator'
      )
    `)) as Array<{ count: number }>;

    if (Number(conflictingRows[0]?.count ?? 0) > 0) {
      throw new Error(
        'Cannot roll back platform role naming while legacy role rows already exist; reconcile them before retrying.',
      );
    }

    await queryRunner.query(`
      DROP INDEX IF EXISTS "uq_platform_roles_one_active_owner"
    `);
    await queryRunner.query(`
      ALTER TABLE "platform_roles"
      DROP CONSTRAINT IF EXISTS "CHK_platform_roles_role"
    `);

    await queryRunner.query(`
      UPDATE "platform_roles"
      SET "role" = CASE "role"
        WHEN 'Global Administrator' THEN 'Platform Owner'
        WHEN 'Central Platform Administrator' THEN 'Platform Administrator'
        ELSE "role"
      END
      WHERE "role" IN (
        'Global Administrator',
        'Central Platform Administrator'
      )
    `);

    await queryRunner.query(`
      ALTER TABLE "platform_roles"
      ADD CONSTRAINT "CHK_platform_roles_role"
      CHECK ("role" IN ('Platform Owner', 'Platform Administrator'))
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_platform_roles_one_active_owner"
      ON "platform_roles" ("role")
      WHERE "role" = 'Platform Owner'
        AND "revoked_at" IS NULL
    `);
  }
}
