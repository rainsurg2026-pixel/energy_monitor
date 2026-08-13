# Web v3 User Management

User Management is a Phase 3 Settings area at `/settings/users`. The browser
page is a thin HTTP client; it never connects to PostgreSQL directly.

## Visibility and authorization

- `/settings` shows General and Display Period to authenticated users.
- The User Management navigation item is rendered only for an active `admin`.
- `/settings/users` performs a session-based route guard and shows an explicit
  `403 — Access Denied` state to an authenticated `user`.
- The API remains authoritative. Every `/api/v1/admin/users` operation requires
  the corresponding server-side admin permission, regardless of the UI.

## Supported operations

The page supports add user, display-name edit, role change, activation and
deactivation, and controlled password reset. The only roles are `admin` and
`user`; there is no Super Admin role.

The API returns only management-safe fields: username, display name, role,
active status, created time, and the last session creation time when available.
It does not return password values, password hashes, failed-login counters,
lockout state, session tokens, or credential/provider identifiers. Username is
immutable after creation.

Security-sensitive actions use explicit confirmation in the UI. The backend
enforces the password policy, uniqueness, session revocation, audit actor
identity, and the transactional last-active-admin invariant. Password reset
audit records contain only the action, actor, target, and timestamp—not the
new password or hash.

## API routes

```text
GET   /api/v1/admin/users
POST  /api/v1/admin/users
PATCH /api/v1/admin/users/:userId/display-name
PATCH /api/v1/admin/users/:userId/active
PATCH /api/v1/admin/users/:userId/role
POST  /api/v1/admin/users/:userId/password
```

All mutation requests require the existing session-bound CSRF token. During
`READ_ONLY_MODE`, user-management mutations return `423` before changing
database state.
