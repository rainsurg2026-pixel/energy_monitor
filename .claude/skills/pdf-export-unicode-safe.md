# Skill: add/change a PDF export safely

Use whenever touching `exportPdf.tsx` or adding a new `@react-pdf/renderer`
document. This codebase has hit two specific, non-obvious Vercel
production failures here before — both must stay fixed.

## Gotcha 1: fonts must load from disk, not HTTP

Registering a font via an HTTP fetch of the app's own deployed URL fails
in production because Vercel Deployment Protection intercepts the app's
self-fetch and returns the SSO login page instead of font bytes — the PDF
then either renders with the wrong font or throws "Unknown font format."
Fonts must be registered from an on-disk path (`fs.readFileSync`), and
`next.config.mjs`'s `outputFileTracingIncludes` must include the font
directory so it's actually bundled into the serverless function. Use TTF,
not WOFF — `fontkit` (which `@react-pdf/renderer` depends on) cannot parse
WOFF.

## Gotcha 2: image fetches need a timeout and a fallback

Every photo in a PDF is fetched server-side into a base64 data URI before
being handed to `<Image>`. Always wrap this in a timeout (10s) and spoof a
browser User-Agent (some hosts, including Drive's thumbnail endpoint,
behave differently for non-browser UAs). On failure, degrade to a
placeholder — never let one bad photo crash the whole export.

## Gotcha 3: GMT+7 timestamps

Any date printed on a PDF goes through the shared Thai/GMT+7 formatter,
same as everywhere else in the app — do not call a raw date method inside
a PDF component.

## Verify

Generate the export against a record that has at least one photo from
each category and confirm: correct font rendering (Thai characters
included), all photos render or fall back gracefully, and every printed
timestamp matches Bangkok local time.
