# Known Operational Limitations

Environment-level limitations of the packaged application that are not
application defects. Each entry states what it is, when it happens, and
how to recover, so it is recognized quickly instead of being
re-investigated or misattributed to the app, Excel synchronization, or
CDP tooling.

---

## Transient packaged renderer launch failure after fresh build

**This is an operational environment issue. It is not an application
defect.**

### Symptoms

- `render-process-gone` (`reason: launch-failed`, `exitCode: 49`)
- `child-process-gone` (GPU, `reason: crashed`, `STATUS_DLL_NOT_FOUND` /
  `exitCode: -1073741515`)
- No `renderer-initialized` event ever logged for the affected process
- The packaged CDP smoke test (`npm run test:packaged-report`) never
  finds a stable page target to attach to

### Conditions observed

- Occurs only in a short window immediately after a fresh
  `npm run portable` build (observed within ~8 minutes of build
  completion; not observed once more time had passed with no rebuild)
- The packaged executable and its DLLs are unsigned
- Endpoint security software is actively scanning/analyzing newly-written
  binaries on first execution

### Observed security products on the investigation machine

- SentinelOne ("Sentinel Agent")
- McAfee
- Reason Cybersecurity
- Windows Defender

(Windows Defender's own real-time protection was disabled on the
investigation machine at the time; the other three were active. Any
subset of aggressive EDR/AV products can trigger the same behavior.)

### Recovery

- Wait for endpoint protection to finish analyzing the freshly-built
  binary, then re-run — the condition has been observed to clear within
  minutes to about a day, and does not require any code or config change.
- Or: whitelist/exclude the build output directory (`release/win-unpacked`
  and the built `Energy Monitor.exe`) in the relevant EDR/AV management
  console. This requires access to that product's admin console — it is
  not a local machine setting and not something this repository's tooling
  can apply on its own.

### Why this is not a code fix

The renderer never reaches any application code (it fails before
`index.html` loads), so there is nothing in `src/` to change. The
existing CDP retry budget (`scripts/run-packaged-report-test.mjs`) was
already active during the observed failures and did not mask them,
because retrying a connection to an already-crash-looping process cannot
produce a target that never comes into existence. See
`docs/desktop/PACKAGED_RUNTIME_INVESTIGATION.md` for the full evidence
trail and why CDP, `Runtime.enable`, and Excel synchronization were each
ruled out as the cause.
