import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreatePlatformGovernanceFoundation1793799020099
  implements MigrationInterface
{
  name = 'CreatePlatformGovernanceFoundation1793799020099';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "user_status" AS ENUM (
        'active',
        'inactive',
        'suspended'
      )
    `);

    await queryRunner.query(`
      CREATE TYPE "succession_status" AS ENUM (
        'pending',
        'approved',
        'rejected',
        'completed',
        'cancelled'
      )
    `);

    await queryRunner.query(`
      CREATE TYPE "succession_type" AS ENUM (
        'routine',
        'recovery',
        'dispute',
        'compromised_account'
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "users" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "full_name" varchar(200) NOT NULL,
        "email" varchar(320) NOT NULL,
        "password_hash" text NOT NULL,
        "status" "user_status" NOT NULL DEFAULT 'active',
        "is_founding_asset_manager" boolean NOT NULL DEFAULT false,
        "last_login_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deactivated_at" timestamptz,
        CONSTRAINT "PK_users" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_users_email" UNIQUE ("email"),
        CONSTRAINT "CHK_users_email_lowercase"
          CHECK ("email" = LOWER("email"))
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "platform_roles" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "user_id" uuid NOT NULL,
        "role" varchar(30) NOT NULL,
        "assigned_by_user_id" uuid,
        "assigned_at" timestamptz NOT NULL DEFAULT now(),
        "revoked_at" timestamptz,
        "reason" text,
        CONSTRAINT "PK_platform_roles" PRIMARY KEY ("id"),
        CONSTRAINT "FK_platform_roles_user"
          FOREIGN KEY ("user_id")
          REFERENCES "users"("id")
          ON DELETE RESTRICT,
        CONSTRAINT "FK_platform_roles_assigned_by"
          FOREIGN KEY ("assigned_by_user_id")
          REFERENCES "users"("id")
          ON DELETE RESTRICT,
        CONSTRAINT "CHK_platform_roles_role"
          CHECK ("role" IN ('Platform Owner', 'Platform Administrator'))
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_platform_roles_one_active_owner"
      ON "platform_roles" ("role")
      WHERE "role" = 'Platform Owner'
        AND "revoked_at" IS NULL
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_platform_roles_user"
      ON "platform_roles" ("user_id")
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_platform_roles_user_active_role"
      ON "platform_roles" ("user_id", "role")
      WHERE "revoked_at" IS NULL
    `);

    await queryRunner.query(`
      CREATE TABLE "platform_owner_successions" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "succession_type" "succession_type" NOT NULL,
        "status" "succession_status" NOT NULL DEFAULT 'pending',
        "initiated_by_user_id" uuid NOT NULL,
        "outgoing_owner_user_id" uuid,
        "proposed_successor_user_id" uuid NOT NULL,
        "approved_by_user_id" uuid,
        "governance_approval_reference" text,
        "reason" text NOT NULL,
        "initiated_at" timestamptz NOT NULL DEFAULT now(),
        "approved_at" timestamptz,
        "completed_at" timestamptz,
        "rejected_at" timestamptz,
        "rejection_reason" text,
        "cancelled_at" timestamptz,
        "cancellation_reason" text,
        "verification_metadata" jsonb,
        CONSTRAINT "PK_platform_owner_successions" PRIMARY KEY ("id"),
        CONSTRAINT "FK_succession_initiator"
          FOREIGN KEY ("initiated_by_user_id")
          REFERENCES "users"("id")
          ON DELETE RESTRICT,
        CONSTRAINT "FK_succession_outgoing_owner"
          FOREIGN KEY ("outgoing_owner_user_id")
          REFERENCES "users"("id")
          ON DELETE RESTRICT,
        CONSTRAINT "FK_succession_proposed_successor"
          FOREIGN KEY ("proposed_successor_user_id")
          REFERENCES "users"("id")
          ON DELETE RESTRICT,
        CONSTRAINT "FK_succession_approver"
          FOREIGN KEY ("approved_by_user_id")
          REFERENCES "users"("id")
          ON DELETE RESTRICT
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_platform_successions_status"
      ON "platform_owner_successions" ("status", "initiated_at")
    `);

    await queryRunner.query(`
      CREATE TABLE "platform_governance_state" (
        "id" smallint NOT NULL DEFAULT 1,
        "bootstrap_completed_at" timestamptz,
        "initial_owner_user_id" uuid,
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_platform_governance_state" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_platform_governance_singleton"
          CHECK ("id" = 1),
        CONSTRAINT "CHK_platform_governance_bootstrap_pair"
          CHECK (
            ("bootstrap_completed_at" IS NULL AND "initial_owner_user_id" IS NULL)
            OR
            ("bootstrap_completed_at" IS NOT NULL AND "initial_owner_user_id" IS NOT NULL)
          ),
        CONSTRAINT "FK_platform_governance_initial_owner"
          FOREIGN KEY ("initial_owner_user_id")
          REFERENCES "users"("id")
          ON DELETE RESTRICT
      )
    `);

    await queryRunner.query(`
      INSERT INTO "platform_governance_state" (
        "id",
        "bootstrap_completed_at",
        "initial_owner_user_id"
      )
      VALUES (1, NULL, NULL)
    `);

    await queryRunner.query(`
      CREATE TABLE "platform_audit_logs" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "actor_user_id" uuid,
        "action" varchar(150) NOT NULL,
        "entity_type" varchar(100) NOT NULL,
        "entity_id" uuid,
        "occurred_at" timestamptz NOT NULL DEFAULT now(),
        "outcome" varchar(30) NOT NULL,
        "reason" text,
        "request_id" varchar(150),
        "source_ip" inet,
        "user_agent" text,
        "metadata" jsonb,
        CONSTRAINT "PK_platform_audit_logs" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_platform_audit_outcome"
          CHECK ("outcome" IN ('success', 'failure', 'denied')),
        CONSTRAINT "FK_platform_audit_actor"
          FOREIGN KEY ("actor_user_id")
          REFERENCES "users"("id")
          ON DELETE RESTRICT
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_platform_audit_actor_time"
      ON "platform_audit_logs" ("actor_user_id", "occurred_at")
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_platform_audit_action_time"
      ON "platform_audit_logs" ("action", "occurred_at")
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_platform_audit_entity"
      ON "platform_audit_logs" ("entity_type", "entity_id", "occurred_at")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "platform_audit_logs"`);
    await queryRunner.query(`DROP TABLE "platform_governance_state"`);
    await queryRunner.query(`DROP TABLE "platform_owner_successions"`);
    await queryRunner.query(`DROP TABLE "platform_roles"`);
    await queryRunner.query(`DROP TABLE "users"`);

    await queryRunner.query(`DROP TYPE "succession_type"`);
    await queryRunner.query(`DROP TYPE "succession_status"`);
    await queryRunner.query(`DROP TYPE "user_status"`);
  }
}
