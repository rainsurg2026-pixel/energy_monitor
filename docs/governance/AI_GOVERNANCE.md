# AI Governance

## Relationship to existing documents

`docs/architecture/blueprint/08-ENGINEERING-INTELLIGENCE-ARCHITECTURE.md`
already defines the AI Governance boundary and AI Confidence Policy as
**frozen** - explicitly named as one of 20's 5 Architecture Freeze items
("Engineering Intelligence's AI Governance boundary (08) and AI
Confidence Policy's meaning"). **This document does not redefine either
- it cites 08 as binding and adds only what 08 explicitly leaves open**:
Prompt Standards (08: "out of scope per this PR's brief") and Model
Independence as a named governance principle (08 names `ModelGateway` as
a swappable seam but does not state a governance *rule* requiring
independence).

## AI Scope

Per 08: Engineering Intelligence exists to support **engineering
decisions** - diagnosis, root cause, repair - not general business
intelligence (that is Analytics, 09) and not any automated write path.
Named capabilities (08, quoted list, not designed to implementation
level): Problem Classification, Symptom Extraction, Root Cause Ranking,
Similar Case Retrieval, Troubleshooting Recommendation, Inspection
Recommendation, Repair Recommendation, Required Parts Recommendation,
Repair Time Estimation, Warranty Risk Prediction, Quality Trend
Detection, Dealer Performance Insight, Technician Assistant, Knowledge
Summarization, PIP Recommendation, Predictive Quality Analytics.

## AI Boundaries (frozen, cited verbatim from 08)

> AI **never**: approves warranty · approves repairs · creates a PIP
> automatically · changes records · approves engineering decisions.
>
> AI **only** provides: Evidence · Recommendations · Confidence ·
> Supporting cases · Inspection suggestions · Repair suggestions ·
> Required parts · Estimated repair time · Knowledge references.

**Engineers make all final decisions** - enforced architecturally: every
write path a recommendation could inform goes through the same
human-authored API routes and RBAC checks that already exist; Engineering
Intelligence never gets a privileged write path of its own (08).

## Evidence First

08's own named principle, cited not restated: every recommendation must
carry Confidence, Evidence/Reasoning, Supporting Cases, Repair Success
Rate, Inspection Steps, Required Parts, Source Events, and Knowledge
References - traceable back to real `KnowledgeCase`s and real
`PlatformEvent`s, never synthesized examples. **No black-box
recommendations** - if a recommendation cannot be traced to at least one
real Knowledge Case, the architecture does not allow it to be shown as a
recommendation at all (08).

## Human Approval

Already the architectural default per 08 (AI Boundaries above) - this
document adds one operational rule for when AI-adjacent features
eventually ship: **the PR that introduces any AI-facing write-adjacent
UI must name, in its own description, which existing human-authored API
route/RBAC check the recommendation feeds into** - proving the boundary
holds, not just asserting it. This is a review-time discipline, not a
new code mechanism.

## Knowledge Confidence

08's AI Confidence Policy, cited verbatim (frozen, four bands):

| Confidence | Label | Meaning |
|---|---|---|
| > 95% | Strong Recommendation | Multiple corroborating, Engineer-validated Knowledge Cases |
| 80-95% | Recommendation | Solid match, a suggestion an engineer should seriously weigh |
| 60-80% | Possible Cause | Plausible, one hypothesis among others |
| < 60% | Request More Evidence | Not enough corroborating Knowledge - the UI asks for more input instead of guessing |

"This policy affects recommendation strength and wording only. It never
authorizes an automated decision at any confidence level, including
100%." (08, quoted in full because this is the single most important
sentence in this entire governance area).

## Prompt Standards (new - 08 explicitly leaves this out of scope)

Not yet applicable (no model/vendor/prompt exists today), but recorded
now so the first real prompt-design work starts from a governed baseline
rather than an ad hoc one:

1. **Prompts are version-controlled**, not embedded as a magic string
   inside a service call - same "no hardcoded business terminology"
   discipline `docs/standards/DOMAIN_LANGUAGE_STANDARD.md` already
   requires for user-facing text, applied to prompts.
2. **Prompts never embed PII or a full record** beyond what the specific
   recommendation genuinely needs - matches `SECURITY_BOUNDARY.md`'s PII
   minimization principle.
3. **A prompt change is reviewed like a code change** - it can change
   model behavior as materially as a logic change can, and should go
   through the same review weight.
4. **No prompt is trusted to enforce the AI Boundaries above** - the
   boundary (no auto-approval, no auto-PIP-creation, etc.) is enforced by
   the *architecture* (no privileged write path), never by asking the
   model nicely in the prompt not to do something the code path would
   allow anyway.

## Model Independence (new - operationalizing 08's `ModelGateway` seam)

08 names `ModelGateway` as "a placeholder boundary, deliberately
unspecified... its only architectural job is to be the one swappable seam
if the model/vendor changes later." This document states the governance
principle that seam exists to serve: **no business logic anywhere
outside `ModelGateway`/`EngineeringIntelligenceService` may depend on a
specific model vendor's API shape, prompt format, or response schema.**
`EngineeringIntelligenceService` is the only caller of `ModelGateway`
(08, already established) - this document adds that the *reverse* must
also hold: nothing upstream of `EngineeringIntelligenceService` should
need to change if the model behind `ModelGateway` changes.

## Auditability

Already substantially covered by 08's Evidence-First requirement (every
recommendation traces to real `PlatformEvent`s and `KnowledgeCase`s) and
by the platform's existing audit infrastructure (`record_audit_log`,
`docs/standards/SECURITY_STANDARD.md`'s Audit Logging section). This
document adds one explicit rule: **an AI recommendation's evidence trail
must be reconstructable after the fact** - given a recommendation shown
to an engineer at time T, it must be possible to later retrieve exactly
which Knowledge Cases and source events produced it, even if the
underlying model or its confidence computation changes afterward. This is
a natural consequence of 08's existing design (recommendations reference
real IDs, not opaque scores) - stated here as an explicit governance
requirement so a future implementation doesn't optimize it away.

## Gap Analysis

- Prompt Standards and Model Independence are genuinely new governance
  content (08 leaves both open) - neither has been tested against a real
  implementation, since none exists yet. Revisit once
  `EngineeringIntelligenceService`/`ModelGateway` are actually built.
- No AI capability in the 16-item list above is built today - this
  document, like 08 itself, is governance for when they are, not a status
  report on what exists.
