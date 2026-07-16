# Service Construction Standard

Binding rule for every Repository and Service in this platform (see
`docs/standards/MODULE_DEVELOPMENT_STANDARD.md`'s layered structure for
what a Repository/Service *is* and where it lives - this document does
not re-derive that, only the one rule governing how they are
*constructed*). Enforced by Architecture Check Rule 6
(`scripts/architecture-check.ts`, `docs/engineering/
ARCHITECTURE_ENFORCEMENT.md`).

## The rule

**A Repository or Service constructor must be side-effect free.**
Constructing one must never, by itself:

- access Supabase (or any database)
- access external APIs
- access storage
- access environment-dependent runtime configuration (`process.env`,
  request context, feature flags)
- perform network I/O of any kind

Constructing a class only sets up the object - it must never *do*
anything until one of its methods is actually called.

**Repositories that need a runtime-configured client (a Supabase
client, an HTTP client, anything read from `process.env`) must obtain it
lazily** - resolved the first time it's actually needed, not the moment
the object is created.

**Next.js Pages, Server Components, Route Handlers, and Server Actions
should construct Services inside request scope** (inside the async
function body), not as a module-level `const`, wherever that's the more
natural shape for the route. This is the safer default, but it is not
itself what Architecture Check enforces (see "Why this is a constructor
rule, not a call-site rule," below) - a correctly-lazy Service is equally
safe constructed either way.

## Why this is a constructor rule, not a call-site rule

The literal, tempting rule to write is "never construct a Service at
module scope." That rule is wrong for this codebase: nearly every
existing page and API route already does exactly that -
`const service = new XxxService();` at the top of the file - and it is
completely safe, because `XxxService`'s own Repository resolves its
client lazily. Flagging that pattern everywhere would not point at a
real defect; it would just relearn that most of this app already does
the right thing.

The real defect is narrower and more precise: **a Repository whose
constructor (or class field initializer) does the runtime-dependent work
eagerly.** That is unsafe regardless of where the class is constructed -
including inside a request handler - because the moment `new
XxxRepository()` runs, the eager call already fired. It is *especially*
dangerous at module scope, because Next.js imports every page/route
module during its build-time page-data-collection step, long before any
request exists - so an eager constructor throws at build time, not at
request time, in an environment that may not have the runtime
configuration (env vars, secrets) available yet.

Fixing the constructor fixes every call site at once, present and
future, everywhere that class is ever constructed - fixing only the one
call site that happened to trip over it fixes nothing structurally.

## Good examples

Lazy client, resolved on first access (the required pattern):

```ts
export class KnowledgeRepository {
  /** Lazy, not a field initializer - getSupabase() throws if env vars
   *  aren't set, and a field initializer would run at construction
   *  time, before a test ever gets a chance to mock it. */
  private get client() {
    return getSupabase();
  }

  async list(): Promise<KnowledgeCase[]> {
    const { data, error } = await this.client.from('knowledge_cases').select('*');
    // ...
  }
}
```

Constructing a Service at module scope is fine, precisely because its
Repository is lazy:

```ts
// src/app/(app)/quality/knowledge/page.tsx
const service = new KnowledgeService(); // safe - KnowledgeRepository is lazy
```

Constructing inside the request handler is also fine, and is the
better default for a Service whose Repository is not (yet) known to be
lazy, or when following an existing per-request factory convention:

```ts
// src/app/(app)/ntr/[id]/page.tsx
export default async function NtrDetailPage({ params }) {
  const session = await getSession();
  const record = await createNtrService().getById(params.id, session); // constructed per-request
}
```

## Bad examples

Eager field initializer - the actual defect class this Standard exists
to prevent (this exact shape broke a production build, PR #45):

```ts
export class SupabaseNtrRepository {
  // WRONG - runs the instant `new SupabaseNtrRepository()` executes,
  // including during Next.js's build-time page-data collection.
  private readonly client = getSupabase();
}
```

Constructing that Service at module scope in a page turns the eager
constructor into a build-time failure:

```ts
// WRONG - createNtrService() constructs SupabaseNtrRepository immediately,
// the moment this page module is imported.
const ntrService = createNtrService();

export default async function DeliveryDetailPage({ params }) {
  // ...
}
```

Any other eager runtime-dependent call in a constructor is the same
defect, regardless of technology:

```ts
export class SomeRepository {
  private readonly bucket = getStorageBucket();      // WRONG - storage access
  private readonly apiKey = process.env.API_KEY!;    // WRONG - env access
  private readonly cache = connectRedis();           // WRONG - network I/O
}
```

## Migration guidance

If you find a Repository with an eager field initializer:

1. Convert the field to a `private get client()` accessor returning the
   same expression - callers that already write `this.client` need no
   other change.
2. Confirm no test relied on the client being constructed eagerly (rare
   - most tests already mock the whole Repository, not its internal
   client).
3. Remove the file from Architecture Check Rule 6's
   `EAGER_CONSTRUCTION_ALLOWLIST` (`scripts/architecture-check.ts`) once
   fixed - the allowlist's per-file count only ever shrinks.

A small number of pre-existing Repositories are currently grandfathered
in that allowlist (see `docs/engineering/ARCHITECTURE_ENFORCEMENT.md`'s
Rule 6 section for the exact list and reasoning) - this is temporary
technical debt, not a permanent exception. **Whoever next makes a
functional (non-documentation) change to one of those files must migrate
it to the lazy pattern first, as part of that change.**

## Reference

- `docs/architecture/PLATFORM_ARCHITECTURE_STANDARDS.md` - the platform
  layers this rule applies within (Repository/Service boundary).
- `docs/standards/MODULE_DEVELOPMENT_STANDARD.md` - where Repositories/
  Services live in a module's folder structure.
- `docs/engineering/ARCHITECTURE_ENFORCEMENT.md` - Rule 6, the automated
  check, and the current grandfathered allowlist.
