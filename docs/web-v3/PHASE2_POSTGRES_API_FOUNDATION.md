# Phase 2 PostgreSQL/API foundation

This phase adds a portable PostgreSQL schema, repository layer, service policy,
and `/api/v1` foundation around the Phase 1 storage-independent domain layer.
It does not create production infrastructure, authentication, RBAC, a Web UI,
or a v2.3.1 workbook importer.

## Local PostgreSQL

Use a local PostgreSQL instance only. Docker is optional; the repository also
works with a native PostgreSQL installation.

```powershell
Copy-Item .env.example .env
$env:POSTGRES_PASSWORD = Read-Host "Local PostgreSQL password"
docker compose -f docker-compose.postgres.yml up -d
npm run db:migrate
npm run server:dev
```

The compose file binds PostgreSQL to loopback and stores its data in a Docker
named volume, not in the repository. Replace the local placeholder values in
`.env` when using a native installation. Never put production credentials in
`.env.example` or Git.

## Validation

```powershell
npm run lint
npm run test:domain-parity
npm run test:display-period
npm run test:api
```

PostgreSQL integration tests are intentionally guarded. Run them only against
an isolated local/test database:

```powershell
$env:NODE_ENV = "test"
$env:ALLOW_DATABASE_TESTS = "true"
$env:DATABASE_URL = Read-Host "Local test DATABASE_URL"
npm run test:postgres
```

The test script refuses non-loopback database URLs and rolls back its fixture
transaction. It does not target production or cloud databases.

## Data and policy boundaries

Raw electrical, energy/cost, rack, and provenance inputs are stored as source
data. Workbook cached values are represented as legacy evidence. Ordinary
derived values are recomputed through the Phase 1 domain package, whose formula
version remains `desktop-v2.3.1`.

The backend owns one contiguous Global Display Period. Normal APIs expose only
permitted, current, available months. A verified previous month may be loaded
internally for a calculation dependency, but is not included in selectors,
DTOs, charts, or Site Comparison output. `READ_ONLY_MODE=true` rejects all
mutation HTTP methods with HTTP 423.

The first Global Display Period is initialized through the existing settings
mutation with `expected_row_version: 0`; subsequent changes use the returned
row version and stale writes return HTTP 409. Raw monthly datasets can be saved
transactionally through `PUT /api/v1/sites/:siteId/periods/:month` with a
`log` payload and `expected_row_version` (`0` for a new month). The repository
replaces that month's raw readings in one transaction, records provenance when
provided, and recomputes derived values later through the domain layer.
