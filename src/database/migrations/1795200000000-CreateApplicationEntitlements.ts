import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateApplicationEntitlements1795200000000
  implements MigrationInterface
{
  name = 'CreateApplicationEntitlements1795200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "application_key" AS ENUM ('assetpass_app', 'marketplace')
    `);

    await queryRunner.query(`
      CREATE TABLE "user_application_entitlements" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
        "application_key" "application_key" NOT NULL,
        "granted_at" timestamptz NOT NULL DEFAULT now(),
        "granted_by_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
        "grant_source" varchar(80) NOT NULL,
        "revoked_at" timestamptz,
        "revoked_by_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
        "revocation_reason" text,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "CHK_user_application_entitlement_revocation"
          CHECK (
            ("revoked_at" IS NULL AND "revoked_by_user_id" IS NULL AND "revocation_reason" IS NULL)
            OR
            ("revoked_at" IS NOT NULL AND "revoked_at" >= "granted_at" AND "revocation_reason" IS NOT NULL)
          )
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_user_application_entitlement_active"
      ON "user_application_entitlements" ("user_id", "application_key")
      WHERE "revoked_at" IS NULL
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_user_application_entitlements_user"
      ON "user_application_entitlements" ("user_id", "granted_at")
    `);

    await queryRunner.query(`
      CREATE TABLE "organization_application_entitlements" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE RESTRICT,
        "application_key" "application_key" NOT NULL,
        "granted_at" timestamptz NOT NULL DEFAULT now(),
        "granted_by_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
        "grant_source" varchar(80) NOT NULL,
        "revoked_at" timestamptz,
        "revoked_by_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
        "revocation_reason" text,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "CHK_organization_application_entitlement_revocation"
          CHECK (
            ("revoked_at" IS NULL AND "revoked_by_user_id" IS NULL AND "revocation_reason" IS NULL)
            OR
            ("revoked_at" IS NOT NULL AND "revoked_at" >= "granted_at" AND "revocation_reason" IS NOT NULL)
          )
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_organization_application_entitlement_active"
      ON "organization_application_entitlements" ("organization_id", "application_key")
      WHERE "revoked_at" IS NULL
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_organization_application_entitlements_organization"
      ON "organization_application_entitlements" ("organization_id", "granted_at")
    `);

    await queryRunner.query(`
      ALTER TABLE "organization_memberships"
      ADD CONSTRAINT "UQ_organization_membership_identity_scope"
      UNIQUE ("id", "organization_id", "user_id")
    `);

    await queryRunner.query(`
      CREATE TABLE "organization_marketplace_representatives" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE RESTRICT,
        "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
        "membership_id" uuid NOT NULL,
        "granted_by_user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
        "granted_by_membership_id" uuid NOT NULL,
        "authority_basis" varchar(60) NOT NULL,
        "authority_reference" text,
        "effective_at" timestamptz NOT NULL DEFAULT now(),
        "expires_at" timestamptz,
        "revoked_at" timestamptz,
        "revoked_by_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
        "revocation_reason" text,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "FK_marketplace_rep_membership_scope"
          FOREIGN KEY ("membership_id", "organization_id", "user_id")
          REFERENCES "organization_memberships"("id", "organization_id", "user_id")
          ON DELETE RESTRICT,
        CONSTRAINT "FK_marketplace_rep_grantor_membership_scope"
          FOREIGN KEY ("granted_by_membership_id", "organization_id", "granted_by_user_id")
          REFERENCES "organization_memberships"("id", "organization_id", "user_id")
          ON DELETE RESTRICT,
        CONSTRAINT "CHK_marketplace_rep_authority_basis"
          CHECK ("authority_basis" IN (
            'organization_owner_approval',
            'organization_admin_approval',
            'documented_delegation',
            'legal_representative_verification'
          )),
        CONSTRAINT "CHK_marketplace_rep_authority_reference"
          CHECK (
            "authority_basis" NOT IN ('documented_delegation', 'legal_representative_verification')
            OR NULLIF(BTRIM("authority_reference"), '') IS NOT NULL
          ),
        CONSTRAINT "CHK_marketplace_rep_expiry"
          CHECK ("expires_at" IS NULL OR "expires_at" > "effective_at"),
        CONSTRAINT "CHK_marketplace_rep_revocation"
          CHECK (
            ("revoked_at" IS NULL AND "revoked_by_user_id" IS NULL AND "revocation_reason" IS NULL)
            OR
            ("revoked_at" IS NOT NULL AND "revocation_reason" IS NOT NULL)
          )
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_organization_marketplace_representative_active"
      ON "organization_marketplace_representatives" ("organization_id", "user_id")
      WHERE "revoked_at" IS NULL
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_organization_marketplace_representatives_user"
      ON "organization_marketplace_representatives" ("user_id", "effective_at")
    `);

    await queryRunner.query(`
      CREATE FUNCTION "guard_application_entitlement_history"()
      RETURNS trigger AS $entitlement_history$
      BEGIN
        IF TG_OP = 'DELETE' THEN
          RAISE EXCEPTION 'application entitlement history cannot be deleted'
            USING ERRCODE = '55000';
        END IF;
        IF (to_jsonb(NEW) - 'revoked_at' - 'revoked_by_user_id' - 'revocation_reason')
          IS DISTINCT FROM
           (to_jsonb(OLD) - 'revoked_at' - 'revoked_by_user_id' - 'revocation_reason') THEN
          RAISE EXCEPTION 'application entitlement grant identity is immutable'
            USING ERRCODE = '55000';
        END IF;
        IF OLD."revoked_at" IS NOT NULL
          OR NEW."revoked_at" IS NULL
          OR NEW."revocation_reason" IS NULL THEN
          RAISE EXCEPTION 'application entitlements may be revoked once and cannot be reactivated or rewritten'
            USING ERRCODE = '55000';
        END IF;
        RETURN NEW;
      END;
      $entitlement_history$ LANGUAGE plpgsql
    `);
    await queryRunner.query(`
      CREATE TRIGGER "trg_user_application_entitlement_history"
      BEFORE UPDATE OR DELETE ON "user_application_entitlements"
      FOR EACH ROW EXECUTE FUNCTION "guard_application_entitlement_history"()
    `);
    await queryRunner.query(`
      CREATE TRIGGER "trg_organization_application_entitlement_history"
      BEFORE UPDATE OR DELETE ON "organization_application_entitlements"
      FOR EACH ROW EXECUTE FUNCTION "guard_application_entitlement_history"()
    `);

    await queryRunner.query(`
      CREATE FUNCTION "guard_organization_marketplace_representative_history"()
      RETURNS trigger AS $representative_history$
      BEGIN
        IF TG_OP = 'DELETE' THEN
          RAISE EXCEPTION 'Marketplace representation history cannot be deleted'
            USING ERRCODE = '55000';
        END IF;
        IF NEW."id" IS DISTINCT FROM OLD."id"
          OR NEW."organization_id" IS DISTINCT FROM OLD."organization_id"
          OR NEW."user_id" IS DISTINCT FROM OLD."user_id"
          OR NEW."membership_id" IS DISTINCT FROM OLD."membership_id"
          OR NEW."granted_by_user_id" IS DISTINCT FROM OLD."granted_by_user_id"
          OR NEW."granted_by_membership_id" IS DISTINCT FROM OLD."granted_by_membership_id"
          OR NEW."authority_basis" IS DISTINCT FROM OLD."authority_basis"
          OR NEW."authority_reference" IS DISTINCT FROM OLD."authority_reference"
          OR NEW."effective_at" IS DISTINCT FROM OLD."effective_at"
          OR NEW."expires_at" IS DISTINCT FROM OLD."expires_at"
          OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
          RAISE EXCEPTION 'Marketplace representation grant identity is immutable'
            USING ERRCODE = '55000';
        END IF;
        IF OLD."revoked_at" IS NOT NULL
          OR NEW."revoked_at" IS NULL
          OR NEW."revocation_reason" IS NULL THEN
          RAISE EXCEPTION 'Marketplace representation grants may be revoked once and cannot be reactivated or rewritten'
            USING ERRCODE = '55000';
        END IF;
        RETURN NEW;
      END;
      $representative_history$ LANGUAGE plpgsql
    `);
    await queryRunner.query(`
      CREATE TRIGGER "trg_organization_marketplace_representative_history"
      BEFORE UPDATE OR DELETE ON "organization_marketplace_representatives"
      FOR EACH ROW EXECUTE FUNCTION "guard_organization_marketplace_representative_history"()
    `);

    await queryRunner.query(`
      INSERT INTO "user_application_entitlements"
        ("user_id", "application_key", "grant_source")
      SELECT "id", 'assetpass_app', 'migration_backfill'
      FROM "users"
      ON CONFLICT DO NOTHING
    `);
    await queryRunner.query(`
      INSERT INTO "organization_application_entitlements"
        ("organization_id", "application_key", "grant_source")
      SELECT "id", 'assetpass_app', 'migration_backfill'
      FROM "organizations"
      ON CONFLICT DO NOTHING
    `);

    await queryRunner.query(`
      INSERT INTO "permissions" ("key", "name", "description", "scope")
      VALUES (
        'organization.marketplace.manage',
        'Manage organization Marketplace participation',
        'Opt the organization into Marketplace and grant or revoke explicit Marketplace representation.',
        'organization'
      )
      ON CONFLICT ("key") DO NOTHING
    `);
    await queryRunner.query(`
      INSERT INTO "organization_role_permissions" ("role_id", "permission_id")
      SELECT role.id, permission.id
      FROM "organization_roles" role
      CROSS JOIN "permissions" permission
      WHERE role.key IN ('organization_owner', 'organization_admin')
        AND permission.key = 'organization.marketplace.manage'
      ON CONFLICT DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $application_entitlement_rollback_guard$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM "user_application_entitlements"
          WHERE "grant_source" <> 'migration_backfill'
             OR "revoked_at" IS NOT NULL
             OR "application_key" <> 'assetpass_app'
        ) OR EXISTS (
          SELECT 1 FROM "organization_application_entitlements"
          WHERE "grant_source" <> 'migration_backfill'
             OR "revoked_at" IS NOT NULL
             OR "application_key" <> 'assetpass_app'
        ) OR EXISTS (
          SELECT 1 FROM "organization_marketplace_representatives"
        ) THEN
          RAISE EXCEPTION 'Cannot roll back application entitlements after non-baseline grants or representation history exist; use a forward migration.';
        END IF;
      END;
      $application_entitlement_rollback_guard$;
    `);

    await queryRunner.query(`
      DELETE FROM "organization_role_permissions"
      WHERE "permission_id" = (
        SELECT id FROM "permissions" WHERE "key" = 'organization.marketplace.manage'
      )
    `);
    await queryRunner.query(`
      DELETE FROM "permissions" WHERE "key" = 'organization.marketplace.manage'
    `);

    await queryRunner.query(`DROP TRIGGER "trg_organization_marketplace_representative_history" ON "organization_marketplace_representatives"`);
    await queryRunner.query(`DROP FUNCTION "guard_organization_marketplace_representative_history"()`);
    await queryRunner.query(`DROP TABLE "organization_marketplace_representatives"`);

    await queryRunner.query(`DROP TRIGGER "trg_user_application_entitlement_history" ON "user_application_entitlements"`);
    await queryRunner.query(`DROP TRIGGER "trg_organization_application_entitlement_history" ON "organization_application_entitlements"`);
    await queryRunner.query(`DROP FUNCTION "guard_application_entitlement_history"()`);
    await queryRunner.query(`DROP TABLE "organization_application_entitlements"`);
    await queryRunner.query(`DROP TABLE "user_application_entitlements"`);
    await queryRunner.query(`ALTER TABLE "organization_memberships" DROP CONSTRAINT "UQ_organization_membership_identity_scope"`);
    await queryRunner.query(`DROP TYPE "application_key"`);
  }
}
