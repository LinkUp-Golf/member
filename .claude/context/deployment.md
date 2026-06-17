# Deployment — LinkUp Golf

> Describes how the app is built, configured, and deployed **today**. Vercel hosts
> the Next.js app; Supabase hosts the database; scheduled work runs via Vercel
> Cron. Do not introduce a different deploy/runtime mechanism without cause.

## Platform

- **Host:** Vercel (Next.js 14 App Router).
- **Database/Auth:** Supabase (PostgreSQL + Auth).
- **Cache (optional):** Upstash Redis when `UPSTASH_REDIS_REST_*` is set; otherwise
  in-memory fallback (`src/lib/cache/`).
- **PWA:** `next-pwa` (service worker, offline support, manifest at
  `public/manifest.json`).

## Build & Run

```bash
npm run dev      # local dev (http://localhost:3000)
npm run build    # next build — full TypeScript type-check (the type-safety gate)
npm start        # production server
npm run lint     # ESLint
npm test         # Vitest
```

- **`npm run build` is the type-safety gate** (strict mode). A clean build is
  required before deploy; there is **no CI** to enforce it, so run `lint`, `test`,
  and `build` locally before pushing.
- **`export const dynamic = 'force-dynamic'`** is set on dynamic API routes so
  responses aren't statically cached at build.

## Environment Variables

Validated at import time in `src/lib/config/env.ts` (production hard-fails on
missing required vars; development warns). Set these in the Vercel project (and
`.env.local` for dev — see `.env.local.example`):

**Client (`NEXT_PUBLIC_*`):** `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_APP_URL`,
`NEXT_PUBLIC_VAPID_PUBLIC_KEY`.

**Server-only:** `SUPABASE_SERVICE_ROLE_KEY`, `GHL_API_KEY`, `GHL_LOCATION_ID`,
`GHL_AVIARA_CALENDAR_ID`, `GHL_WEBHOOK_SECRET`, `VAPID_PRIVATE_KEY`,
`VAPID_CONTACT_EMAIL`, `CRON_SECRET` (≥32 chars).

**Optional:** `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`, `LOG_LEVEL`.

- Generate VAPID keys with `npm run generate-vapid`.

## Database Migrations

- Migrations live in `supabase/migrations/` (timestamped SQL). They are the source
  of truth for schema, RLS, functions, and realtime publication.
- Apply migrations to the Supabase project as part of the release; never mutate the
  database out-of-band. See `database.md`.

## Scheduled Jobs (Vercel Cron)

Declared in `vercel.json`:

| Path | Schedule (UTC) | Work |
|------|----------------|------|
| `/api/cron/daily` | `0 8 * * *` (08:00 daily) | expire guest memberships; send Focus LinkUp 2w/1w notifications |
| `/api/cron/play-suggestions` | `0 9 * * 1` (09:00 Mondays) | play-partner suggestions |

- Each handler verifies `Authorization: Bearer ${CRON_SECRET}` before running.
- Add new cron jobs by adding both the `vercel.json` entry **and** the
  `CRON_SECRET` check in the handler.

## PWA / Caching Notes

- Service worker caches API responses (~24h) and images (~30d). If an API response
  shape changes, stale cached responses are a risk — consider cache-busting.
- The manifest and offline fallback (`/offline`) ship with the app.

## Runtime Caching (Redis vs Memory)

- Single-instance/dev: in-memory cache is fine.
- Multi-instance production: set the Upstash env vars so cache (and, ideally,
  rate limiting — see `security.md` watch item) is shared across instances.
