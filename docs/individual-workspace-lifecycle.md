# Individual Workspace Lifecycle — Backend Implementation

**Status:** Initial additive implementation in the architecture-alignment development branch.  
**Migration:** `1794500000000-CreateIndividualWorkspaceActivation`

## Scope

This capability records whether the authenticated person has activated an Individual Workspace. It does not create a second person identity or change the authentication credential/session model.

## Persistence

The `individual_workspaces` table has one record per user:

- `id`: workspace lifecycle record identifier.
- `user_id`: owning person account; unique and FK-restricted to `users`.
- `status`: `active` or `inactive`.
- `activated_at`: most recent activation timestamp.
- `deactivated_at`: most recent deactivation timestamp.
- `created_at`, `updated_at`: lifecycle record timestamps.

The migration backfills every pre-existing user as active, preserving the current access behavior. Accounts registered after migration do not receive a workspace row automatically. Activation creates one row; reactivation updates the existing row. Deactivation never deletes it.

## API

All endpoints use the authenticated JWT guard. The actor is always derived from the validated request identity.

| Method | Path | Effect |
|---|---|---|
| POST | `/api/v1/workspaces/individual/activate` | Create or reactivate the caller's workspace |
| POST | `/api/v1/workspaces/individual/deactivate` | Mark the caller's workspace inactive |

No request body or user ID is accepted. This prevents a caller from selecting another user's workspace by changing a request parameter.

Both state changes and their corresponding `platform_audit_logs` records are committed in one database transaction. Repeated calls are safe at the state level.

## Identity resolution

The existing login and `GET /api/v1/auth/me` flows continue to call the identity resolver. The resolver now reads the active workspace state:

- Active individual workspace: include it in `availableWorkspaces`.
- No row or inactive row: omit it.
- No authorised platform, organisation or individual context: return `defaultWorkspace: null`.
- Pending organisation membership remains visible as a relationship but does not grant an organisation workspace.

The authentication routes, password verification, access-token issuance, refresh rotation, cookie settings, CSRF bootstrap and logout operations are not part of this feature's implementation changes.

## Migration and deployment order

1. Back up and verify the target database.
2. Review the migration and its down operation.
3. Apply migration `1794500000000-CreateIndividualWorkspaceActivation`.
4. Verify that every pre-existing user has one active workspace row.
5. Deploy the backend revision that queries `individual_workspaces`.
6. Deploy the app revision that uses nullable `defaultWorkspace` and the activation endpoints.
7. Verify login, refresh, logout, session restoration and account/workspace routing.

**Do not deploy the new identity resolver before the migration.** It queries the new table during login and session identity resolution.

## Server-side workspace enforcement

The following personal asset endpoints now require both a valid authenticated JWT and an active Individual Workspace:

- `POST /api/v1/assets/registrations/individual`
- `GET /api/v1/assets/registrations/mine`

The `IndividualWorkspaceActiveGuard` derives the user ID from the authenticated request and checks the persisted active workspace record. A client cannot bypass the check by changing a route, hiding navigation or submitting another user ID. Organisation asset endpoints remain governed by their separate organisation membership/permission checks.

## Known limitations and next design gates

- This is an activation flag/lifecycle record, not yet a fully provisioned personal workspace aggregate.
- Deactivation dependency checks are not yet implemented. Before personal assets, documents, obligations, delegated relationships and workflows become active domains, define rules preventing deactivation from stranding records or silently cancelling obligations.
- Workspace preferences, entitlements, capability configuration, data export and deletion are separate concerns.
- The UI guard is not an authorization boundary. An API guard now enforces active workspace state for the existing personal asset-registration and personal-registration-list endpoints. Every future workspace API must apply the same server-side state and resource-permission checks.
- Migration execution against a disposable PostgreSQL database and full end-to-end regression testing remain required.
