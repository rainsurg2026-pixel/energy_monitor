# Playbook: deploy without a local git CLI

This repo is sometimes worked from an environment with no local git
binary, no clean clone, and no push credentials available to enter (and
credentials must never be entered on the user's behalf — see
`.claude/rules/03-data-access-security.md`). This is how that situation
gets handled in practice.

## Reading the repo

- Read a file: `https://github.com/<owner>/<repo>/raw/refs/heads/main/<path>`
  (GitHub redirects this to a session-scoped `raw.githubusercontent.com`
  URL automatically — that redirect token is a navigation artifact, not a
  credential being entered).
- List a directory: `https://github.com/<owner>/<repo>/tree/main/<dir>`,
  read via the page-text extraction of the rendered tree.
- Bracket-named dynamic routes need URL-encoding in the path
  (`[jobId]` → `%5BjobId%5D`); parenthesized route groups like `(app)` do
  not need encoding.

## Writing to the repo

- Single new file, simplest case: navigate to
  `https://github.com/<owner>/<repo>/new/main?filename=<path>` and use the
  web editor, or
- Multiple files into one folder: navigate to
  `https://github.com/<owner>/<repo>/upload/main/<path>` ("Add file →
  Upload files") and upload the prepared files — GitHub creates any
  folders in `<path>` that don't exist yet. This is the preferred method
  for anything beyond a one-line edit, since it transfers real file bytes
  rather than requiring text to be typed/pasted into a web code editor.
- Vercel auto-deploys `main` on every push — no separate deploy step.

## Verifying

- After any push that touches a user-facing flow, browse the live app
  (`https://masp-mseal.vercel.app`) and exercise the changed flow
  directly — there is no CI/test gate, so this manual check is the only
  safety net.
- Check Vercel's deployment list for build success before assuming the
  push actually shipped.

## Hard rule

Never type, paste, or otherwise enter a password, API token, or other
credential into any page, command, or field to make this workflow go
faster — including a credential the user explicitly supplied and
authorized. If a step genuinely requires one (e.g. a real `git push` with
auth), stop and ask the user to run that specific step themselves.
