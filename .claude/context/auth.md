# Authentication & Authorization — LinkUp Golf

> Describes the auth model **as built**. Membership is gated by Go High Level
> (GHL) tags; sessions are Supabase Auth; API routes are protected by the
> `withAuth()` HOC. Do not introduce a parallel auth mechanism.

## Layers (defense in depth)

1. **Middleware** (`src/middleware.ts`) — edge gate on every request.
2. **`withAuth()` HOC** (`src/lib/auth/with-auth.ts`) — per-API-route gate.
3. **Supabase RLS** — database-layer enforcement (see `database.md`).

All three are expected to be present; none is sufficient alone.

## Middleware (`src/middleware.ts`)

- Refreshes the Supabase session (JWT cookie) on every request.
- `PUBLIC_ROUTES` — paths allowed without a session (`/login`, `/install`,
  `/offline`, `/membership-required`, `/auth/*`, `/api/auth/magic-link`,
  `/api/auth/callback`, `/api/auth/signout`, `/api/webhooks`). **Add new public
  paths here.**
- `ADMIN_ROUTES = ['/admin']` — triggers an `is_admin` DB check; **retries once on
  DB error** before denying (fail-safe against transient DB failures).
- Authenticated users hitting `/login` are redirected to `/home`; unauthenticated
  users are redirected to `/login?redirectTo=...`.

## Magic-Link Login Flow

1. **`POST /api/auth/magic-link`** (`src/app/api/auth/magic-link/route.ts`)
   - IP rate-limited (`authRateLimit`: 5 / 15 min).
   - Validates email via `validateEmail`.
   - **Returning member** (exists in `members`): re-validate live GHL tags →
     if valid, silently generate an OTP (`admin.generateLink()`) and return a
     `token_hash`; if suspended/revoked, deny with the corresponding flag.
   - **New user**: check `getContactByEmail()` has an access tag → allow client to
     send the OTP, otherwise deny **without** sending email.
   - Responses are **generic** (`allowed: true/false`) to prevent email
     enumeration; the specific reason goes to `auditLog()`.
2. **`GET /api/auth/callback`** — exchanges the OTP `code` for a session, then
   calls `syncMemberByContactId()` to create/update the `members` row from GHL.
3. **Session** is stored in a secure httpOnly cookie and refreshed by middleware.

## API Route Gate — `withAuth()`

`withAuth(handler, options?)` runs five sequential checks and returns the right
status on failure:

1. **Session** — `createRouteHandlerClient(cookies()).auth.getUser()`; throws
   `AuthError` (401) if invalid.
2. **Rate limit** — per-user (`apiRateLimit`, default 120/min; override via
   `options.rateLimit`); 429 with `Retry-After`.
3. **Member row** — fetched and cached 5 min (`member:row`); 403 if missing.
4. **Admin** — if `options.requireAdmin`, checks `is_admin`; 403 otherwise.
   `withAdminAuth()` is the shorthand.
5. **GHL membership** — unless `options.skipGHLCheck`, re-validates live access
   tags (15-min cache); 403 if no tag, 503 if GHL is unreachable.

On success it provides an `AuthContext`: `{ requestId, userId, email, memberId,
ghlContactId, isAdmin, homeCourseId }`.

```ts
export const dynamic = 'force-dynamic'
export const GET = withAuth(async (req, ctx) => {
  // ctx.userId / ctx.memberId / ctx.isAdmin available
})
export const POST = withAdminAuth(async (req, ctx) => { /* admin only */ })
```

**Always use `withAuth`/`withAdminAuth` for authenticated routes** rather than
hand-rolling session checks.

## GHL Membership Validation (`src/lib/auth/ghl-validator.ts`)

- **Fail-secure:** if GHL is unavailable and there is no valid cached auth →
  **deny** (503). Never fall open.
- **Asymmetric caching:** only **positive** results are cached (15 min,
  `ghl:auth`); negative results are always re-checked live so reinstated members
  regain access quickly. Preserve this asymmetry.
- Access is determined by `hasAnyAccessTag(contact.tags)` (tag map in
  `src/lib/ghl/tags.ts`). Course access tags also live on `courses.access_tag`.
- Contact-not-found → deny and invalidate the cached entry.

## Authorization Model

- **Membership = GHL access tag**, not just a Supabase session. A valid session
  with no/stale GHL tag is denied.
- **Admin = `members.is_admin`**, checked in both middleware (route prefix) and
  `withAuth` (`requireAdmin`).
- **Revocation propagates** via the client-side handler: a `403 MEMBERSHIP_REVOKED`
  from any API call triggers sign-out + redirect (`src/lib/api-client.ts`).

## Client-Side Session

- `AuthContext` / `SessionProvider` expose the session; `ProfileContext` loads the
  member + home course (with exponential-backoff retry).
- Client components read auth via these contexts/hooks and call APIs through
  `apiClient` — never the admin client, never direct privileged DB access.
