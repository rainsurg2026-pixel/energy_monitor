# Security Boundary

## Relationship to existing documents

`docs/standards/SECURITY_STANDARD.md` (binding - "every rule below is
written against a real incident") already fully owns: Dealer isolation
(RLS + application-layer scope, both mandatory), Role-based access
control (4 roles, predicates only via `lib/scope.ts`), Application-layer
authorization (the explicit statement that "every role-based permission
boundary in this codebase is an application-layer control, not an RLS
control" - there is no Supabase Auth, one shared `anon` key regardless of
role), Server-side authorization, Input validation, Upload validation,
Attachment access, Google Drive integration, and Audit logging.

**This document does not restate any of the above.** It adds three
things `SECURITY_STANDARD.md` does not cover: a PII classification
taxonomy (no prior document has one), a security boundary diagram (that
document is rules, not a boundary map), and an Import-specific security
note (Import Platform is new since `SECURITY_STANDARD.md` was written).

## Authentication

Frozen platform layer (`PLATFORM_ARCHITECTURE_STANDARDS.md`'s Foundation Freeze).
Governed by `docs/architecture/AUTHENTICATION_PLATFORM.md` and ADR-014 -
cited, not restated.

## Authorization

Governed by `docs/standards/SECURITY_STANDARD.md`'s RBAC section and
`lib/scope.ts` - cited, not restated. See `DECISION_MATRIX.md` for which
domain owns which authorization decision.

## Dealer Scope

Governed by `SECURITY_STANDARD.md`'s Dealer isolation section and
`docs/architecture/PERMISSION_MATRIX.md`'s `resolveDealerScope()`/
`resolveBranchScope()` mechanism - cited, not restated.

## Audit

Governed by `SECURITY_STANDARD.md`'s Audit Logging section
(`logAuditEvent()`/`logAuditEvents()`/`diffFieldsForAudit()`, who/when
recorded server-side only) - cited, not restated. See
`EVENT_OWNERSHIP.md` for how audit events relate to the platform's two
event catalogs.

## PII (new - no prior classification taxonomy exists)

No document in this repository classifies which fields are PII before
this one. Proposed taxonomy, applied against the entities in
`DATA_OWNERSHIP_MATRIX.md`:

| Class | Definition | Examples in this platform |
|---|---|---|
| **Direct identifier** | Uniquely identifies a natural person on its own | Customer name, phone number |
| **Indirect identifier** | Identifies a person only combined with other data | Machine serial + owner (Customer), GPS location on a Quality Case |
| **Sensitive-adjacent** | Not classic PII, but sensitive in context | Photos/video attached to a Quality Case (may incidentally capture a person or license plate) |
| **Not PII** | Business/technical data with no natural-person link | Machine model, dealer code, PM interval definitions |

Rules:

1. Direct/indirect identifiers are never logged in plaintext outside the
   record they belong to (e.g. never embedded in a URL query string,
   never written to a generic application log alongside unrelated
   requests).
2. Direct/indirect identifiers are never sent to an AI prompt beyond what
   the specific recommendation needs (`AI_GOVERNANCE.md`'s Prompt
   Standards).
3. Customer has no documented retention/deletion rule anywhere today
   (flagged in `DATA_OWNERSHIP_MATRIX.md`'s Gap Analysis too) - a real
   open item, not resolved by naming the taxonomy.
4. Attachments (photos/video) already go through `AttachmentService`'s
   access-control boundary (frozen Storage Platform) - this taxonomy adds
   the classification, not a new access mechanism.

## Email

Outbound-only (Resend, `src/lib/email.ts`) - governed by
`docs/architecture/AUTHENTICATION_PLATFORM.md` (auth emails) and this
document's PII rule (an email body carries only the PII the specific
notification needs - e.g. a password reset email needs the recipient's
own email address, not their full profile).

## Import

New since `SECURITY_STANDARD.md` was last written - the Import Platform
(ADR-024 Universal Import Framework, renumbered from ADR-009 - see
`docs/adr/README.md`; ADR-022 Import Platform v2, proposed) introduces a
security-relevant surface `SECURITY_STANDARD.md`
predates: a bulk-write path from an uploaded file. Governance rule,
consistent with existing SECURITY_STANDARD.md principles applied to this
new surface: **an import's server-side re-validation (dealer/branch
resolution, duplicate detection, business-rule checks) is never
optional, regardless of what a client-supplied preview claimed** -
exactly the same "re-resolve dealer/branch/technician IDs server-side
rather than trusting client-sent values" rule `SECURITY_STANDARD.md`
already states for `createRecord()`/`updateRecord()`, extended here
explicitly to `NtrImportService.commit()`'s equivalent re-validation
step (already implemented that way - this is a governance confirmation,
not a new requirement).

## Secrets

Governed by `REPOSITORY_POLICY.md` §2 and `.claude/rules/
03-data-access-security.md` - cited, not restated.

## Security Boundary Diagram (new)

```
                    ┌─────────────────────────┐
                    │   External Systems       │
                    │ (ERP, Power BI, Dealer    │
                    │  Portal, future IoT)       │
                    └────────────┬──────────────┘
                                 │  never direct DB access (19, frozen)
                                 ▼
                    ┌─────────────────────────┐
                    │   Integration Layer        │  (INTEGRATION_BOUNDARY.md)
                    └────────────┬──────────────┘
                                 ▼
┌─────────────┐    ┌─────────────────────────┐    ┌──────────────┐
│  Browser /   │───▶│  API Routes               │───▶│  Business     │
│  UI          │    │  (getSession() → 401 if    │    │  Module       │
│              │    │   null; role+scope re      │    │  Service /    │
│              │    │   -check before mutation)   │    │  Repository   │
└─────────────┘    └─────────────────────────┘    └──────┬───────┘
                                                            │  never a raw
                                                            │  SDK call
                                                            ▼
                                                   ┌──────────────┐
                                                   │  Supabase      │
                                                   │  Postgres      │
                                                   │  (RLS on every  │
                                                   │   table)        │
                                                   └──────────────┘
```

This diagram makes explicit what `SECURITY_STANDARD.md` already states
in prose: **two independent layers between any caller and any table** -
RLS at the database, application-layer scope checks in the API route -
neither alone is sufficient, and an external system never skips both by
reading the database directly.

## Gap Analysis

- PII classification taxonomy above is new and untested against a real
  data-retention policy - no retention/deletion timeline exists for
  Customer or any other entity today.
- No automated secret-scanning exists (see `REPOSITORY_POLICY.md` §2) -
  more material given the repository's confirmed-public visibility.
- Import security note above describes existing behavior, confirmed
  correct - not a new control, a governance-layer confirmation.
