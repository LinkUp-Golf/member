# Security — LinkUp Golf

> Security conventions that **already exist** in the codebase. Follow them for
> consistency. Known weaknesses are listed explicitly as "Watch items" — they are
> recorded facts, not invented mandates.

## Trust Boundaries

- **Three enforcement layers:** middleware → `withAuth()` → Supabase RLS. See
  `auth.md` and `database.md`. Each new feature must respect all three.
- **Membership is gated by live GHL tags**, fail-secure on GHL outage.

## Secrets & Environment

- **Env access is validated at import time** (`src/lib/config/env.ts`):
  hard-fail in production on missing required vars, warn in development.
- **Only `NEXT_PUBLIC_*` vars reach the browser**: `SUPABASE_URL`,
  `SUPABASE_ANON_KEY`, `APP_URL`, `VAPID_PUBLIC_KEY`.
- **Server-only secrets:** `SUPABASE_SERVICE_ROLE_KEY`, `GHL_API_KEY`,
  `GHL_WEBHOOK_SECRET`, `VAPID_PRIVATE_KEY`, `CRON_SECRET` (≥32 chars). Never log
  or return these.

## Service-Role (Admin) Client

- `createAdminClient()` bypasses RLS and is **server-side only**. Never import it
  into a client component.
- Permitted **only after an authorization gate**: inside `withAuth`/`withAdminAuth`
  handlers, verified webhooks, or verified cron handlers. Audited usages: admin
  routes, GHL webhook, cron jobs, and server-side mutations (booking creation
  writing `play_history` / cross-member rows).

## Webhook & Cron Authentication

- **GHL webhook** (`api/webhooks/ghl`): verify the HMAC-SHA256 signature against
  `GHL_WEBHOOK_SECRET` using `crypto.timingSafeEqual` **before** parsing the body.
  Reject if the signature or secret is missing.
- **Cron** (`api/cron/*`): require `Authorization: Bearer ${CRON_SECRET}` before
  doing any work; 401 otherwise.
- **Watch item:** the cron check currently uses plain string comparison (not
  constant-time). The webhook check is the constant-time reference to follow if
  hardening this.

## Input Validation & Sanitization

- **Validate before use** with `src/lib/validation.ts`
  (`validateEmail/String/Date/UUID` + composites). Validators return
  `{ valid, errors }`; return `400` with `errors[0]`.
- **Escape user-generated content** displayed to others with `sanitiseText()`
  (HTML-entity escaping). Push payloads are separately sanitized (strip `<>"'`,
  enforce length caps) in `pushService.ts`.
- **Whitelist updatable fields** on PATCH/update handlers (as the profile route
  does) so `id`/system fields can't be overwritten.

## Information Disclosure

- **Generic client errors** for auth-sensitive flows (e.g. magic link returns
  `allowed: true/false`) to prevent email enumeration. Specific reasons go to
  `auditLog()`.
- The typed error hierarchy (`src/lib/errors/app-error.ts`) returns
  `{ error: { code, message } }` — keep messages non-revealing.

## Rate Limiting (`src/lib/rateLimit.ts`)

Apply the appropriate limiter, returning `429` + `Retry-After`:

| Limiter | Limit | Applied |
|---------|-------|---------|
| `authRateLimit(ip)` | 5 / 15 min | magic link |
| `apiRateLimit(memberId)` | 120 / min | every `withAuth` route |
| `bookingRateLimit` | 10 / hr | booking |
| `messageRateLimit` / `messageBurstLimit` | 30/min, 10/15s per convo | messaging |
| `pushSendRateLimit` / `pushSendToAllRateLimit` | 10/min, 2/hr | push send |
| `inviteRateLimit` | 10 / hr | group-chat invites |

- **Watch item:** limiter is **in-memory** — it resets on restart and is per
  instance. Migrate to Upstash Redis for multi-instance scale (Redis is already
  used for caching).

## Privacy Invariants (do not regress)

- **Messages are unreadable by admins** — the `messages` RLS SELECT policy omits
  `is_admin()`. Never add admin read access.
- **`invite_tokens`** is RLS-exempt and server-only — never query it client-side.
- **Profile visibility** (`profile_visible`) and promotion `active`/scope flags are
  enforced in RLS; respect them in queries.

## Audit Logging

- Record security-relevant decisions (login denied, membership revoked, admin
  denial) via `auditLog('EVENT_NAME', { ... })` — a dedicated sink, separate from
  general logging.
- Preserve `requestId` correlation provided by `withAuth`.

## Known Watch Items (documented, not yet standardized)

- No CI / pre-commit hooks — gates run manually (`lint`, `test`, `build`).
- Cron secret comparison is not constant-time.
- Rate limiting is in-memory only.
- `sanitiseText()` is available but not auto-applied everywhere — verify per
  user-content endpoint.
