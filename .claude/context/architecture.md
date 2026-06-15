# Architecture Rules — LinkUp Golf

> Derived from existing patterns in this repository. These rules describe the
> architecture **as it is built today**. Follow them so new work composes with
> the existing structure. Do not introduce parallel mechanisms where one of these
> already exists.

## 1. Route Groups & Protection

- **Route groups segregate access tiers:** `(app)/` = protected member routes,
  `(admin)/` = admin-only routes, `(auth)/` = public auth routes. Root-level pages
  (`/login`, `/install`, `/offline`, `/membership-required`, `/auth/error`) are
  public.
- **`src/middleware.ts` is the first gate.** It refreshes the Supabase session on
  every request, redirects unauthenticated users to `/login` (with `redirectTo`),
  bounces authenticated users away from `/login`, and enforces `is_admin` for
  `/admin` routes.
- **`PUBLIC_ROUTES` and `ADMIN_ROUTES` arrays** in middleware are the single source
  of truth for path-level access. Add new public paths there, not via ad-hoc checks.
- **Middleware admin check retries once on DB error** before denying — keep this
  fail-safe to avoid locking out valid admins on transient DB failures.

## 2. Supabase Client Selection (4 clients, strict boundaries)

| Client | Source | Where it may be used |
|--------|--------|----------------------|
| `createClient()` (browser, anon key) | `src/lib/supabase.ts` | Client components only; RLS-enforced |
| `createServerComponentClient()` | `src/lib/supabase-server.ts` | Server Components & route handlers (read-only cookies) |
| `createRouteHandlerClient(cookies())` | `src/lib/supabase-server.ts` | Route handlers (can set/remove cookies) |
| `createAdminClient()` (service role) | `src/lib/supabase-server.ts` | **Server-side only**, bypasses RLS |

- **Never import `createAdminClient()` into a client component.** It uses the
  service role key and bypasses RLS.
- **`createAdminClient()` is only acceptable after an authorization gate has
  passed**: inside `withAuth()`/`withAdminAuth()` handlers, webhook handlers (after
  signature verification), or cron handlers (after `CRON_SECRET` check).
- **RLS is the database-layer baseline; API routes add explicit authorization on
  top.** Both layers are expected — do not rely on one alone.

## 3. Layer Separation

- **Client components** hold UI/state and fetch through `apiClient`. No direct DB
  access.
- **API route handlers** orchestrate: validate → `withAuth` → business logic →
  response. One route per `route.ts`.
- **Business logic lives in `src/lib/` modules**, organized by domain
  (`ghl/`, `push/`, `sync/`, `cache/`, `auth/`, `errors/`, `logger/`, `config/`).
- **Server-only modules are named `*-server`** (e.g. `supabase-server.ts`) or live
  under server-only `lib/` domains.
- **Server Components stay thin** — layout/wrapping only (e.g. `(app)/layout.tsx`
  just wraps children in `AppNav`).

## 4. Authentication & Authorization

- **`withAuth()` (`src/lib/auth/with-auth.ts`) is the standard API gate** and runs
  five sequential checks: (1) valid Supabase JWT session, (2) per-user rate limit,
  (3) member row exists (5-min cache), (4) admin check if `requireAdmin`, (5) live
  GHL membership re-validation (15-min cache). It returns 401/403/429/503 as
  appropriate and supplies the `AuthContext`.
- **Use `skipGHLCheck` / `requireAdmin` options** rather than writing bespoke auth.
- **GHL membership validation is fail-secure** (`src/lib/auth/ghl-validator.ts`):
  if GHL is unavailable and no valid cached auth exists, **deny**. Only **positive**
  auth results are cached; negative results are always re-checked live so reinstated
  members regain access quickly. Preserve this asymmetry.
- **Magic-link flow** (`api/auth/magic-link` → Supabase OTP → `api/auth/callback` →
  `syncMemberByContactId`) gates on live GHL tags and returns generic
  allow/deny payloads to prevent email enumeration.

## 5. External Integration (GHL)

- **All GHL access goes through `src/lib/ghl/`** — the lazily-initialized singleton
  client (`getClient()`), tag helpers (`hasAnyAccessTag`, `COURSE_TAG_MAP`), and
  typed operations (contacts, tags, workflows, calendar, payments, opportunities).
  Do not call the GHL API directly from routes.
- **GHL failures throw `GHLError`** and are mapped to meaningful codes
  (`GHL_CONTACT_NOT_FOUND`, `GHL_UNAVAILABLE`).
- **Workflow triggers are enumerated** in `GHL_WORKFLOWS`; reference those keys
  rather than raw IDs.

## 6. Caching

- **Cache through the `ICache` abstraction** (`src/lib/cache/index.ts`). The factory
  returns an Upstash Redis cache when `UPSTASH_REDIS_REST_*` env vars are set,
  otherwise an in-memory cache (capped at 2000 entries, periodic sweep, oldest-out
  eviction).
- **Use `withCache(cache, key, fetcher, ttlMs)`** for read-through caching. Cache
  read/write failures are non-fatal by design — never let a cache error break a
  request.
- **Build keys with the helpers in `src/lib/cache/keys.ts`** and reuse the defined
  namespaces and TTLs (`member:row` 5m, `member:detail` 30m, `course:ann` 5m,
  `course:promo` 30m, `course:linkups` 1h, `course:members` 15m, `ghl:slots` 30m,
  `ghl:auth` 15m). Do not hand-format cache keys.
- **Invalidate the relevant namespace on mutation** (as booking/announcement
  creation already does).

## 7. Push Notifications

- **Client side:** the `usePushNotifications()` hook manages permission, browser
  subscription, and server registration via `api/push/subscribe`.
- **Server side:** dispatch through `src/lib/push/pushService.ts`
  (`sendToUser`, `sendToUsers`, `sendToSubscription`). Payloads are sanitized
  (strip `<>"'`, enforce max lengths) and sent with exponential-backoff retries;
  stale subscriptions (404/410) are pruned asynchronously.
- **VAPID keys are a pair:** `NEXT_PUBLIC_VAPID_PUBLIC_KEY` (client) and
  `VAPID_PRIVATE_KEY` (server-only).

## 8. Scheduled Jobs (Cron)

- **Cron schedules are declared in `vercel.json`** (`/api/cron/daily` 08:00 UTC
  daily; `/api/cron/play-suggestions` 09:00 UTC Mondays).
- **Every cron handler verifies `Authorization: Bearer ${CRON_SECRET}`** before
  doing work, returning 401 otherwise.

## 9. Configuration & Secrets

- **Env access is centralized and validated at import time** in
  `src/lib/config/env.ts`: hard-fail in production if a required var is missing,
  warn in development.
- **`NEXT_PUBLIC_*` vars are the only client-exposed values**
  (`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `APP_URL`, `VAPID_PUBLIC_KEY`). Everything
  else (`SUPABASE_SERVICE_ROLE_KEY`, `GHL_API_KEY`, `GHL_WEBHOOK_SECRET`,
  `VAPID_PRIVATE_KEY`, `CRON_SECRET`) is server-only.

## 10. Module Organization

```
src/
├── app/            # routes: (app) (admin) (auth) + api/
├── lib/            # business logic by domain
│   ├── auth/       # withAuth HOC, GHL validator
│   ├── cache/      # ICache abstraction + key builders
│   ├── ghl/        # GHL client, tags, types
│   ├── push/       # dispatch, subscription repo, web-push wrapper
│   ├── sync/       # member/membership sync from GHL
│   ├── errors/     # typed error hierarchy
│   ├── config/     # env validation
│   └── logger/     # structured + audit logging
├── components/     # by feature: ui/ layout/ messages/ admin/ providers/
├── hooks/          # one hook per file
├── contexts/       # AuthContext, ProfileContext
├── types/          # domain types
└── middleware.ts   # edge gate
```

- **Keep one responsibility per module** and re-export public surfaces from
  `index.ts`. Place new domain logic under the matching `lib/` folder rather than
  inlining it in a route.
