# Integration Boundary (Governance Layer)

## Relationship to existing documents

`docs/architecture/blueprint/19-INTEGRATION-BOUNDARY.md` (frozen - its
core rule is one of 20's 5 Architecture Freeze items) already covers
**ERP, Power BI, Dealer Portal, Customer Portal, Technician Mobile, and
Future APIs**, with its frozen rule quoted here (not restated as new):

> "No external system should read internal business tables directly.
> Not Postgres credentials shared with an ERP, not a BI tool connected
> straight to `vehicles`/`records`/`knowledge_cases`, not a mobile app
> calling Supabase with its own service key. Every external system reads
> through the Integration Layer, or it doesn't read at all."

**This document does not restate 19 or reopen its frozen rule.** It
exists because the task asks for governance covering **Google Sheets,
IoT, Authentication, Email, and SMS** - none of which 19 mentions at all
- plus a general "future integrations" section. Everything below is new
coverage, governed by 19's same frozen rule applied to five additional
integration types.

## Integrations covered

| Integration | Direction | Governed by | Boundary rule applied |
|---|---|---|---|
| **ERP** | Read (future) | 19 (frozen) | Cited, not restated |
| **Dealer Portal** | Read (future) | 19 (frozen) | Cited, not restated |
| **Power BI** | Read (future) | 19 (frozen) | Cited, not restated |
| **Google Sheets** | Read - **already built**, narrow scope | New coverage (19 doesn't mention it) | `src/lib/tractorSheet.ts` reads one public CSV export endpoint (read-only, no service account) - already respects 19's spirit (no direct DB access) even though 19 predates it. `docs/DATA_SYNCHRONIZATION.md`'s planned Supabase→Sheets *daily reporting* sync is the inverse direction (outbound) and does not exist yet - when built, it must go through the same Integration Layer boundary 19 defines, publishing a read-oriented mirror, never becoming a second source of truth |
| **REST API** | Read/write (existing, internal) | `docs/standards/API_STANDARD.md` (binding) | This platform's own API is not "external" in 19's sense - 19 governs external systems reading *from* this platform, not this platform's own internal API surface (see `API_GOVERNANCE.md`) |
| **IoT** | Not built | New coverage - explicit gap | No IoT/telematics integration exists today, despite `docs/standards/EVENT_CATALOG.md` listing a `TELEMATICS_ALERT` event code (aspirational, unwired). Any future IoT integration is external-system-reads territory (19's rule applies in full) plus likely an external-system-*writes* case 19 doesn't explicitly cover either (see below) |
| **Authentication** | N/A - not an external integration | Frozen platform layer, not covered by 19 (19 is about external systems reading internal data; Authentication is internal infrastructure) | See `DECISION_MATRIX.md` - Authentication is platform-level, frozen |
| **Email** | Outbound only (Resend) | `docs/architecture/AUTHENTICATION_PLATFORM.md` (auth emails), `src/lib/email.ts` (notifications) | Not a "reads internal tables" case - outbound notification, not integration-boundary territory in 19's sense. Governed instead by `SECURITY_BOUNDARY.md` (no PII beyond what the notification needs) and `docs/standards/SECURITY_STANDARD.md` |
| **SMS** | Not built | New coverage - explicit gap | No SMS integration exists. When built: outbound-only, same governance shape as Email above, not a 19-style "external reads internal tables" case |
| **Future integrations** | Varies | New coverage | See rule below |

## The one rule this document adds (external-system-*writes*, not just reads)

19's frozen rule explicitly covers external systems **reading**. It does
not explicitly state a rule for an external system **writing** into this
platform (e.g. a future IoT device pushing telematics data, or a Dealer
Portal submitting a request). Proposed, consistent with 19's spirit and
`PLATFORM_ARCHITECTURE_STANDARDS.md`'s "a business module reaches infrastructure
only through its own repository/service" rule, generalized to the
integration boundary: **an external system never writes to an internal
table directly either - it writes through an API route (or a future
Integration Layer endpoint), which validates, scopes, and audits the
write exactly as an internal caller would.** This is a documentation
-layer proposal, not a Baseline decision - formalizing it as part of 19
would need 20's Breaking Change Process, since 19's content is frozen.

## Future Integrations

`docs/architecture/blueprint/12-FUTURE-INTEGRATIONS-READINESS.md` already
covers the general pattern ("a new producer/consumer of an existing
pattern, never a fourth integration pattern"). This document does not
duplicate it - any new integration type not listed above should be
checked against 12 and 19 before this document is extended.

## Gap Analysis

- IoT/telematics has an event code reserved (`TELEMATICS_ALERT`) but zero
  integration design - a real, named gap, not resolved here.
- SMS has no design at all - not even a reserved event code.
- The external-system-*writes* rule proposed above is new and not yet
  formalized into 19 itself - flagged in `README.md`'s Governance Roadmap.
- Google Sheets' *outbound* direction (`docs/DATA_SYNCHRONIZATION.md`'s
  planned daily reporting sync) remains unbuilt; when built, it should be
  reviewed against both this document and 19, since it is architecturally
  a new pattern (outbound continuous mirror) not obviously covered by
  either document's existing read-in-only framing.
