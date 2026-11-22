# Organisation-First Onboarding — Backend Implementation

**Status:** Initial account-free onboarding slice in `development/architecture-alignment`.  
**Migrations:** `1794700000000-CreateOrganizationFirstOnboarding`, `1794800000000-CreateOrganizationOnboardingSessions`.  
**Production:** Not deployed by this change. Review and apply migrations only under the separately authorised release procedure.

## Implemented lifecycle

1. A representative submits an organisation application without creating an AssetPass account.
2. The application records organisation details, representative identity/contact, authority declaration, privacy acknowledgement and a hashed single-use verification token.
3. The representative verifies mailbox control using the 24-hour token.
4. Verification creates an organisation with `created_by_user_id = NULL` and `pending_review` status, and issues a separate application-bound read-only onboarding session.
5. Platform review approves, rejects or suspends the organisation.
6. Approval issues a separate seven-day one-time claim invitation to the representative email.
7. The representative authenticates with an active account whose email matches the representative address and submits the invitation code.
8. Claim creates the initial active organisation membership, assigns `organization_owner`, records audit history and revokes remaining onboarding sessions.

Email verification proves control of the representative mailbox only. It does not prove legal identity, registration or representative authority.

## Session boundary

The onboarding session is a random bearer token whose SHA-256 hash is stored. The raw token is returned once, is sent in the `X-Organization-Onboarding-Session` header, and is never put in a URL. It is application-bound, read-only, has a two-hour absolute expiry and a 30-minute idle expiry. Explicit close, successful claim, platform rejection and organisation suspension revoke it.

The session returns only the representative-facing application status. It does not provide ordinary authentication, organisation administration, evidence upload or platform access.

## Migration order

Apply after the already established migrations `1794500000000-CreateIndividualWorkspaceActivation` and `1794600000000-CreateSessionWorkspaceContext`:

1. `1794700000000-CreateOrganizationFirstOnboarding`
2. `1794800000000-CreateOrganizationOnboardingSessions`

Do not combine this sequence with the parked evidence-storage PR #16 unchanged: that PR also used timestamp `1794500000000` and is being reconciled separately against the provider-neutral evidence-storage design.

## Rollback behavior and data safety

Migration `1794700000000-CreateOrganizationFirstOnboarding` makes `organizations.created_by_user_id` nullable because organisation-first records are created before a personal account is linked.

Its rollback is deliberately guarded:

1. It first counts organisations whose `created_by_user_id` is NULL.
2. If any exist, rollback aborts with a clear error. It does not drop the onboarding application table or discard the records' onboarding provenance.
3. If no such organisations exist, it drops `organization_onboarding_applications` and restores `created_by_user_id` to `NOT NULL`.

The preceding onboarding-session migration must be reverted first. The migration CI job applies the full sequence, reverts `179480`, then reverts `179470`, reapplies both migrations and confirms the final migration state.

A failed guarded rollback requires an explicit data-retention/reconciliation plan. Do not delete or fabricate creator identities merely to make a migration rollback succeed.

## Outstanding scope

Evidence upload/review, RFI responses, editable application amendments, session recovery, multiple-representative authority and a complete browser-driven submit → verify → review → claim journey remain outside this implementation slice. The evidence-storage architecture is provider-neutral; object storage is separate from the Neon PostgreSQL production relational database.
