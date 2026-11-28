import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateOrganizationMembershipHistory1795100000000
  implements MigrationInterface
{
  name = 'CreateOrganizationMembershipHistory1795100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "organization_membership_event_type" AS ENUM (
        'membership_created',
        'membership_invited',
        'invitation_accepted',
        'membership_activated',
        'membership_suspended',
        'membership_reactivated',
        'membership_rejected',
        'membership_removed',
        'membership_reinvited',
        'membership_rejoined',
        'membership_baseline_recorded'
      )
    `);

    await queryRunner.query(`
      ALTER TABLE "organization_membership_roles"
      ADD COLUMN "revoked_at" timestamptz,
      ADD COLUMN "revoked_by_user_id" uuid REFERENCES "users"("id") ON DELETE RESTRICT,
      ADD COLUMN "revocation_reason" text
    `);

    await queryRunner.query(`DROP INDEX "uq_membership_role_assignment"`);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_membership_role_assignment_active"
      ON "organization_membership_roles" ("membership_id", "role_id")
      WHERE "revoked_at" IS NULL
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_membership_role_assignment_active"
      ON "organization_membership_roles" ("membership_id", "assigned_at")
      WHERE "revoked_at" IS NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "organization_membership_roles"
      ADD CONSTRAINT "CHK_membership_role_revocation_after_assignment"
      CHECK ("revoked_at" IS NULL OR "revoked_at" >= "assigned_at")
    `);
    await queryRunner.query(`
      CREATE FUNCTION "guard_organization_membership_role_history"()
      RETURNS trigger AS $role_history$
      BEGIN
        IF TG_OP = 'DELETE' THEN
          RAISE EXCEPTION 'organization_membership_roles history cannot be deleted'
            USING ERRCODE = '55000';
        END IF;
        IF NEW."membership_id" IS DISTINCT FROM OLD."membership_id"
          OR NEW."role_id" IS DISTINCT FROM OLD."role_id"
          OR NEW."assigned_by_user_id" IS DISTINCT FROM OLD."assigned_by_user_id"
          OR NEW."assigned_at" IS DISTINCT FROM OLD."assigned_at" THEN
          RAISE EXCEPTION 'organization_membership_roles assignment identity is immutable'
            USING ERRCODE = '55000';
        END IF;
        IF OLD."revoked_at" IS NOT NULL
          OR NEW."revoked_at" IS NULL
          OR NEW."revocation_reason" IS NULL THEN
          RAISE EXCEPTION 'role assignments may be revoked once and cannot be reactivated or rewritten'
            USING ERRCODE = '55000';
        END IF;
        RETURN NEW;
      END;
      $role_history$ LANGUAGE plpgsql
    `);
    await queryRunner.query(`
      CREATE TRIGGER "trg_organization_membership_roles_history_guard"
      BEFORE UPDATE OR DELETE ON "organization_membership_roles"
      FOR EACH ROW EXECUTE FUNCTION "guard_organization_membership_role_history"()
    `);

    await queryRunner.query(`
      CREATE TABLE "organization_membership_events" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "event_sequence" bigserial NOT NULL UNIQUE,
        "membership_id" uuid NOT NULL REFERENCES "organization_memberships"("id") ON DELETE RESTRICT,
        "event_type" "organization_membership_event_type" NOT NULL,
        "previous_status" "organization_membership_status",
        "new_status" "organization_membership_status",
        "actor_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
        "effective_at" timestamptz NOT NULL,
        "recorded_at" timestamptz NOT NULL DEFAULT now(),
        "reason" text,
        "metadata" jsonb
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_organization_membership_events_membership_sequence"
      ON "organization_membership_events" ("membership_id", "event_sequence")
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_organization_membership_events_actor_recorded"
      ON "organization_membership_events" ("actor_user_id", "recorded_at")
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_organization_membership_events_type_recorded"
      ON "organization_membership_events" ("event_type", "recorded_at")
    `);

    await queryRunner.query(`
      CREATE FUNCTION "reject_organization_membership_event_mutation"()
      RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'organization_membership_events is append-only'
          USING ERRCODE = '55000';
      END;
      $$ LANGUAGE plpgsql
    `);
    await queryRunner.query(`
      CREATE TRIGGER "trg_organization_membership_events_append_only"
      BEFORE UPDATE OR DELETE ON "organization_membership_events"
      FOR EACH ROW EXECUTE FUNCTION "reject_organization_membership_event_mutation"()
    `);

    await queryRunner.query(`
      INSERT INTO "organization_membership_events" (
        "membership_id", "event_type", "previous_status", "new_status",
        "actor_user_id", "effective_at", "recorded_at", "reason", "metadata"
      )
      SELECT
        membership."id",
        'membership_baseline_recorded',
        NULL,
        membership."status",
        NULL,
        now(),
        now(),
        'Current membership state captured at DBR-06 migration cutover; no earlier lifecycle history is inferred.',
        jsonb_build_object(
          'baseline', true,
          'source_migration', '1795100000000-CreateOrganizationMembershipHistory'
        )
      FROM "organization_memberships" membership
      ORDER BY membership."created_at", membership."id"
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TRIGGER "trg_organization_membership_events_append_only" ON "organization_membership_events"`);
    await queryRunner.query(`DROP FUNCTION "reject_organization_membership_event_mutation"()`);
    await queryRunner.query(`DROP TABLE "organization_membership_events"`);
    await queryRunner.query(`DROP TYPE "organization_membership_event_type"`);

    await queryRunner.query(`DROP TRIGGER "trg_organization_membership_roles_history_guard" ON "organization_membership_roles"`);
    await queryRunner.query(`DROP FUNCTION "guard_organization_membership_role_history"()`);
    await queryRunner.query(`ALTER TABLE "organization_membership_roles" DROP CONSTRAINT "CHK_membership_role_revocation_after_assignment"`);
    await queryRunner.query(`DROP INDEX "idx_membership_role_assignment_active"`);
    await queryRunner.query(`
      DROP INDEX "uq_membership_role_assignment_active"
    `);
    await queryRunner.query(`
      ALTER TABLE "organization_membership_roles"
      DROP COLUMN "revocation_reason",
      DROP COLUMN "revoked_by_user_id",
      DROP COLUMN "revoked_at"
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_membership_role_assignment"
      ON "organization_membership_roles" ("membership_id", "role_id")
    `);
  }
}
