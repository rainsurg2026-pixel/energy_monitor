# Standard Development and Release Workflow

1. **Understand Outcome**: Focus on the requested objective. Do not re-solve closed issues.
2. **Trace Execution**: Trace real execution path before modifying code.
3. **Root Cause**: Identify and prove the root cause.
4. **Implement Fix**: Smallest correct production-quality fix.
5. **Autonomous Resolution**: Fix blocking issues autonomously.
6. **Scope**: No unrelated refactoring, cleanup, or feature work.
7. **Regression Coverage**: Add focused regression tests for confirmed bugs.
8. **Regression Testing**: Run relevant regression tests.
9. **Lint/Typecheck**: Run lint and typecheck.
10. **Production Build**: Run production build.
11. **Functional Verification**: Verify the actual affected workflow, not just build success.
12. **Version Management**: Update and verify version across:
    - `package.json`
    - Build configuration
    - Artifact naming
    - Application/About version
    - Executable metadata
    - Release documentation
13. **Stale References**: Search for and update stale references to previous versions. Do not modify historical records.
14. **Artifact Format**: Build Windows Portable EXE. Do not convert to installer unless requested.
15. **Packaged Verification**: Launch and verify the packaged EXE.
16. **Distribution**: Create distribution ZIP package.
17. **Consistency**: Ensure artifacts use the requested version number.
18. **Checksums**: Generate and report SHA-256 for release artifacts.
19. **Exclusions**: Exclude `.claude/`, `logs/`, `backups/`, temporary files, `win-unpacked/`, debug artifacts, and development-only artifacts.
20. **Commit**: Commit only intended release changes after validation.
21. **Git Restrictions**: Respect repository Git restrictions. No unauthorized tags, pushes, or history rewrites.