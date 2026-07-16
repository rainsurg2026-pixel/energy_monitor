# Release Checklist — Storage Platform v2.1

Companion to `RELEASE_NOTES_v2.1.md`. This checklist covers the release
of the Storage Platform's frozen baseline itself (docs, tooling, CI) -
not a production rollout of Cloudflare R2 or any behavior change, since
none is part of this release (see Production Prerequisites in the
release notes for that separate, future decision).

## Pre-release

- [x] `npm run architecture` - 5/5 rules PASS, CI-integration check PASS.
- [x] `npm run lint` - 0 errors (7 pre-existing unrelated warnings).
- [x] `npm run typecheck` - clean.
- [x] `npm test` - 308/308 passing.
- [x] `npm run build` - succeeds.
- [x] `docs/engineering/STORAGE_PLATFORM_FINAL.md`,
      `STORAGE_PLATFORM_DECISION.md`,
      `docs/releases/STORAGE_PLATFORM_RELEASE.md`,
      `docs/architecture/PLATFORM_ARCHITECTURE_STANDARDS.md`,
      `docs/engineering/ARCHITECTURE_ENFORCEMENT.md`,
      `CHANGELOG_STORAGE_PLATFORM.md`, `RELEASE_NOTES_v2.1.md`,
      this checklist (`docs/releases/RELEASE_CHECKLIST_STORAGE_PLATFORM_V2.1.md`,
      renamed from root `RELEASE_CHECKLIST.md`) all published.
- [x] `PROJECT_STATE.md` - Storage Platform section marked COMPLETE.
- [x] `.github/workflows/ci.yml` runs `npm run architecture` before
      typecheck/lint/test/build.
- [ ] Working tree reviewed and explicitly approved for commit (nothing
      in this release has been committed yet - see "What this release
      does NOT do" below).

## Deployment

This release is **documentation, tooling, and CI configuration only** -
no application code, schema, or environment configuration changes ship
with it. "Deployment" here means merging to `main` and letting Vercel's
existing auto-deploy pick up the (behaviorally identical) build:

- [ ] Explicit approval to commit the changed/new files listed in this
      release.
- [ ] Explicit approval to open a PR from
      `feature/pm-record-workflow-redesign` (or a dedicated release
      branch, if preferred) into `main`.
- [ ] CI passes on that PR (this is the first PR that will exercise the
      new `Verify architecture` step for real, in GitHub Actions' Node 20
      environment - confirm it passes there, not just locally).
- [ ] Explicit approval to merge.
- [ ] Confirm Vercel's Production deployment completes
      ("Deployed (completed)"/"Active" on the GitHub Deployments tab).

## Post-deployment

- [ ] Confirm the live site behaves identically to before this release
      (expected - no business logic changed) by spot-checking one MQR and
      one PM attachment upload/view/delete in production.
- [ ] Confirm GitHub Actions shows the new `Verify architecture` step
      running and passing on `main`.
- [ ] Confirm no `STORAGE_PROVIDER`/`ARCHIVE_PROVIDER` env var was
      accidentally set in any environment (this release does not set
      either - primary should still be Supabase, archive still Google
      Drive, everywhere).

## Rollback

Since this release changes no runtime behavior, rollback is low-risk:

- [ ] If CI's new `Verify architecture` step ever produces a false
      positive blocking an unrelated PR, the immediate mitigation is to
      revert the one-line addition to `.github/workflows/ci.yml`
      (removing the `Verify architecture` step) - not to weaken or bypass
      the rules in `scripts/architecture-check.ts` itself under time
      pressure.
- [ ] If a future change to `scripts/architecture-check.ts` needs
      reverting, it's a single, isolated file with no runtime
      dependents - reverting it cannot affect the running application.
- [ ] No database migration ships with this release, so there is nothing
      to roll back at the schema level.
- [ ] Standard Vercel rollback (redeploy the previous production
      deployment) applies if anything is ever found wrong post-merge -
      not expected to be needed, given no behavior change.

## Operational verification

- [ ] Run `npm run architecture` locally before every future PR that
      touches `src/shared/attachments/` or any business module's
      attachment-related imports - it's fast (a plain file scan, no
      network calls) and now also runs automatically in CI.
- [ ] When CI's `Verify architecture` step fails on a future PR, treat it
      exactly like a failed test or type error - a real defect to fix
      before merging, not something to skip past (`.github/workflows/ci.yml`
      never used `continue-on-error`/`--no-verify`-style bypasses for any
      existing step, and this new step follows the same standard).
- [ ] Re-run the R2 CORS live check (documented in
      `docs/engineering/R2_PRODUCTION_READINESS.md`) before ever setting
      `STORAGE_PROVIDER=CLOUDFLARE_R2` in a real environment - that
      blocker's status is independent of this release and could change
      without this repository knowing.

## What this release does NOT do

- Does not modify any business module or application runtime behavior.
- Does not change the active storage provider in any environment.
- Does not create a git tag, GitHub release, or push anything to the
  remote - see this repository's own `.claude/rules/git.md` ("never
  create tags," "never create releases," approval required per change).
  The tag/title/branch below are **recommendations only**.
- Does not deploy to production - Vercel's existing auto-deploy-on-merge
  is the only deployment mechanism, and no merge is performed by this
  checklist itself.
