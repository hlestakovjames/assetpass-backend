import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateOrganizationIdentityAccess1793900000000 implements MigrationInterface {
  name = 'CreateOrganizationIdentityAccess1793900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TYPE "organization_status" AS ENUM ('pending_review', 'active', 'suspended', 'rejected')`);
    await queryRunner.query(`CREATE TYPE "organization_membership_status" AS ENUM ('pending', 'active', 'suspended', 'rejected', 'removed')`);
    await queryRunner.query(`CREATE TYPE "permission_scope" AS ENUM ('platform', 'organization', 'personal')`);
    await queryRunner.query(`
      CREATE TABLE "organizations" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "display_name" varchar(200) NOT NULL,
        "legal_name" varchar(250),
        "category" varchar(80) NOT NULL,
        "registration_number" varchar(100),
        "contact_email" varchar(320) NOT NULL,
        "contact_phone" varchar(40),
        "website" varchar(500),
        "description" text,
        "country_code" varchar(2) NOT NULL DEFAULT 'KE',
        "county" varchar(160),
        "city" varchar(160),
        "status" "organization_status" NOT NULL DEFAULT 'pending_review',
        "created_by_user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
        "reviewed_by_user_id" uuid REFERENCES "users"("id") ON DELETE RESTRICT,
        "reviewed_at" timestamptz,
        "decision_note" text,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "CHK_organizations_country_code" CHECK ("country_code" ~ '^[A-Z]{2}$')
      )
    `);
    await queryRunner.query(`CREATE UNIQUE INDEX "uq_organizations_registration_number" ON "organizations" ("registration_number") WHERE "registration_number" IS NOT NULL`);
    await queryRunner.query(`CREATE INDEX "idx_organizations_status_created" ON "organizations" ("status", "created_at")`);
    await queryRunner.query(`
      CREATE TABLE "organization_memberships" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE RESTRICT,
        "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
        "status" "organization_membership_status" NOT NULL DEFAULT 'pending',
        "invited_by_user_id" uuid REFERENCES "users"("id") ON DELETE RESTRICT,
        "joined_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE UNIQUE INDEX "uq_organization_memberships_user_org" ON "organization_memberships" ("user_id", "organization_id")`);
    await queryRunner.query(`CREATE INDEX "idx_organization_memberships_org_status" ON "organization_memberships" ("organization_id", "status")`);
    await queryRunner.query(`CREATE INDEX "idx_organization_memberships_user_status" ON "organization_memberships" ("user_id", "status")`);
    await queryRunner.query(`
      CREATE TABLE "permissions" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "key" varchar(120) NOT NULL UNIQUE,
        "name" varchar(200) NOT NULL,
        "description" text NOT NULL,
        "scope" "permission_scope" NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE TABLE "organization_roles" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "organization_id" uuid REFERENCES "organizations"("id") ON DELETE RESTRICT,
        "key" varchar(80) NOT NULL,
        "name" varchar(120) NOT NULL,
        "description" text,
        "is_system" boolean NOT NULL DEFAULT false,
        "is_active" boolean NOT NULL DEFAULT true,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE UNIQUE INDEX "uq_organization_roles_system_key" ON "organization_roles" ("key") WHERE "organization_id" IS NULL`);
    await queryRunner.query(`CREATE UNIQUE INDEX "uq_organization_roles_org_key" ON "organization_roles" ("organization_id", "key") WHERE "organization_id" IS NOT NULL`);
    await queryRunner.query(`
      CREATE TABLE "organization_membership_roles" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "membership_id" uuid NOT NULL REFERENCES "organization_memberships"("id") ON DELETE RESTRICT,
        "role_id" uuid NOT NULL REFERENCES "organization_roles"("id") ON DELETE RESTRICT,
        "assigned_by_user_id" uuid REFERENCES "users"("id") ON DELETE RESTRICT,
        "assigned_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE UNIQUE INDEX "uq_membership_role_assignment" ON "organization_membership_roles" ("membership_id", "role_id")`);
    await queryRunner.query(`
      CREATE TABLE "organization_role_permissions" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "role_id" uuid NOT NULL REFERENCES "organization_roles"("id") ON DELETE RESTRICT,
        "permission_id" uuid NOT NULL REFERENCES "permissions"("id") ON DELETE RESTRICT,
        "created_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE UNIQUE INDEX "uq_organization_role_permission" ON "organization_role_permissions" ("role_id", "permission_id")`);
    await queryRunner.query(`
      CREATE TABLE "platform_role_permissions" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "platform_role_id" uuid NOT NULL REFERENCES "platform_roles"("id") ON DELETE RESTRICT,
        "permission_id" uuid NOT NULL REFERENCES "permissions"("id") ON DELETE RESTRICT,
        "granted_by_user_id" uuid REFERENCES "users"("id") ON DELETE RESTRICT,
        "granted_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE UNIQUE INDEX "uq_platform_role_permission" ON "platform_role_permissions" ("platform_role_id", "permission_id")`);

    await queryRunner.query(`
      INSERT INTO "permissions" ("key", "name", "description", "scope") VALUES
      ('platform.users.read', 'View platform users', 'View the global user directory and account status.', 'platform'),
      ('platform.organizations.read', 'View organizations', 'View all organization registrations and records.', 'platform'),
      ('platform.organizations.review', 'Review organizations', 'Approve, reject or suspend organization registrations.', 'platform'),
      ('platform.roles.manage', 'Manage platform permissions', 'Grant and revoke delegated Platform Administrator permissions.', 'platform'),
      ('organization.members.read', 'View organization members', 'View members within the assigned organization.', 'organization'),
      ('organization.members.manage', 'Manage organization members', 'Invite, suspend and remove members within the assigned organization.', 'organization'),
      ('organization.roles.manage', 'Manage organization roles', 'Manage roles and permissions within the assigned organization.', 'organization'),
      ('organization.assets.read', 'View organization assets', 'View assets owned by the assigned organization.', 'organization'),
      ('organization.assets.manage', 'Manage organization assets', 'Register and manage assets owned by the assigned organization.', 'organization'),
      ('personal.assets.read', 'View personal assets', 'View assets owned by the authenticated individual.', 'personal'),
      ('personal.assets.manage', 'Manage personal assets', 'Register and manage assets owned by the authenticated individual.', 'personal')
    `);
    await queryRunner.query(`
      INSERT INTO "organization_roles" ("key", "name", "description", "is_system") VALUES
      ('organization_owner', 'Organization Owner', 'Primary owner of an approved organization workspace.', true),
      ('organization_admin', 'Organization Administrator', 'Manages organization settings and delegated access.', true),
      ('asset_manager', 'Asset Manager', 'Manages organization assets and lifecycle operations.', true),
      ('organization_member', 'Organization Member', 'Standard organization workspace access.', true)
    `);
    await queryRunner.query(`
      INSERT INTO "organization_role_permissions" ("role_id", "permission_id")
      SELECT r.id, p.id FROM "organization_roles" r CROSS JOIN "permissions" p
      WHERE r.key = 'organization_owner' AND p.scope = 'organization'
    `);
    await queryRunner.query(`
      INSERT INTO "organization_role_permissions" ("role_id", "permission_id")
      SELECT r.id, p.id FROM "organization_roles" r JOIN "permissions" p
      ON p.key IN ('organization.members.read', 'organization.members.manage', 'organization.roles.manage', 'organization.assets.read', 'organization.assets.manage')
      WHERE r.key = 'organization_admin'
    `);
    await queryRunner.query(`
      INSERT INTO "organization_role_permissions" ("role_id", "permission_id")
      SELECT r.id, p.id FROM "organization_roles" r JOIN "permissions" p
      ON p.key IN ('organization.assets.read', 'organization.assets.manage') WHERE r.key = 'asset_manager'
    `);
    await queryRunner.query(`
      INSERT INTO "organization_role_permissions" ("role_id", "permission_id")
      SELECT r.id, p.id FROM "organization_roles" r JOIN "permissions" p
      ON p.key = 'organization.assets.read' WHERE r.key = 'organization_member'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "platform_role_permissions"`);
    await queryRunner.query(`DROP TABLE "organization_role_permissions"`);
    await queryRunner.query(`DROP TABLE "organization_membership_roles"`);
    await queryRunner.query(`DROP TABLE "organization_roles"`);
    await queryRunner.query(`DROP TABLE "permissions"`);
    await queryRunner.query(`DROP TABLE "organization_memberships"`);
    await queryRunner.query(`DROP TABLE "organizations"`);
    await queryRunner.query(`DROP TYPE "permission_scope"`);
    await queryRunner.query(`DROP TYPE "organization_membership_status"`);
    await queryRunner.query(`DROP TYPE "organization_status"`);
  }
}
