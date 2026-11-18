# AssetPass Backend

**Repository:** `hlestakovjames/assetpass-backend`  
**Application responsibility:** Shared AssetPass API, domain services, identity, authorization, persistence and integration foundation.  
**Implementation status:** Early backend foundation; implemented modules and planned domains are distinguished below.

## Architecture position

The backend is the authoritative service boundary for AssetPass. It currently follows a NestJS modular application with TypeORM and PostgreSQL. The target direction is a domain-oriented modular monolith with clear domain ownership and selective future service extraction where justified.

Do not treat every documented domain as an existing module or introduce microservices simply to mirror the domain catalogue. Do not replace TypeORM with another ORM without a separately reviewed decision and migration plan.

## Current implemented source areas

- `identity`: user identity, profile and consent persistence.
- `auth`: registration, login, email verification, access tokens, refresh-token sessions, JWT strategy, CSRF/browser-origin protections and email delivery.
- `platform-governance`: current platform-role and governance/succession foundation.
- `access-control`: platform and organisation role/permission persistence and platform permission guard.
- `organizations`: organisation records, memberships, registration/review and member management foundation.
- `assets`: asset parties, registration applications/evidence/records, ownership foundation and asset registration APIs.
- `audit`: platform audit records.
- `health`: health endpoint.
- `workspaces`: explicit Individual Workspace activation/deactivation lifecycle, persisted state, audit events and server-side active-workspace guard.
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

At minimum, configure a local `DATABASE_URL`, a unique `JWT_ACCESS_SECRET`, the API origin and an email provider configuration appropriate to your environment. Never commit real credentials or production secrets.

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

### Individual Workspace lifecycle API

- `POST /api/v1/workspaces/individual/activate` — activate or reactivate the authenticated user's Individual Workspace.
- `POST /api/v1/workspaces/individual/deactivate` — deactivate the authenticated user's Individual Workspace without deleting its workspace record.

Both operations require an authenticated session. The actor is derived from the validated JWT; the API does not accept a client-supplied user ID. Each transition is committed with an audit event. `GET /api/v1/auth/me` and the login identity response include only activated Individual Workspaces in `availableWorkspaces`; `defaultWorkspace` may now be `null`.

## Validation

```bash
npm run build
npm test -- --runInBand
npm run test:e2e
```

The GitHub Actions workflow validates the backend build, unit tests, the complete end-to-end suite, and all TypeORM migrations against disposable PostgreSQL 16 services (including latest-migration rollback and reapply). Run lint separately when changing code; review the current lint script before using it because it applies automatic fixes.

## Workspace lifecycle implementation note

See [Individual Workspace Lifecycle](docs/individual-workspace-lifecycle.md) for the persistence model, endpoints, audit behavior and migration-before-deployment requirement.

## Critical implementation invariants

- Resolve identity, active context, tenant and permissions on the server.
- Do not infer authority from a client-supplied role, workspace ID or navigation state.
- Preserve platform, organisation and individual authorization boundaries.
- Organisation-first onboarding must use a constrained, attributable, time-bounded onboarding principal; do not create anonymous sensitive administration.
- Account creation must remain separate from Individual Workspace activation. Existing accounts are backfilled as active by the new migration to preserve their current access; accounts registered after the migration are not automatically given an Individual Workspace.
- Asset identity, ownership, management authority, custody, assignment and location are distinct.
- Preserve recipient acknowledgement and atomic completion of custody-changing asset transfers.
- Marketplace commands must not directly mutate authoritative asset ownership/custody tables.
- Keep audit evidence for consequential state changes.
- Keep `synchronize: false`; use migrations only.

## Next alignment work

1. Complete and validate the additive Individual Workspace activation slice (migration `1794500000000-CreateIndividualWorkspaceActivation`).
2. Organisation-first onboarding and later identity linking.
3. Global Administrator role migration and platform-authority boundaries.
4. Platform-managed asset taxonomy and expanded lifecycle APIs.
5. Marketplace domain, public discovery and transaction boundaries.
6. Shared document, workflow, communication, integration and intelligence/security capabilities.

## Source of truth

The expanded product and technical architecture, requirements, API boundaries, data diagrams, decision register and acceptance criteria are maintained in [assetpass-docs](https://github.com/hlestakovjames/assetpass-docs).
