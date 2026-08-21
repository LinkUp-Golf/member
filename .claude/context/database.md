# Database — LinkUp Golf

> Supabase (PostgreSQL). Schema and policies live in `supabase/migrations/`
> (initial schema: `20260515162524_initial_schema.sql`). This document describes
> the model **as built**. Do not change schema or RLS outside a migration file.

## Conventions

- **Migrations are the source of truth.** Every schema/RLS/function change is a
  timestamped file in `supabase/migrations/` (`YYYYMMDDHHMMSS_description.sql`).
  Never edit the database out-of-band; add a new migration.
- **Primary keys** are `uuid` with `default gen_random_uuid()`. The exception is
  `members.id`, which **references `auth.users(id)`** (Supabase Auth owns the id).
- **Timestamps** are `timestamptz` defaulting to `now()`. `updated_at` columns are
  maintained by the `update_updated_at()` trigger (e.g. `members`,
  `member_profiles`).
- **Enums are Postgres `enum` types** (e.g. `membership_status`, `booking_status`,
  `moderation_status`) and mirror the TS string-literal unions in
  `src/types/index.ts`. Add new values via migration **and** update the TS type.
- **Column naming is snake_case** and is mirrored verbatim in TypeScript row types.
- **Foreign keys cascade where ownership implies it** (`on delete cascade` for
  child rows like `member_profiles`, `conversation_participants`, `messages`,
  `push_subscriptions`).
- **Indexes accompany every common access path** (e.g. `members_email_idx`,
  `bookings_course_date_idx`, `messages_conversation_idx`). Add indexes in the
  migration when you add a queried column.

## Core Tables

| Table | Purpose | Key relationships |
|-------|---------|-------------------|
| `courses` | Golf clubs; holds `access_tag`, `timezone`, capacity limits | seeded with Aviara |
| `members` | Account, mirrors GHL contact; `ghl_contact_id`, `ghl_tags`, `is_admin`, `home_course_id` | PK = `auth.users.id` |
| `member_profiles` | Display/business/golf profile; visibility flags | PK = `members.id`, auto-created by trigger |
| `course_memberships` | Access to a course (`home`/`guest`, status, validity window) | unique `(member_id, course_id, access_type)` |
| `invite_tokens` | Magic-link/invite tokens (256-bit) | **RLS-exempt**, server-only |
| `bookings` | Tee-time reservations; `ghl_booking_id`, `players` (1–4), payment fields, `reminder_*_sent` / `survey_prompt_sent` cron flags, `survey_auto_prompt` (false = finished before the survey shipped; rateable by hand, never prompted) | → members, courses (**two** FKs to members: `member_id` and `player_member_id` — embeds must name one) |
| `play_history` | Past rounds + `played_with` member array | inserted server-side only |
| `booking_surveys` | Post-round satisfaction response: `rating` 1–5, `attended`, optional `comment` | unique `booking_id` (one per booking); inserted server-side only; prompt time is derived, not stored (`src/lib/surveys/due.ts`) |
| `referrals` | Referral tracking and rewards | → members, bookings |
| `conversations` / `conversation_participants` / `messages` | Direct & group messaging | cascade on delete |
| `announcements` | Community feed, moderated (`moderation_status`) | → courses, members |
| `member_events` / `member_event_rsvps` | Member events + RSVPs | cascade on delete |
| `focus_linkups` / `focus_linkup_subscriptions` | Industry-focus group rounds + opt-ins | notification flags `..._2w/_1w` |
| `promotions` | Partner promos (course-scoped or global when `course_id` null) | → courses |
| `guest_access_requests` | Cross-course visit requests, moderated | → members, courses |
| `play_suggestions` | Dismissed play-partner suggestions | unique `(member_id, suggested_id)` |
| `push_subscriptions` | Web Push endpoints | unique `endpoint`, cascade on delete |
| `credit_ledger` | Append-only member credit wallet; signed `amount` (earned +, redeemed −, adjusted ±), so a balance is `SUM(amount)` per `member_id` | → members, hosts (nullable — credit can arrive without a host row), hosted_events |
| `credit_coupons` | Credit converted into a GHL coupon: the code, the `credit_ledger` debit that funded it, and the booking / hosted event it was issued against. Codes don't expire (`expires_at` NULL); credit comes back via a refund, which deletes the coupon at GHL | → members, credit_ledger (`ON DELETE RESTRICT`), bookings, hosted_events, courses. Partial unique on `booking_id` and on `(member_id, hosted_event_id)` **where status = 'issued'** — one open code per bill |

## Row-Level Security (RLS)

RLS is **enabled on every table** and is the database-layer access baseline.
API routes add explicit authorization on top (see `auth.md`).

Key patterns to preserve:

- **Two `security definer` helpers** drive most policies:
  - `get_member_course_ids(member_uuid)` → array of active course ids (returns
    `[]`, never NULL, so `= any(...)` is safe).
  - `is_admin()` → reads `members.is_admin` for `auth.uid()`.
- **Community visibility** is the dominant rule: members see rows whose
  `course_id = any(get_member_course_ids(auth.uid()))`, or that they own, or when
  `is_admin()`.
- **Ownership writes:** insert/update policies check `... = auth.uid()` (e.g.
  `members`, `bookings`, `member_profiles`, RSVPs).
- **Messages are private from the anon/member client, but admins have an
  explicit oversight tool.** The `messages` SELECT RLS policy intentionally
  **omits `is_admin()`** — regular member-authenticated queries can never read
  a conversation they're not a participant in. Admin access instead goes
  through `/api/admin/messaging/conversations` and
  `/api/admin/messaging/conversations/[id]/messages`, which use the
  service-role client (bypasses RLS entirely) behind `requireAdmin: true`.
  This is a deliberate trust & safety feature (any admin can browse any DM or
  group, including deleted messages, with no per-conversation gate), not a
  bug — when reviewing this code, don't "fix" it by adding admin read access
  at the RLS layer or by restricting the API routes' scope.
- **`invite_tokens` is intentionally RLS-exempt** — accessed only via the admin
  (service-role) client server-side. Do not query it with the anon client.
- **`play_history` has no INSERT policy** — rows are written only by the booking
  API route using the admin client. Keep server-side-only writes server-side.
- **Profiles respect `profile_visible`**; promotions respect `active` and
  null-course = global.

When adding a table:
1. `alter table <t> enable row level security;`
2. Add SELECT (community/ownership) and write (ownership) policies following the
   patterns above.
3. If a table is server-only, document why it's RLS-exempt (as `invite_tokens`
   does) rather than leaving it ambiguous.

## Realtime

`messages`, `announcements`, `conversations`, and `conversation_participants` are
added to the `supabase_realtime` publication. The messaging UI subscribes per
conversation (`conversation:{id}`) with a broadcast + `postgres_changes` backup.
If a new table needs live updates, add it to the publication in a migration.

## Triggers & Functions

- `update_updated_at()` — bumps `updated_at` on update (members, profiles).
- `create_member_profile()` — auto-creates a `member_profiles` row on member
  insert (`security definer`).
- **Money is service-role only.** Every function that moves credit is
  `security definer` with `EXECUTE` revoked from `anon`/`authenticated`:
  `award_host_event_credit`, `redeem_member_credit`, `adjust_member_credit`,
  `issue_credit_coupon`, `settle_credit_coupon`,
  `attach_credit_coupon_ghl_id`. They take `pg_advisory_xact_lock` on the
  member's wallet so concurrent spends can't both read the same balance.
  `settle_credit_coupon` is idempotent (only acts on a coupon still `issued`),
  which is what stops a re-run refunding twice.
- Beware **RLS recursion** on self-referential policies — there is a dedicated fix
  migration (`20260528000002_fix_rls_recursion.sql`); review it before changing
  `conversation_participants` policies.

## Access from Code

- Client/server reads go through the RLS-enforced clients (anon key / cookies).
- **Service-role (`createAdminClient`) writes** are reserved for: booking creation
  (`play_history`, cross-member rows), webhooks, cron, and admin operations —
  always behind an authorization gate. See `architecture.md` §2 and `security.md`.
