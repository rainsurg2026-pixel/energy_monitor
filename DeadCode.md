# Dead / Deprecated Code Log

Tracks code that was written, then abandoned or superseded, without being
deleted outright. Each entry records why it was set aside, what replaced it,
how to get it back, and when it's safe to remove for good.

---

## 1. Duplicate "Reports & Export workspace" rewrite (`src/reporting/Report{Builder,Workspace,Preview,Output,History,HistoryList}.tsx`, `ReportTypes.ts`)

**Status:** Stashed (never committed), 2026-08-09.

**What it was:** A second implementation of the desktop Reports & Export
workspace described by `docs/superpowers/plans/2026-08-02-reporting-center-implementation.md`
(v2.2.7 plan) — a `ReportWorkspace.tsx` entry point importing separate
`ReportBuilder`/`ReportPreview`/`ReportOutput`/`ReportHistoryList`
components, plus its own `ReportTypes.ts` and `ReportHistory.ts`.

**Reason abandoned:** The same feature already shipped, under a different
internal structure, as the committed `src/reporting/ReportingCenter.tsx`
(single consolidated component, imported at `src/App.tsx:26` with a comment
marking it "the only report entry point"; bug-fixed as recently as v2.3.1's
"fix report builder section filtering"). This second pass was left
unwired — nothing imports `ReportWorkspace.tsx` — and referenced APIs that
were never built this way (`useReportController`, `ReportControllerApi`,
`ExportResult`, `getAllSections`, `listMonthsDescending`, `formatMonthLabel`),
producing 16 TypeScript errors. `RELEASE_MANIFEST_V2.2.7.md` and
`RELEASE_NOTES_V2.2.7.md` were draft release docs for this same abandoned
pass (v2.2.7 was never tagged — the repo went straight from v2.2.6 to
later versions).

**Replacement:** `src/reporting/ReportingCenter.tsx` and its committed
siblings (`ReportController.ts`, `reportingTypes.ts`, `ReportRegistry.ts`,
`HistoryProvider.ts`, `ExportProvider.ts`, `PreviewProvider.ts`,
`ReportingMonthContext.tsx`) — already shipped, already in production.

**Recovery path:** `git stash list` → `stash@{0}`. Inspect with
`git stash show -u -p stash@{0}`. Restore with `git stash apply stash@{0}`
(keeps the stash) or `git stash pop stash@{0}` (removes it after applying).
Recovering it does not make it work — the missing `ReportController`
exports it depends on (`useReportController`, `ReportControllerApi`,
`ExportResult`) would still need to be built, or the files rewritten
against the actual `ReportController` class API.

**Planned removal:** Drop the stash (`git stash drop stash@{0}`) once a
human confirms the committed `ReportingCenter.tsx` covers the intended
scope and this second pass isn't wanted. Not dropped automatically — this
log exists specifically so that decision stays a human one.

---

## 2. Pre-existing unrelated stash (not created by this work, left untouched)

**Status:** Stashed, predates this session.

`stash@{1}: On main: RC7/RC8 WIP (set aside for RC2)` was already present
in this repository before this audit/remediation pass began. It was not
created, inspected, or modified as part of this work — noted here only so
`git stash list` output isn't mistaken for something new. Its owner should
triage it separately.

---

## 3. Untracked, unrelated in-progress feature: rack-capacity Excel image embedding

**Status:** Left in the working tree, uncommitted, not stashed — this is
someone's genuine in-progress work, not abandoned, just out of scope for
the web migration.

**Files:** `src/excel/SheetImageWriter.ts`, `scripts/test-rack-capacity-image-embed.ts`,
`scripts/test-rack-capacity-image-migration.ts`,
`scripts/test-rack-unit-capacity-image-history.ts`.

**Why flagged here:** These test scripts reference writer-side functions
that don't exist yet — `ensureRackUnitCapacityImageHistorySheet`,
`upsertRackUnitCapacityImageHistoryRow` (expected on
`src/excel/RackUnitCapacityImageHistoryWriter.ts`), a 3-argument
`applyRackCapacityFieldChanges`/`saveRackCapacityFieldChanges` (both only
take 2 today), an `imageEmbedded` field on `RackCapacityWriteResult`, and
`migrateRackCapacityImageToUnitCapacity` on `RackCapacityWriter.ts`. None
of these exist in the current writer modules — this is real unfinished
feature work (9 tsc errors), not a naming mismatch, and not something to
guess an implementation for.

**Recovery/removal:** N/A — not stashed, not abandoned. Needs its own
scoped session to finish the writer-side implementation, or an explicit
decision to shelve it (at which point it should move into an entry above).
