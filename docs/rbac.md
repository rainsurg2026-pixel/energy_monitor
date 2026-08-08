# Energy Monitor Web v3 RBAC Core

Status: Phase 3 Agent 2 policy core. This document and `server/authz/` define
the authorization contract for the Web API. They do not add HTTP wiring, UI,
authentication flows, Entra/OIDC, database migrations, or Supabase RLS
policies.

## Identity boundary

The application user is the stable business identity. A request is authorized
only after the authentication layer has resolved a server-side
`AuthenticatedPrincipal`:

```ts
{
  userId: string;       // canonical application users.id representation
  role: "admin" | "user";
  active: true;
  authMethod?: "local" | "entra";
  sessionId?: string;
}
```

`userId` is the only actor identity accepted by the policy core. Services must
obtain audit ownership with `actorIdentityFromPrincipal(principal)`. They must
not accept `actor_user_id`, username, email, provider subject, role, or any
other actor claim from the request body. The future Entra mapping resolves an
identity to the same application `users.id`; it does not replace that ID.

## Roles and permission matrix

Only these roles exist in Web v3.0.0:

| Permission | `admin` | `user` |
|---|:---:|:---:|
| View Dashboard | Yes | Yes |
| View Energy | Yes | Yes |
| View Cost | Yes | Yes |
| View Electrical | Yes | Yes |
| View Rack / Rack Unit | Yes | Yes |
| View Site Comparison | Yes | Yes |
| Read shared operational data | Yes | Yes |
| Create/edit shared operational data | Yes | Yes |
| Generate allowed reports/exports | Yes | Yes |
| Read effective Global Settings | Yes | Yes |
| Read effective Display Period | Yes | Yes |
| List users | Yes | No |
| Create users | Yes | No |
| Edit user display names | Yes | No |
| Activate/deactivate users | Yes | No |
| Assign `admin`/`user` roles | Yes | No |
| Reset/replace a user password | Yes | No |
| Manage Global Settings | Yes | No |
| Manage Global Display Period | Yes | No |
| View Audit History | Yes | No |
| Backup/restore administrative operations | Yes | No |
| Administrative migration controls | Yes | No |
| Alter audit records | No | No |

Operational data is shared across authorized users. There is no per-user
ownership rule in this policy core. Audit records are system-owned and
immutable through application roles, including `admin`.

Use the centralized guards rather than inline role checks:

```ts
const principal = requireAuthenticated(requestPrincipal);
requirePermission(principal, PERMISSIONS.operationalDataWrite);
const actor = actorIdentityFromPrincipal(principal);
```

`requireRole(principal, "admin")` is available for an explicitly
administrative operation. All guards fail closed.

## Safe authorization errors

The policy core exposes only stable status/code pairs and generic messages:

| Status | Code | Meaning |
|---:|---|---|
| 401 | `UNAUTHORIZED` | No valid active authenticated principal |
| 403 | `FORBIDDEN` | Principal is authenticated but lacks the required role/permission |
| 423 | `READ_ONLY_MODE` | The operation is blocked by server-side read-only mode |

Errors do not include the expected role, actual role, user ID, username,
email, session token, or request-body values.

## READ_ONLY_MODE interaction

`READ_ONLY_MODE` is server-authoritative and applies equally to `admin` and
`user`. Role elevation never bypasses it.

| Operation | During read-only mode |
|---|---|
| Login, logout, session lookup | Allowed |
| Dashboard, Energy, Cost, Electrical, Rack, Site Comparison reads | Allowed |
| Shared operational-data reads | Allowed |
| Allowed report/export generation | Allowed |
| Effective settings/display-period reads | Allowed |
| Audit-history read | Allowed for `admin` only |
| Change password | Blocked in pilot mode |
| User management | Blocked in pilot mode |
| Create/edit operational data | Blocked |
| Global Settings mutation | Blocked |
| Global Display Period mutation | Blocked |
| Audit-record alteration | Always blocked |
| Backup/restore | Blocked |
| Administrative migration control | Blocked |

Call `requireOperationAllowedInReadOnlyMode(operation, readOnlyMode)` after
authentication/permission checks and before the operation's mutation. The
helper is deliberately independent of role so an admin cannot bypass the
lock.

## Integration rules for later agents

- Authentication middleware must construct the principal from the validated
  server-side session and attach it to the request context.
- Routes/services must authenticate before reading mutable request data.
- Business/audit writes must use the principal-derived actor identity and the
  existing transaction boundary.
- Browser UI visibility is only a convenience; these server-side policies are
  the authorization boundary.
- Agent 3 must coordinate database roles and RLS separately. RLS is defense in
  depth and must not be replaced with blanket permissive policies.
