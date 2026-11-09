# Identity, organization and access model

Status: implementation contract (work in progress). This document describes the first backend foundation; it does not claim that all workspace or registration workflows are complete.

## Identity model

A person has one AssetPass user account. Individual ownership and organization participation are contexts attached to that identity, not separate login accounts. One user may own personal assets and hold different roles in several organizations.

## Authorization boundaries

- Platform scope: existing `platform_roles` remains authoritative for Platform Owner and Platform Administrator. The Platform Owner is the global authority and bypasses delegated platform permission checks. Platform Administrators receive only explicitly granted platform permissions.
- Organization scope: membership and organization role assignments are always scoped to one organization. An organization role never grants platform authority.
- Personal scope: personal resources are limited to the authenticated user.

## Organization onboarding

1. An authenticated user submits an organization registration.
2. The organization is created as `pending_review`; the submitting user's membership is `pending`.
3. A platform authority reviews the registration.
4. Approval activates the organization and membership, then assigns the system Organization Owner role to the submitting user.
5. Rejection records a decision note and rejects the pending membership. No organization workspace is granted.

## First data model

- `organizations`: registration identity, contact details, status and review metadata.
- `organization_memberships`: user-to-organization relationship and lifecycle status.
- `organization_roles`: system role templates and organization-scoped custom roles.
- `permissions`: permission catalogue with explicit platform, organization or personal scope.
- `organization_membership_roles`: role assignments to a membership.
- `organization_role_permissions`: organization role-to-permission grants.
- `platform_role_permissions`: explicit permission grants for the existing Platform Administrator role. Existing `platform_roles` is not duplicated.

## Security invariants

- Password hashes, access tokens and refresh tokens are never exposed by directory endpoints.
- Registration does not grant access before approval.
- Organization role assignment must be checked against the membership's organization.
- Platform permissions are granted only by the Platform Owner.
- The Platform Owner bootstrap and existing owner record are not recreated or modified by this module.
- All state-changing organization decisions are audited.
- TypeORM schema synchronization remains disabled; schema changes are migration-only.

## API foundation

- `POST /api/v1/organizations`: submit a registration as the authenticated user.
- `GET /api/v1/organizations/mine`: list the caller's pending and active organization contexts.
- `GET /api/v1/platform/organizations`: list organizations (permission: `platform.organizations.read`).
- `PATCH /api/v1/platform/organizations/:id/status`: review an organization (permission: `platform.organizations.review`).
- `GET /api/v1/platform/users`: global user directory (permission: `platform.users.read`).
- `GET /api/v1/platform/permissions` and administrator permission endpoints: delegated platform permission management.

This is a staged foundation. Organization member invitations, organization role editing, individual workspace APIs and registration UI are subsequent implementation work.
