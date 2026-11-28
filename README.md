# AssetPass Backend

**Repository:** `hlestakovjames/assetpass-backend`  
**Application responsibility:** Shared AssetPass API, domain services, identity, authorization, persistence and integration foundation.  
**Implementation status:** Early backend foundation; implemented modules and planned domains are distinguished below.

## Architecture position

The backend is the authoritative service boundary for AssetPass. It currently follows a NestJS modular application with TypeORM and PostgreSQL. The target direction is a domain-oriented modular monolith with clear domain ownership and selective future service extraction where justified.

Do not treat every documented domain as an existing module or introduce microservices simply to mirror the domain catalogue. Do not replace TypeORM with another ORM without a separately reviewed decision and migration plan.

**Production relational database:** Neon PostgreSQL remains the production database. Local development and CI may use separate PostgreSQL instances. Object storage is independent of the relational database and follows the provider-neutral S3-compatible storage architecture; the existence of a Neon object-storage bucket does not make it the selected application storage provider.

## Current implemented source areas

- `identity`: user identity, profile and consent persistence.
- `auth`: registration, login, email verification, access tokens, rotating refresh-token sessions, JWT strategy, CSRF/browser-origin protections, email delivery, password reset/change and session revocation (Phase 1 integration).
- `platform-governance`: Global Administrator and Central Platform Administrator role hierarchy, plus platform governance/succession foundation. The forward migration preserves existing platform role row IDs, user IDs, grants, assignment/revocation timestamps, governance ownership references, succession history and audit records while mapping legacy role names. The existing Platform Owner becomes the top Global Administrator and retains all registered platform operational permissions. Do not rerun bootstrap or recreate the existing owner account.
- `access-control`: platform and organisation role/permission persistence, retained organization role-assignment history with one-time revocation and platform permission guard.
- `organizations`: organisation records, stable memberships, append-only lifecycle history, invitation/rejoin flows, member/role management and tenant-scoped member-history API.
- `assets`: asset parties, registration applications/evidence/records, ownership foundation and asset registration APIs.
- `audit`: platform audit records.
- `health`: health endpoint.
- `workspaces`: explicit Individual Workspace activation/deactivation lifecycle, session-scoped workspace context selection, persisted state, audit events and server-side active-workspace guard.
- `database/migrations`: TypeORM migrations.
- `test`: end-to-end test foundation.

The Marketplace, Central Intelligence, Central Security, Cyber Defence, document vault, full lifecycle, taxonomy, workflow and broader operations domains are target architecture areas, not claims of complete implementation.

## Technology baseline

- Node.js 22 in CI
- NestJS 11
- TypeScript
- TypeORM 0.3.31
- PostgreSQL
- Argon2 password hashing
- JWT access tokens and rotating refresh-token sessions
- Jest and Supertest test tooling

Database schema synchronization is disabled. Schema changes must be delivered through reviewed TypeORM migrations.

## Local development

Requires Node.js 22, npm and a PostgreSQL database.

```bash
npm ci
```

Copy the example environment file and set local values:

```bash
cp .env.example .env
```

At minimum, configure a local `DATABASE_URL`, a unique `JWT_ACCESS_SECRET`, `APP_ORIGIN`, the exact `TRUSTED_ORIGINS` for the App and Marketplace BFF origins, `TRUST_PROXY_HOPS` set only to the verified reverse-proxy hop count (default `0`), and an email provider configuration appropriate to your environment. Never commit real credentials or production secrets.

Inspect pending migrations before applying them:

```bash
npm run migration:show
npm run migration:run
```

Start the API:

```bash
npm run start:dev
```

The API global prefix is `/api/v1`; the default local port is `3001`. The health endpoint is provided by the health module.

### Workspace context selection API

- `POST /api/v1/workspaces/context/select` — select an authorised platform, Individual Workspace or organisation context for the current authenticated session. The request accepts `contextType` and `contextId` (null only for platform context). The backend verifies current authority and records an audit event. Selection follows refresh-token rotation within the same session family; separate login sessions remain independent.

### Individual Workspace lifecycle API

- `POST /api/v1/workspaces/individual/activate` — activate or reactivate the authenticated user's Individual Workspace.
- `POST /api/v1/workspaces/individual/deactivate` — deactivate the authenticated user's Individual Workspace without deleting its workspace record.

Both operations require an authenticated session. The actor is derived from the validated JWT; the API does not accept a client-supplied user ID. Each transition is committed with an audit event. `GET /api/v1/auth/me` and the login identity response include only activated Individual Workspaces in `availableWorkspaces`; `defaultWorkspace` may now be `null`.

### Password recovery and account security API

The Phase 1 password-recovery implementation adds:

- `POST /api/v1/auth/password-reset/request` — always returns the same generic response whether or not the account exists. Requests are throttled by a keyed email hash; an IP throttle is additionally applied only when the source IP is obtained through an explicitly configured trusted proxy chain.
- `POST /api/v1/auth/password-reset/confirm` — consumes a high-entropy, 15-minute, single-use reset token and updates the password atomically.
- `POST /api/v1/auth/change-password` — requires a valid access token, browser origin and CSRF token, and verifies the current password before changing it.

Reset tokens are stored only as SHA-256 hashes. Email reset links carry the one-time token in the URL fragment; the reset page consumes and removes the fragment before submitting the token. Reset requests use HMAC-hashed email identifiers in a short-retention rate-limit event table rather than storing raw email addresses in that table. Successful reset/change revokes all refresh sessions and invalidates outstanding reset tokens. A fresh login is required.

Password recovery does not change account approval, activation, suspension, email verification, membership, workspace or permission state. An account that remains pending, rejected, suspended or deactivated remains subject to the ordinary login eligibility checks.

The additive migration `1795000000000-CreatePasswordRecoveryFoundation` creates `password_reset_tokens` and `password_reset_request_events`. It is merged to `development/architecture-alignment` and passed isolated CI migration validation. It has not been applied to production.

### Membership lifecycle and role history API

The DBR-06 implementation adds:

- `GET /api/v1/organizations/:organizationId/members/:membershipId/history` — requires the caller to hold `organization.members.read` within the requested active organization. It returns the stable membership anchor, first `joined_at`, ordered append-only lifecycle events and retained role-assignment history.
- Membership events record creation, invitation, acceptance, activation, suspension, reactivation, rejection, removal, re-invitation and rejoin. The database enforces append-only event history and monotonic event ordering.
- Role assignment rows are never deleted or reactivated. Revocation records actor, timestamp and reason; a partial unique index permits only one active membership/role assignment. A database trigger blocks deletion, assignment identity rewrites and repeated revocation.
- Rejoining a removed member preserves the original membership ID and first `joined_at`, but requires fresh explicit role grants. Suspended memberships retain their grants while authorization remains blocked by membership status.
- Organization and asset permission checks require an active membership, active role, unrevoked assignment, organization-scoped permission and a system role or role owned by the requested organization.

Migration `1795100000000-CreateOrganizationMembershipHistory` is merged to `development/architecture-alignment` and passed isolated CI apply/rollback/reapply plus SQL trigger-behavior tests. The migration preserves existing membership and role-assignment IDs, records only a migration-time baseline, and closes legacy grants only for memberships already removed/rejected. Its rollback guard prevents discarding real membership events or role revocations. It has not been applied to production.

## Validation

```bash
npm run build
npm test -- --runInBand
npm run test:e2e
```

The GitHub Actions workflow validates the backend build, unit tests, HTTP end-to-end suite, and all TypeORM migrations against disposable PostgreSQL 16 services. The migration-validation job applies the full sequence, tests the membership event/role-assignment database guards, rolls back the five latest additive foundations in reverse order, reapplies them and verifies the final migration state. Phase 1 DBR-06 integration validation: 26 unit-test suites / 179 tests passed, 3 HTTP E2E suites / 35 tests passed, build passed, migration apply/rollback/reapply and SQL guard checks passed. [Successful backend CI run #445](https://github.com/hlestakovjames/assetpass-backend/actions/runs/46096402182). Run lint separately when changing code; review the current lint script before using it because it applies automatic fixes.

## Platform role hierarchy and migration

The Global Administrator is the highest platform authority and retains all registered platform operational permissions. Existing Platform Owner and Platform Administrator assignments are converted in place to Global Administrator and Central Platform Administrator, respectively. The migration preserves role IDs, user IDs, permission-grant rows, governance ownership references, succession records and audit history. Central Platform Administrators retain only their explicitly assigned platform permissions. Private individual and organisation records remain subject to their separate access and audit policies.

See [Global Administrator Role Migration](docs/global-administrator-role-migration.md). This migration is not applied to production by a code merge; production application requires a separately approved migration window.

## Workspace lifecycle implementation note

See [Individual Workspace Lifecycle](docs/individual-workspace-lifecycle.md) for the persistence model, endpoints, audit behavior and migration-before-deployment requirement.

## Organisation-first onboarding implementation note

See [Organisation-First Onboarding](docs/organization-first-onboarding.md) for the account-free application, representative verification, restricted session, approval/claim flow, migration order and guarded rollback behavior.

## Critical implementation invariants

- Resolve identity, active context, tenant and permissions on the server.
- Do not infer authority from a client-supplied role, workspace ID or navigation state.
- Preserve platform, organisation and individual authorization boundaries.
- Organisation-first onboarding must verify an attributable human representative before platform review. The initial implementation issues a separate application-bound read-only onboarding session after email verification, alongside a separate post-approval claim code. Do not permit anonymous sensitive administration.
- Account creation must remain separate from Individual Workspace activation. Existing accounts are backfilled as active by the new migration to preserve their current access; accounts registered after the migration are not automatically given an Individual Workspace.
- Asset identity, ownership, management authority, custody, assignment and location are distinct.
- Preserve recipient acknowledgement and atomic completion of custody-changing asset transfers.
- Marketplace commands must not directly mutate authoritative asset ownership/custody tables.
- Keep audit evidence for consequential state changes.
- Keep `synchronize: false`; use migrations only.

## Next alignment work

1. Complete CI and review of the Individual Workspace lifecycle and session-scoped context selection.
2. Complete CI and review of the account-free organisation application, representative verification, platform review and post-approval claim-code flow.
3. Complete current-head CI, PostgreSQL migration apply/rollback/reapply checks, and cross-application authentication/security validation for the Phase 1 shared App and Marketplace browser-authentication integration. Do not promote the password-recovery migration or deploy until those checks pass; then continue with private evidence upload/review and multiple-representative authority.
4. Review and apply the Global Administrator role migration only after the full PR chain is merged and the production migration plan is explicitly approved.
5. Platform-managed asset taxonomy and expanded lifecycle APIs.
6. Marketplace domain, public discovery and transaction boundaries.
7. Shared document, workflow, communication, integration and intelligence/security capabilities.

## Source of truth

The expanded product and technical architecture, requirements, API boundaries, data diagrams, decision register and acceptance criteria are maintained in [assetpass-docs](https://github.com/hlestakovjames/assetpass-docs).


## Organisation-first onboarding

Organisation registration is now a separate lifecycle; `POST /api/v1/auth/register` rejects `accountType=organization` while individual account registration remains unchanged.

- `POST /api/v1/organizations/onboarding/applications` — public, browser-origin guarded application submission. Does not create a personal account.
- `POST /api/v1/organizations/onboarding/resend-verification` — generic-response verification resend.
- `POST /api/v1/organizations/onboarding/verify-email` — consumes a hashed, single-use 24-hour representative email token, creates an organisation in `pending_review` and returns a separate restricted session token once.
- Existing `/api/v1/platform/organizations/:id/status` review controls approve/reject the organisation. Approval issues a single-use claim invitation and records the reviewer/audit event; the response reports whether email delivery succeeded.
- `GET /api/v1/organizations/onboarding/session` — returns only the application associated with the restricted session; `POST /api/v1/organizations/onboarding/session/close` revokes it. The session uses `X-Organization-Onboarding-Session`, is hash-stored, read-only, two-hour absolute and 30-minute idle.

- `POST /api/v1/organizations/onboarding/claim` — authenticated representative submits the seven-day one-time claim code; successful claim creates the active membership, assigns `organization_owner` and revokes outstanding onboarding sessions.

Migrations: `1794700000000-CreateOrganizationFirstOnboarding` and `1794800000000-CreateOrganizationOnboardingSessions`. Apply after migrations `1794500000000` and `1794600000000`.

Email verification proves mailbox control only; it is not legal due diligence or proof of authority. Evidence upload/review, session recovery, multi-representative authority, requests for information and browser-level full journey testing remain outstanding. The current temporary session is read-only; no arbitrary object references are accepted as evidence.


### Application entitlements and Marketplace representation API — Phase 1 in development

Draft implementation: [PR #25](https://github.com/hlestakovjames/assetpass-backend/pull/25). These routes are not part of the shared integration branch or a production deployment until the PR is reviewed and merged.

- `GET /api/v1/auth/application-entitlements` — return separate App and individual Marketplace entitlement states.
- `POST /api/v1/auth/application-entitlements/marketplace/opt-in` — grant individual Marketplace participation after an explicit acknowledgement.
- `POST /api/v1/auth/application-entitlements/marketplace/revoke` — revoke only individual Marketplace participation; central identity and App access remain unchanged.
- `GET /api/v1/organizations/:organizationId/application-entitlements` — read the organisation's App and Marketplace entitlement state with the dedicated organisation permission.
- `POST /api/v1/organizations/:organizationId/application-entitlements/marketplace/opt-in` and `/revoke` — activate or revoke organisation Marketplace participation. Revocation also revokes current organisation representative grants.
- `POST /api/v1/organizations/:organizationId/marketplace/representatives` and `/representatives/:grantId/revoke` — grant/revoke effective-dated representation for an active member under the dedicated permission.

The additive migration `1795200000000-CreateApplicationEntitlements` creates retained person and organisation application-entitlement grants plus tenant-bound organisation Marketplace representation records. Existing users and organisations receive only the AssetPass App entitlement during backfill; no historical Marketplace consent or representation is fabricated. The permission `organization.marketplace.manage` is granted to the system Organization Owner and Organization Administrator roles.

The backend identity response exposes independent entitlement state and currently valid organisation representation grants. JWT validation also rechecks account approval status, so pending or rejected accounts cannot continue using a previously issued access token. Marketplace login authenticates the central identity but does not itself grant participant entitlement, organisation representation or seller/listing authority.

Representation is not legal ownership, asset management, physical custody or asset-specific listing/sale authority. All mutating browser-facing routes use the existing authenticated session and CSRF protections. Migration apply/rollback/reapply, backend tests and client integration remain pending CI/review. Do not apply this migration to production before the separate release approval.
