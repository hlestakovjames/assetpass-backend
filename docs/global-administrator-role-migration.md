# Global Administrator Role Migration

**Status:** Implemented on the development branch; pending pull-request review and production migration approval.

## Decision

Global Administrator is the highest platform authority. It retains all registered platform-scoped operational permissions. Platform Owner is the ownership description/title associated with this top authority, not a separate RBAC role.

Existing Platform Owner appointments map to Global Administrator. Existing Platform Administrator appointments map to Central Platform Administrator, retaining only their existing individually assigned platform permissions.

Private individual and organisation records remain subject to separate purpose, resource, privacy and audit controls. Global Administrator authority does not create legal ownership of customer assets or organisation governance authority.

## Forward migration

Migration: `1794900000000-MapLegacyPlatformRolesToGlobalAdministrator`.

The migration renames role labels in existing `platform_roles` rows. It does not recreate users or role rows. It preserves user IDs, role IDs, grant rows, assignment/revocation timestamps, assigning users, governance ownership state, succession records and historical audit logs.

The migration has guards against mixed target-role rows, updates the role check constraint and active Global Administrator uniqueness index, and includes a guarded reverse migration.

## Runtime behavior

- Global Administrator resolves all registered `platform`-scope permissions and is the top authority for platform permission checks.
- Central Platform Administrator continues to resolve only the permissions linked to its existing role row.
- Legacy owner-only route decorators remain source-compatible and now mean Global Administrator-only.
- The one-time bootstrap command assigns Global Administrator only on an empty installation. It must never be rerun to convert an existing production account.

## Release and production boundary

The role migration is code-reviewed and validated through CI before production application. Merging code does not apply the migration. Neon PostgreSQL remains the production relational database. A production migration requires a separate approved migration window and a recoverable backup/restore point.

Before and after production migration, verify the same Global Administrator user ID remains in `platform_governance_state.initial_owner_user_id`, role/grant counts are unchanged, Global Administrator resolves all platform permissions, Central Platform Administrators retain only existing grants, and sign-in/audit continuity is intact.

See the [architecture decision and release sequence](https://github.com/hlestakovjames/assetpass-docs/blob/development/architecture-alignment/identity/global-administrator-role-migration.md).
