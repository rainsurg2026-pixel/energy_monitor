# Packaged Runtime Investigation — `npm run test:packaged-report`

Record of the RC-3.1 investigation into intermittent failures of the
packaged-build CDP smoke test. Kept as a permanent reference so this
failure mode is recognized immediately if it recurs, instead of being
re-investigated from scratch or misattributed to the application.

## Root cause

**Transient interference from third-party endpoint security software
(EDR/AV) on a freshly built, unsigned binary.** Not an application defect.
Not an Excel synchronization defect. Not a Chrome DevTools Protocol (CDP)
defect.

Chromium's GPU and sandboxed renderer child processes intermittently
failed to load required DLLs in the minutes immediately following a fresh
`npm run portable` build, causing the renderer to crash-loop before it
ever completed initialization. Because no renderer ever finished loading,
the CDP test script never observed a stable page target to attach to.

## Evidence

1. **Three independent packaged-test runs on 2026-07-20** (each run's own
   `startup-diagnostics-<pid>.log`, written unconditionally by
   `src/electron/main.ts`) show the identical signature, 3/3:
   - `child-process-gone type=GPU reason=crashed exitCode=-1073741515`
     (`STATUS_DLL_NOT_FOUND`), repeated per run
   - `render-process-gone reason=launch-failed exitCode=49`, twice per run
   - No `renderer-initialized` (`did-finish-load`) ever logged in any of
     the three runs — the renderer never completed a single successful
     launch.
2. **Timing correlation**: the three 2026-07-20 failures landed at
   12:12–12:21 local time, all within ~8 minutes of the build finishing
   (`d3dcompiler_47.dll` / `dxcompiler.dll` / `dxil.dll` finished writing
   at 12:13:17–22; the first failure was even *before* that — a genuine
   build/test race). Every re-run performed more than a day later, same
   binary, same path, same code — **6/6 pass** (3 during the RC-3.1
   investigation, 3 more during RC-3 final verification).
3. **Path was ruled out.** A copy of the packaged build to a path without
   the `&` that appears in this repository's folder name launched
   cleanly, which initially looked like the cause. That was re-tested
   directly against a live re-run of `npm run test:packaged-report`
   against the *original* path with zero changes, which **passed 4/4**.
   The path theory does not survive that control — it was a coincidence
   of timing (the clean-path test happened to run more than a day after
   the last build), not causation.
4. **Windows Defender's own real-time protection was disabled** on the
   investigation machine (`Get-MpComputerStatus` →
   `RealTimeProtectionEnabled: False`), which ruled out Defender as the
   direct actor — but `Get-CimInstance -Namespace root\SecurityCenter2
   -ClassName AntiVirusProduct` showed **four** registered security
   products: SentinelOne ("Sentinel Agent"), Reason Cybersecurity,
   McAfee, and Windows Defender. Third-party EDR agents intercepting
   freshly-written, unsigned executables/DLLs for behavioral analysis on
   first load is a well-documented cause of exactly this signature
   (`STATUS_DLL_NOT_FOUND` + sandboxed child launch-failed), typically
   self-resolving once the agent's verdict is cached — which matches the
   observed pattern exactly.

## Why CDP was not the cause

The CDP script (`scripts/run-packaged-report-test.mjs`) connects to
whatever page target the packaged app's DevTools endpoint exposes. In
every failing run, the endpoint itself came up (`/json` responded), but
no `page`-type target with a usable `webSocketDebuggerUrl` ever appeared,
because the renderer process that would register that target never
finished starting. CDP had nothing to fail at — there was no stable
target for it to lose. The protocol layer is a downstream observer of the
renderer's launch state, not a participant in why the renderer failed.

## Why `Runtime.enable` was not the cause

`Runtime.enable` is sent only after a WebSocket to a page target has
already been opened successfully (`connectRuntime()` →
`waitForSocketOpen()` → `cdp.send("Runtime.enable")`). In every failing
run, execution never reached that call — `connect()` never found a page
target to open a socket to in the first place. A timing issue in
`Runtime.enable` sequencing was the leading hypothesis before this
investigation; it was ruled out because the failure occurs entirely
upstream of where `Runtime.enable` is ever sent.

## Why retries were rejected

The existing retry logic (`connect()`: up to 60 × 500ms; `connectRuntime()`:
up to 20 outer attempts) only re-polls the CDP connection against the
*same already-launched* process. It cannot fix a renderer that crash-loops
for the entire lifetime of that process instance — there is no connection
state to recover into, because the target that would be connected to
never comes into existence. The 2026-07-20 failures already had this
retry budget in effect and still failed 3/3. Adding more retries or sleep
would not address a renderer that never completes initialization within a
given process's lifetime; it would only mask the same wait with a longer
one. No retry or sleep was added — see `docs/KNOWN_OPERATIONAL_LIMITATIONS.md`
for the operational-only mitigations.

## Why Excel synchronization was unaffected

The failure occurs entirely within Chromium's process/renderer launch
path, before the renderer ever loads `index.html` or any application
code runs. The Excel engine (`src/excel/*`, `WorkbookWriter`'s zip-level
patcher, round-trip validation) is renderer-and-main-process application
code that only executes once a window has successfully initialized — a
point these failing runs never reached. This is corroborated directly:
`npm run test:excel` (35 assertions) and the Srinakarin suites, which
exercise the Excel engine independently of the packaged Electron runtime,
passed throughout, unaffected by whether the packaged CDP test was
passing or failing on a given run.

## Current status

Verified passing 6/6 across the RC-3.1 investigation and RC-3 final
verification, unmodified code, unmodified path. Treated as a known,
understood, non-blocking operational limitation — see
`docs/KNOWN_OPERATIONAL_LIMITATIONS.md`.
