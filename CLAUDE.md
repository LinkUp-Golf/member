# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code), and to any AI coding tool, when working with code in this repository.

**New to the project? Start with [`docs/HANDOVER.md`](docs/HANDOVER.md)**: the outside services and their dashboard setup, environments, how to ship, what's unfinished, and access to hand over. **[`docs/decisions.md`](docs/decisions.md)** records why things are the way they are. Read it before reversing something that looks odd. **[`docs/code-map.md`](docs/code-map.md)** is a generated index of every file. When you change a feature, update its section here, and add a `docs/decisions.md` entry if it rests on a judgment call.

## Project Overview

**LinkUp Golf** is a Next.js-based progressive web app (PWA) for managing golf club memberships, bookings, messaging, and community features. The backend uses Supabase (PostgreSQL + Auth) with Go High Level (GHL) integration for contact/booking management.

## Tech Stack

- **Framework**: Next.js 14.2.3 (App Router)
- **Language**: TypeScript 5
- **UI**: React 18, Tailwind CSS 3.4.1, custom brand colors; Recharts 3 (admin analytics charts only)
- **State Management**: React Context (`AuthContext`, `ProfileContext`, `SessionProvider`). NOTE: `zustand` is still in `package.json` but is no longer used — auth state moved to Context.
- **Database**: Supabase (PostgreSQL + Auth)
- **External APIs**: Go High Level (GHL) for contacts/bookings
- **PWA**: next-pwa 5.6.0 (offline support, service worker caching)
- **Testing**: Vitest (`vitest run`) + MSW; unit tests in `src/__tests__/`
- **Fonts**: Lexend Deca (`--font-lexend`) and Caveat Brush (`--font-caveat`), loaded via `next/font/local` in `src/app/layout.tsx`
- **Notifications**: Web Push (VAPID keys)
- **Payments**: Stripe (`stripe`, server only) — only for invoicing late-cancellation fees; rounds themselves are still paid through GHL checkout or at the club

## Key Commands

```bash
# Development
npm run dev              # Start dev server (http://localhost:3000)

# Build & Deploy
npm run build           # Build for production
npm start              # Run production server

# Code Quality
npm run lint           # Run ESLint
npm test               # Run Vitest suite once
npm run test:watch     # Vitest watch mode
npm run test:coverage  # Vitest with coverage

# Database (Supabase CLI)
npm run db:push        # Apply migrations
npm run db:reset       # Reset local DB
npm run db:migration   # Create a new migration
npm run db:status      # List migration status

# Utilities
npm run generate-vapid # Generate VAPID keys for push notifications
npm run analyze        # Bundle analysis build (ANALYZE=true)
npm run docs:map       # Regenerate docs/code-map.md from file header comments
```

### Running Tests

```bash
npm test            # Run the Vitest suite once
npm run test:watch  # Watch mode
npm run test:coverage # Coverage report
```

Vitest + MSW are configured (`vitest.config.ts`, setup in `src/__tests__/setup.ts`).
Unit tests live in `src/__tests__/` (57 files, about 800 tests) and cover the
pure rule modules in `src/lib/` — cancellation policy, booking rules, matching,
email template, notifications, GHL validator, cache, errors. A rule module's
tests are its spec. Coverage reporting is configured for `src/lib/auth/**`,
`src/lib/cache/**`, `src/lib/logger/**`, `src/lib/errors/**`. There is no CI
pipeline — run `npm run lint`, `npm test`, and `npm run build` locally before
pushing.

## Architecture

### Route Structure

The App Router, with route groups. This is the shape; **`docs/code-map.md` lists every page, route, library file and migration with a one-line description** (regenerate it with `npm run docs:map`).

```
src/app/
├── (app)/        # Signed-in members and guests
│   ├── home/  members/[id]  messages/[id] + new/  book/ + invitations/[id]
│   └── more/     # profile, settings, payments (cancellation fees), match-profile
│                 # (Curated Introductions), notifications, announcements, promotions,
│                 # events, focus-linkups, guest-access, referrals, referral-partner,
│                 # host (Become a Host), install
├── (admin)/admin/  # is_admin only (middleware): analytics, announcements, bookings,
│                   # credits, events, focus-linkups, golf-events (labelled "Courses"),
│                   # guest-access, hosts/[id], matching, members, messaging, promotions,
│                   # referrals/[id], reports/nonprofits, reviews
├── (host)/host/    # Hosts: dashboard, events (list rounds), credits
├── (partner)/partner/  # Referral partners: referrals, submissions (CSV), payments, credits
├── (auth)/login/   # Magic-link sign-in
├── auth/           # confirm, error (the sign-in callback is /api/auth/callback)
├── become-a-member/  membership-required/  install/  offline/
├── .well-known/vercel/flags  # Vercel toolbar flag discovery
└── api/            # 148 routes: admin/*, auth/*, bookings/*, cancellation-fees/*,
                    # conversations/*, courses/*, credits/*, cron/* (7, see vercel.json),
                    # email/*, events/*, focus-linkups/*, guest-access/*, host/*,
                    # hosted-events/*, match-survey, members/*, notifications/*,
                    # partner/*, profile/*, promotions/*, push/*, recommendations/*,
                    # referral-partner/*, referrals/*, surveys/*,
                    # webhooks/{ghl, ghl/bookings, resend, stripe}
```

### Authentication & Authorization

- **Magic link flow**: Email validation → GHL contact lookup → tag check → send link → callback validation → `syncMemberByContactId()`
- **Session management**: Supabase Auth (cookies), surfaced to the client via React Context (`SessionProvider` / `AuthContext` / `ProfileContext`)
- **API route gate**: `withAuth()` / `withAdminAuth()` HOC (`src/lib/auth/with-auth.ts`) wraps authenticated routes — session → rate limit → member row (cached) → admin check → live GHL membership re-validation (fail-secure)
- **Middleware** (`src/middleware.ts`):
  - Refreshes Supabase session on every request
  - Redirects unauthenticated users to `/login` (except public routes)
  - Checks `is_admin` flag for `/admin/*` routes (retries once on DB error)
  - Skips public routes (`PUBLIC_ROUTES`): `/login`, `/install`, `/auth/*`, `/api/webhooks`, `/api/auth/*`
- **RLS enforcement**: Supabase Row-Level Security protects data at the database level

### Database Models

Core entities in `src/types/index.ts`:

- **Member**: User account, linked to Supabase Auth
- **MemberProfile**: Display name, avatar, business info, golf preferences
- **Course**: Golf club
- **CourseMembership**: Access level (home/guest), status (active/pending/expired)
- **Booking**: Tee time reservation
- **PlayHistory**: Record of past rounds
- **Conversation**: DM or group chat
- **Message**: Chat messages
- **Announcement**: Course announcements (moderated)
- **MemberEvent**: Member-organized events with RSVP
- **FocusLinkup**: Industry-specific group rounds
- **Referral**: Member referral tracking
- **GuestAccessRequest**: Request to visit another course
- **Promotion**: Partner promotions/badges

**Enrich patterns**: `MemberWithProfile` joins Member + MemberProfile + Course; `ConversationWithDetails` includes participants & last message.

### State Management

Auth/session state is managed with **React Context** (not Zustand):

- **`SessionProvider`** (`src/components/providers/SessionProvider.tsx`): provides the session + realtime subscription
- **`AuthContext`** (`src/contexts/AuthContext.tsx`): session/user state
- **`ProfileContext`** (`src/contexts/ProfileContext.tsx`): loads member + home course (with exponential-backoff retry)
- Client components consume these via hooks (e.g. `useProfile()`); data is fetched through the `apiClient` singleton (`src/lib/api-client.ts`), not direct Supabase calls.

### Supabase Integration

**Four client factories**, split across two files:

In `src/lib/supabase.ts`:
1. **Browser client** (`createClient()`): For client components, respects RLS

In `src/lib/supabase-server.ts` (server-only):
2. **Server component client** (`createServerComponentClient()`): For Server Components (read-only cookies)
3. **Route handler client** (`createRouteHandlerClient(cookies())`): For API routes (can set/remove cookies)
4. **Admin client** (`createAdminClient()`): Service role key, bypasses RLS (server-side only, never expose; use only behind an auth/webhook/cron gate)

**RLS pattern**: Queries at database layer enforce ownership/access; API routes validate permissions explicitly via `withAuth()`.

### External Integration: Go High Level (GHL)

Centralized in `src/lib/ghl/` (import `@/lib/ghl/client` and `@/lib/ghl/tags`). The
old `src/lib/ghl.ts` / `src/lib/ghl-tags.ts` files are thin re-export shims kept for
backward compatibility — new code should import the `ghl/` subpaths:

- **Authentication**: Bearer token (API key)
- **Key operations**:
  - `getContactByEmail()`: Look up contact, check tags for access
  - `contactHasTag()`: Verify membership status via tags (e.g., `avi-active`)
  - Calendar & booking operations (fetch slots, create events)
  - Coupons (`src/lib/ghl/coupons.ts`) — how member credit is spent. Credit is
    converted into a fixed-amount, single-use GHL coupon and the member enters
    the code at the venue's checkout (`courses.payment_url`), so paying by
    credit and paying cash finish in the same place. Note these endpoints are on
    API version `v3`, not the `2021-07-28` everything else uses.
- Used in auth flow to gate access and in webhook handlers
- **Webhook** (`/api/webhooks/ghl`): Receives updates from GHL, requires secret verification

**GHL decides more than membership.** Who can sign in and as what (contact tags), what tee times
exist and how many seats each has (each venue's GHL calendar, read through free slots, cached 30
minutes; the app has no tee-time table), and whether a round is confirmed and paid (the booking
pipeline, whose workflows call `POST /api/webhooks/ghl/bookings` — the only way the app learns a
round was paid). Before changing anything in those areas, read `docs/HANDOVER.md` §3.1: it lists
what GHL owns, what the app writes back, what must be set up by hand in GHL, and the GHL settings
that do nothing (`GHL_WORKFLOW_*` env vars, `GHL_AVI_PLAY_CANCELLED_STAGE_ID`).

### Email Notifications

Resend, as the second channel beside push. One notification is defined once —
`NotificationTemplates` in `src/lib/push.ts` — and `src/lib/notify.ts` fans it
out to both: `notifyMember()`, `notifyMembers()`, `notifyAdmins()`.

- **Every template has an email counterpart**, so `notify*` is the default way
  to send one. `notifyCourse()` / `notifyFocusMembers()` cover the broadcast
  audiences. Two call sites deliberately don't use it, and say why in place:
  booking reminders — GHL already emails and SMSes those, and a second would be
  a duplicate from a system that doesn't know about the first.
- **Nothing is throttled, and one thing is suppressed.** If a notification was
  worth pushing, every reachable recipient gets the email, however many that is:
  no cooldown, no daily cap, no send log. Membership status isn't consulted
  either — a suspended or lapsed member still hears from us. The one exception is
  `email_suppressions` (`src/lib/email/suppression.ts`): an address that hard-
  bounced, was reported as spam, or used the unsubscribe link is dropped before a
  message is built, because continuing to mail any of the three is what ruins a
  sending domain for everyone else. Reads fail open — an unreadable table sends
  to everybody rather than to nobody.
- **Deliverability.** Every message carries `List-Unsubscribe` and
  `List-Unsubscribe-Post` (RFC 8058 one-click), which Gmail and Yahoo have
  required of bulk senders since Feb 2024. The link is
  `/api/email/unsubscribe?t=<token>`, public, and the token carries the address
  signed with `EMAIL_UNSUBSCRIBE_SECRET` (falling back to the service-role key) —
  so it works from an inbox with no session and can't be edited into somebody
  else's address. It never expires: a year-old email's link must still work.
  `POST /api/webhooks/resend` is how we learn about bounces and complaints
  (Svix signature verification in `src/lib/email/webhook.ts`, implemented
  directly rather than by adding the package; `RESEND_WEBHOOK_SECRET` unset
  rejects everything). Only a **permanent** bounce suppresses — a full mailbox is
  not a dead address. A group send goes as one message per recipient through
  Resend's batch endpoint (`sendEmailBatch`, 100 per call), not bcc: only an
  individually addressed message can carry that person's own unsubscribe header,
  and a bad address then fails its own message instead of the whole send.
  `POST /api/admin/email-test` reports suppression as its own stage — it's the
  newest reason a notification silently doesn't arrive.
- **One template for every email** (`src/lib/email/template.ts`) — logo, white
  card on a tinted page, heading, body, one photo, one button that opens the app
  at the notification's own `url`. Table-based and inline-styled because email
  clients are not browsers; pure and therefore tested. `imageUrls` is the whole
  set the notification carries and `mediaBlock` shows **one** of them with a
  `+n more photos` strip along the bottom of it: four photos made the message a
  scroll, and three of them were downloads the reader paid for to reach a button
  below them all. The photo and the strip both open the post, where the rest
  are. The strip is a table row under the image rather than a badge over it,
  because an overlay needs absolute positioning and Outlook renders through Word.
  `announcementImages` (`src/lib/announcements/media.ts`) picks the set off the
  row — stills only, since no mail client will play the video, and absolute URLs
  only, since the client fetches them itself. `PushPayload.image` stays the
  single one push has room for; `PushPayload.images` is the whole set, and how
  many of them belong in an inbox is the template's decision, not the caller's.
- The push payload's `url` is relative (the service worker resolves it); the
  email prefixes `NEXT_PUBLIC_APP_URL`. Two template fields exist only for the
  email and are ignored by push: `cta`, the button's wording, and `subject`,
  the line it arrives under — separate from `title` because a push title is
  read beside the app's name ("New reservation") while a subject stands alone
  in an inbox ("Dana reserved a spot at your Aviara event").
- **No key, no channel.** With `RESEND_API_KEY` unset nothing is sent and
  nothing fails. Neither channel can fail its caller — `notify*` never throws
  and every call site `void`s it.

### Cancellation Policy (Stripe invoices)

A seat given up late costs a share of its own price: **free** up to 2 days
before the round, **50%** the day before, **100%** on the day. "Day" is the
venue's calendar day (`todayAtVenue`, `daysUntil`), not a 24-hour count. The
tiers are `CANCELLATION_TIERS` in `src/lib/cancellation/policy.ts` — percentages
applied to each seat's own price (`bookingAmountDue`, i.e. `amount_charged`
falling back to `cost_per_player`; a hosted round's `memberPrice`), so a new
event at a new price needs no configuration. That module is pure and is the one
rule: the confirm screen, the invitation screen, the cancel dialog and the
cancel routes all read it.

- **No card is asked for.** (The card-on-file version — SetupIntent at booking,
  off-session charge on cancel, 409 `card_required` — was removed on
  2026-11-12 at the client's request.) A late cancel is **invoiced**:
  `invoiceCancellationFee` (`src/lib/cancellation/fees.ts`) issues a Stripe
  invoice (`collection_method: 'send_invoice'`, due in `INVOICE_DAYS_UNTIL_DUE`
  = 7 days, one line from `feeInvoiceLine`), finalizes it, and stores
  `stripe_invoice_id` / `invoice_url` (Stripe's hosted page: pay by card,
  download the PDF) / `invoice_pdf` / `invoice_number` on the fee
  (`20261112000001`). The member is told with `cancellationFeeInvoice` (push +
  our email, linking the hosted page). **We don't call `sendInvoice`**: one
  email, in our template, and it arrives in test mode too, where Stripe mails
  nobody. The Stripe customer is `member_payment_methods.stripe_customer_id`
  (`src/lib/stripe/customers.ts`); that table's card columns are no longer
  written.
- **Who pays: whoever cancels** — the booker for a seat they drop, an invitee for
  their own. They're the one shown the fee before confirming.
- **What's exempt** (`seatCancellationQuote`): seats booked before
  `20261103000001` (`cancellation_policy_applies` false — added false, then
  defaulted true, so the RPCs set it without knowing), seats not in
  `FEE_BEARING_STATUSES` (an unconfirmed request, a cancelled/waitlisted row),
  and an unanswered invitation (the invite-expiry cron frees those for nothing).
  Only member-initiated cancels charge; admin deletes, the expiry cron, host
  takedowns and invitation declines never do.
- **Order**: the fee row is written *before* the seat is released, so a failed
  write refuses the cancel instead of letting it through free (unique per
  `booking_id` / registration: a double tap records one fee). A cancel that then
  fails discards it. Then the invoice, idempotency-keyed on the fee; the invoice
  id is written as soon as it exists so a retry picks the same one up. If Stripe
  can't be reached the fee is still `unpaid` and the member still told; **Pay
  invoice** on `/more/payments` (`POST /api/cancellation-fees/[id]/invoice`,
  `feeInvoiceUrl`) issues it then. Invoicing never fails the cancel.
- **Statuses**: `pending` (recorded, not invoiced yet), `unpaid` (invoiced or
  due one), `paid`, `waived`.
- **Webhook** `POST /api/webhooks/stripe` (signature-verified,
  `STRIPE_WEBHOOK_SECRET`): `invoice.paid` → `settleFeePaid` (marks it paid and
  sends the member `cancellationFeePaid`, a receipt, only on the delivery that
  moved it); `invoice.voided` → `settleFeeWaived` — **voiding the invoice in the
  Stripe dashboard is how an admin waives a fee** until there's an admin screen.
  `checkout.session.completed` / `payment_intent.succeeded` still settle fees
  from the card era.
- **No key, no policy.** `stripeEnabled()` (`src/lib/stripe/config.ts`) needs
  only `STRIPE_SECRET_KEY` — nothing runs Stripe in the browser any more
  (`@stripe/stripe-js` and `@stripe/react-stripe-js` were uninstalled). The
  `(app)` layout reads it on the server and hands it down through
  `CancellationPolicyProvider`; `useCancellationPolicyOn()` is what the confirm
  screen, the cancel dialog and `/more/payments` ask.
- Nothing blocks a member with an unpaid fee from booking again; the invoice
  and its due date are the whole of the collection.

### Push Notifications

- **Hook**: `usePushNotifications()` in `src/hooks/usePushNotifications.ts`
  - Handles browser permission request
  - Manages subscription via Service Worker
  - Stores endpoint/keys on server
- **VAPID keys**: Set in env (generate via `npm run generate-vapid`)
- **Service worker**: Next-PWA manages offline support; custom manifest at `/public/manifest.json`
- **Caching strategy**: API calls cached 24h, images cached 30d

### Validation & Input Handling

**Lightweight validators** in `src/lib/validation.ts` (no external deps):
- Email validation
- String length/format
- Date (YYYY-MM-DD)
- UUID
- Composite validators for bookings, referrals, messages
- `sanitiseText()`: HTML escape for safety

**Pattern**: Validate on route handler, return `{ valid: boolean, errors: string[] }`; return generic error messages to clients for security (e.g., "If that email is registered...").

### Rate Limiting

`src/lib/rateLimit.ts`: In-memory rate limiter by IP address. Used on auth endpoint (5 attempts per 15 minutes). Implement per route handler that needs it.

### Usage Tracking (member activity)

`member_activity_events` records who visits and acts in each area of the member
app, behind `/admin/analytics`. The registry in `src/lib/activity/areas.ts` is
the single source of truth — every action name, the area it belongs to, whether
it counts as a **view** (landed on an area) or an **action** (opened a specific
item, or changed state), and whether a client may emit it.

- **Client views**: `ActivityTracker` (mounted in `src/app/(app)/layout.tsx`)
  maps each pathname through `activityForPath()` and POSTs to `/api/activity`.
  `trackActivity()` (`src/lib/activity/track.ts`) is also called directly for
  in-page actions (an offer's CTA). Repeats collapse over a 5-minute window.
- **Server actions**: `logActivity()` (`src/lib/activity/log.ts`) is called from
  the route that performs the transaction — booking create/cancel, hosted-event
  registration, first DM to a member. Always `void`-ed: analytics must never
  fail or slow the request that produced it.
- The ingest route derives area and kind from the action name, and rejects
  actions flagged server-only — a member can't POST themselves a booking.
- The report reads three admin-only `SECURITY DEFINER` RPCs
  (`member_activity_rollup`, `activity_area_breakdown`, `activity_daily_totals`);
  the rollup left-joins from `members`, so members with no activity — the "who
  hasn't used the app" half — are in the result rather than missing from it.
- Admin routes are in their own route group and are never tracked; admins are
  excluded from the report by default.

Sign-ins (`signed_in`, area `session`) are recorded by both auth callbacks
alongside the existing `members.last_sign_in` stamp.

`20260901000001_seed_member_activity.sql` backfills from records the app
already had — `members.last_sign_in`, `bookings`, `hosted_event_registrations`,
and direct `conversations` — so the report isn't blank on day one. It seeds
**only** activity the live tracker also records, so no source dries up after
the backfill, and every seeded row carries `metadata.backfilled = true`. The
report's "live tracking since" date deliberately ignores those rows.

Adding a new tracked area means adding an entry to `ACTIVITY_ACTIONS` (and a
path case if it's a page view) — no migration, since `area` is free text
validated at the API boundary.

Charts use **Recharts** (`src/components/admin/ActivityCharts.tsx`) — the only
charting dependency in the project. Events and people are plotted as two
synced small multiples rather than one dual-axis chart, and the colours are
brand steps validated for colour-vision deficiency and surface contrast; the
file documents which is which.

### Curated Introductions (playing partner matching)

Admin-led, no AI, nothing automatic — `docs/playing-partner-matching.md` is the
full write-up. Members call it **Curated Introductions**; the code still says
"match". An admin opens **Admin → Matchmaking**, the app lists the players who
fit a member, and the admin chooses who to recommend, with a note.

- **Optional, switched on from More** (`/more/match-profile`, "Curated
  Introductions"): one switch, **Turn on Curated Introductions**, and the
  survey under it while it's on. Saving the survey is what turns it on the
  first time (`PUT /api/match-survey`); after that the switch is
  `PATCH /api/match-survey { enabled }`, which keeps the answers.
  `open_to_suggestions` now means "on", **both ways**: off takes a member out of
  other people's candidate lists, out of the admin queue, and
  `GET /api/recommendations` returns nothing for them. No row reads as off. The
  mandatory gate (`MatchSurveyGate`) was removed on 2026-11-12.
  `eligibleForIntroductions` (home course, active, membership tag) decides who
  is offered it. Questions and validation are one module,
  `src/lib/matching/survey.ts`; what they offer and seek is saved back onto
  `member_profiles`.
- **Wording is the client's** (2026-11-12): sections "Curated Introduction
  Preferences", "Describe your business", "Describe yourself as a golfer",
  "About you", "Preferred introductions". Objectives relabel old values:
  `hiring` = "Team Members", `get_mentorship` = "Mentors" (looking for one),
  `give_mentorship` = "Mentees" — mapped by meaning, so old answers keep theirs.
  The survey's industries (`SURVEY_INDUSTRIES`) drop "Business Owner / Founder"
  (a role — `ROLES`, "Founder / Owner / CEO") and replace "Other" with
  "Non-profit"; the app-wide `INDUSTRY_CATEGORIES` is unchanged.
  `20261112000002` moved founder picks to `meet_roles` / `role`.
- **Step 1 preferences rank, step 5 preferences filter.** Preferred industries
  and roles (blank = any) and ideal company size (`any`, or `SIZE_BUCKET` maps
  Solopreneurs and 2–10 to "1-10") are the `audience` weight. Gender, skill,
  attitude and the five habits are filters, checked both ways (`mutualFit`),
  and an unanswered counterpart question fails the filter. Gender is optional
  (no "Prefer not to say"), so a blank gender fits only "No preference". Skill
  is self-described (`skill`); a member who answered before it existed is read
  from their handicap (`skillOf`). `pairScore` is the geometric mean of both
  directions (`MATCH_WEIGHTS`). The admin can't override a preference:
  `POST /api/admin/matching/[memberId]` rebuilds the list and refuses any pick
  not on it, and refuses a member who has it off.
- **`member_match_profiles` has RLS on and no policies.** Gender, the smoke /
  music / booze answers and the preferences are read only through the service
  role, and shown only on the admin screen — never on a profile, never in a
  note or chip (`rules.ts` builds those from the business and golf answers
  alone, and a test pins it).
- **A recommendation is a `play_suggestions` row** with `recommended_by` and
  `note`; members may only read their own (`20261104000002` replaced the old
  for-all policy). Not now sets `dismissed` and keeps the pair off the list for
  `DISMISS_COOLDOWN_DAYS` (90) — a Not now from either side hides the pair.
  A pair sent either way stays listed but locked (`recommendedAt` /
  `suggestedAt`), and the send route refuses it. Sends notify both sides:
  `playSuggestion` / `playSuggestions` to the member, `recommendedToMember`
  to each recommended player.
- Member-side, everything reads one store, `useRecommendations()`: the
  Recommended for you cards, the member list's `SuggestedTag` (hover on a
  mouse, tap on touch, portalled because the list card clips), and the
  Suggested tab in both Add player flows on /book (`PlayerKind` "suggested"
  is a member everywhere downstream).
- The admin lists page by `MATCHING_PAGE_SIZE` (20): `?offset=&limit=` on
  both `/api/admin/matching` routes. The candidate list is scored whole and
  sliced, because ranking needs everyone.
- `members_played_with` (20260911000001) is the one "who has played with whom":
  the candidate list excludes everyone in it, and the member profile's
  `hasPlayedWith` badge now reads it (it read `play_history`, which nothing
  writes).

### Scheduled Jobs (Vercel Cron)

Configured in `vercel.json`:
- `/api/cron/booking-reminders`: every 15 minutes — fires push + SMS reminders 7 days, 3 days, and 6 hours before each booking's tee time
- `/api/cron/hosted-events-complete`: daily at 08:00 UTC — moves past-dated `upcoming` hosted events to `completed`
- `/api/cron/booking-surveys`: every 15 minutes — sends the post-round satisfaction survey push once a round has finished. Guarded by `bookings.survey_prompt_sent`. The in-app prompt (`useBookingSurvey`) fires on its own timer for members with the app open; this reaches everyone else.
- `/api/cron/booking-invite-expiry`: every 15 minutes — expires an added player's invitation nobody answered by 5 hours before tee time (venue timezone): `invite_status = 'expired'`, the row cancelled to free the seat, its GHL appointment cancelled, and the booker told. Rule in `src/lib/bookings/invitations.ts` (`inviteExpiresAt`); the invitation screen refuses a late answer on its own, so the cron only decides when the seat comes back.
- `/api/cron/hosted-event-proof-reminders`: every 5 minutes — pushes and emails the host 20 minutes after their round's tee time (venue timezone) asking for the proof photo. Guarded by `hosted_events.proof_reminder_sent` (`20261008000001`); skips a round that already has a proof, and a legacy row with no clock tee time is never reminded. Timing rule in `src/lib/hosts/proof-reminder.ts`.
- `/api/cron/ghl-member-sync`: daily at 06:00 UTC — full GHL → Supabase member reconcile (`runBulkGhlSync` in `src/lib/sync/bulk.ts`). Imports contacts that gained an access tag and deactivates members whose tag was removed. It's the backstop, not the only path: a member is also re-synced on login and on a GHL `contact.updated` webhook, and the admin **Sync from GHL** button (`POST /api/admin/sync`) runs the same full reconcile on demand.

- `/api/cron/credit-coupons`: daily at 07:00 UTC — reconciles open credit coupons against GHL (`syncCreditCoupons` in `src/lib/credits/coupons.ts`). Marks used codes spent, and voids ones that never reached GHL so their credit returns to the wallet. GHL doesn't notify us either way, and the in-app syncs only fire when someone opens their wallet or the admin list. Credit codes themselves don't expire (see `20260822000001_credit_coupons_no_expiry.sql`) — a member gets credit back by refunding a code, not by letting it lapse.

Verify request via `CRON_SECRET` env var to prevent unauthorized triggers.

`/api/cron/daily` (guest-membership expiry, Focus LinkUp notifications) and
`/api/cron/play-suggestions` (weekly play-partner suggestions) were removed —
they'd been dropped from `vercel.json`'s cron config (and were therefore no
longer running) without the route files or these docs being updated to
match. If that functionality is needed again, reintroduce it as a fresh
implementation rather than resurrecting the deleted routes as-is.

## Environment Variables

Required in `.env.local`:

```
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://...supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...

# Go High Level
GHL_API_KEY=...
GHL_LOCATION_ID=...
GHL_COMPANY_ID=...   (agency id; required to become a host — see Host provisioning)
GHL_WEBHOOK_SECRET=...

# App
NEXT_PUBLIC_APP_URL=https://app.linkup.golf

# Push notifications
NEXT_PUBLIC_VAPID_PUBLIC_KEY=...
VAPID_PRIVATE_KEY=...
VAPID_CONTACT_EMAIL=hello@linkup.golf

# Email notifications (Resend) — unset means the channel is off
RESEND_API_KEY=...
EMAIL_FROM=LinkUp Golf <notifications@linkup.golf>
EMAIL_REPLY_TO=hello@linkup.golf   (optional)
RESEND_WEBHOOK_SECRET=whsec_...    (bounce/complaint webhook; unset = nothing is learned)
EMAIL_UNSUBSCRIBE_SECRET=...       (optional; falls back to the service-role key)

# Stripe — cancellation policy (late-cancel invoices); unset = policy off
STRIPE_SECRET_KEY=sk_...
STRIPE_WEBHOOK_SECRET=whsec_...    (invoice.paid + invoice.voided; unset = webhook rejects everything)

# Cron security
CRON_SECRET=... (32+ random chars)
```

See `.env.local.example` for template.

## Development Patterns

### Creating a New Page

1. Add file to `src/app/(app)/path/page.tsx` (protected) or `src/app/path/page.tsx` (public)
2. Use `'use client'` if you need interactivity
3. Access auth/profile via `useProfile()` / `useUser()` in client components
4. Use `createServerComponentClient()` for data fetching in Server Components
5. Wrap in layout if needed (e.g., `layout.tsx` in same directory)

### API Route Template

Authenticated routes use the `withAuth()` HOC, which handles session, rate limit,
member lookup, admin, and live GHL membership validation, then supplies an
`AuthContext`:

```typescript
// src/app/api/path/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth/with-auth'
import type { AuthContext } from '@/lib/auth/types'

export const dynamic = 'force-dynamic'

export const POST = withAuth(async (req: NextRequest, ctx: AuthContext) => {
  const body = await req.json()

  // Validate
  const { valid, errors } = validatePayload(body)
  if (!valid) return NextResponse.json({ error: errors[0] }, { status: 400 })

  // ctx.memberId / ctx.userId / ctx.isAdmin are available (already authorized).
  // For admin-only routes, use withAdminAuth(...) or withAuth(handler, { requireAdmin: true }).

  // Execute (use the appropriate Supabase client; createAdminClient() only when needed)
  // ...

  return NextResponse.json(data)
})
```

### Updating Member Data

1. Mutate via an API route (RLS / `withAuth` validate access)
2. Refresh the client cache with `useProfile().refetch()` (silently re-fetches member + home course)
3. UI re-renders via React Context subscription

### Handling Auth State in Client Components

```typescript
'use client'
import { useProfile } from '@/hooks/useProfile'

export default function Component() {
  const { profile, loading } = useProfile()

  if (loading) return <Loading />
  if (!profile) return <Redirect to="/login" />

  return <div>{profile.first_name}</div>
}
```

## Styling & Theming

- **Tailwind**: Extended with LinkUp brand colors (greens, gold, cream)
- **Font variables**: `--font-lexend` (Lexend Deca) and `--font-caveat` (Caveat Brush), loaded via `next/font/local` in `src/app/layout.tsx`
- **CSS modules**: Not used; all styles via Tailwind classes
- **Dark mode**: Not configured (light theme only)

## Common Gotchas

1. **Never use admin client in client components**: It bypasses RLS and exposes service role key
2. **Rate limiting is in-memory**: Resets on server restart; consider Redis for production at scale
3. **Magic links expire**: Default Supabase expiry is 1 hour; check auth config
4. **VAPID keys are public/private pair**: Public key is `NEXT_PUBLIC_*`; private key is server-only
5. **GHL webhook secret must match**: Verifying webhook authenticity prevents unauthorized updates
6. **Service Worker caching**: If API changes structure, cached responses may be stale; consider cache-busting strategies

## Useful File Locations

- **Types**: `src/types/index.ts`
- **Auth context**: `src/contexts/AuthContext.tsx`, `src/contexts/ProfileContext.tsx`, `src/components/providers/SessionProvider.tsx`
- **API route auth HOC**: `src/lib/auth/with-auth.ts` (+ `ghl-validator.ts`, `types.ts`)
- **Client API helper**: `src/lib/api-client.ts`
- **Supabase clients**: `src/lib/supabase.ts` (browser), `src/lib/supabase-server.ts` (server/route/admin)
- **GHL API**: `src/lib/ghl/client.ts`, `src/lib/ghl/tags.ts` (`src/lib/ghl.ts` is a legacy shim)
- **Cancellation policy**: `src/lib/cancellation/policy.ts` (tiers, quotes, invoice line — pure), `src/lib/cancellation/fees.ts` (record → invoice → settle), `src/lib/stripe/client.ts` (server), `src/lib/stripe/config.ts` (is it on), `src/lib/stripe/customers.ts` (a member's Stripe customer), `src/components/providers/CancellationPolicyProvider.tsx`, `/more/payments`
- **Credit wallet**: `src/lib/credits/index.ts` (pure rules + loaders), `src/lib/credits/coupons.ts` (credit → GHL coupon), `src/lib/credits/redeem.ts` (manual fallback)
- **Payment options**: `src/lib/bookings/payment-options.ts` — `courses.payment_options` (`pay_now`, labelled **Pay on App** = the `payment_url` checkout, the column default; `pay_at_club`) and `bookings.payment_method = 'pay_at_club'`, which takes a round off the FIFO payment gate. Such a round reads **"Paying at club"** (`PAY_AT_CLUB_LABEL`, `settlingAtClub`) wherever it's labelled, member and admin alike — one label, because nothing in the app is ever told the club was paid, and a club-only round is created `payment_confirmed`, so a second "Paid at club" stage claimed the money had arrived before the member left the house. Where the venue takes both, the member chooses it via `POST /api/bookings/[id]/pay-at-club` (only once the status is `availability_confirmed`). Where it's the venue's **only** option there is nothing to choose, so `POST /api/bookings/create` writes it onto the rows at insert (`create_bookings_for_day` takes `payment_method` — see `20260926000001`) and the confirmation screen states it instead of offering a button. Such a round also opens at `PAY_AT_CLUB_BOOKING_STATUS` (`payment_confirmed`) rather than `NEW_BOOKING_STATUS`: there is no payment for the app to wait on, and left at `availability_confirmed` it would sit on the FIFO gate and outside the post-round survey forever. `POST /api/bookings/[id]/players` applies both to added guests (`add_players_to_booking` takes `payment_method` — see `20260926000002`). Two consequences are handled in place: the GHL bookings webhook ignores an `availability_confirmed` event on a pay-at-club row (it would move the round backwards and push "payment due" for money we aren't owed), and the admin bookings page counts revenue through `isLinkUpRevenue`, which excludes pay-at-club — that money goes to the club, not LinkUp. Hosting forms don't ask: a venue a host brings in is created on `HOST_DEFAULT_PAYMENT_OPTIONS` (pay at club), and listing a round at an existing venue leaves that venue's options alone. `courses.payment_url` is required **only** where Pay on App is offered — `requiresPaymentUrl` / `canTakePayment` in the same file are the one definition, read by the admin course form, `POST`/`PATCH /api/admin/courses`, course approval, and the four venue queries that decide what members see (`GET /api/courses`, `/api/bookings/availability`, `/api/bookings/playing`). A pay-at-club venue with no link is listed and bookable; a Pay on App venue without one can't be saved, approved, or shown
- **Non-member guests**: `src/lib/bookings/guest-policy.ts` — whether a venue takes them (`courses.allow_non_member_guests`, off by default) and how many one booking may bring (`courses.max_non_member_guests`, any whole number from 1, default 1, `20261104000001`). The admin venue form shows the number field only while the switch is on; the number is kept when it's switched off. Counted across the whole booking (`withinNonMemberGuestLimit`), so Add player counts the guests already seated. Both booking routes, the confirm screen, the Add player sheet and the admin booking drawer read `maxNonMemberGuests`. There's no ceiling of the app's own — the tee time's open spots still bound a booking as a whole; the course routes refuse a value that isn't a whole number ≥ 1 (`parseMaxNonMemberGuests`) rather than guess
- **Host provisioning**: `src/lib/hosts/provisioning.ts` — `POST /api/host/application` creates the member's GHL user **first** (`hosts.ghl_user_id`, needs `GHL_COMPANY_ID`) and returns 502 without touching the database if it can't, because everything after it is staffed by that account. The calendar of every venue they're granted is then created staffed by it rather than by `GHL_DEFAULT_ASSIGNEE_ID`, and `syncHostAvailability` writes a GHL availability schedule (`POST /calendars/schedules`, id kept on `host_venues.ghl_schedule_id`) narrowing the calendar to the tee times the host actually listed — without it a staffed calendar offers its user's default hours, every weekday all day. Both are best-effort, since the role and the rounds are already theirs. `POST /api/host/events` runs the same steps for a venue a host lists at later; editing or cancelling a round does **not** yet re-sync the schedule — less reachable now that the host UI offers neither (see Host events below), but `PATCH /api/host/events/[id]` still accepts both
- **Host events (host-facing)**: `src/app/(host)/host/events/page.tsx` — create only. A host cannot edit or cancel a listed round from the UI: members reserve against a date and tee time, and a round that moves under them is a promise the app breaks. `EventDrawer`'s `isEdit` path and `PATCH /api/host/events/[id]` are both intact, so restoring it is re-adding the buttons. Each row shows the roster as a stack of faces (`PlayerFaces`, tapping opens `RoundPlayersSheet`) rather than a count linking to a detail page — that page is gone; `enrichHostedEvents(..., { withPlayers: true })` supplies `HostedEvent.players`, opt-in because it names members and the member-facing endpoints don't get it. `players.length` is also the row's headcount (`n of total_spots`): it was `filled_spots + booked_spots`, which counts a member who both reserved and booked the venue twice. `filled_spots` stays what SQL enforces capacity against, so it isn't the display number. The roster is the guests — the host is **not** in it or in the count; that was tried (`source: 'host'` on the roster, resolved from `hosts.member_id`) and reverted, so the number beside a round is the people who came to it, not the people on it. `loadBookedAttendees` decides who counts with `playingMemberId`/`PLAYING_STATUSES` from `src/lib/bookings/players.ts` — shared with the member-facing "who's playing" list, which it used to contradict by reading only rows with no `guest_name` and so missing every member invited onto someone else's booking. A published round wears no status chip; `STATUS_META` is `Partial` and `upcoming` is deliberately absent.
  **Creating a round publishes it** (`newEventStatus` in `src/lib/hosts/events.ts`): at a venue whose course is already `active` the club is set up, the calendar exists and the dates came from that venue's own open days, so there was nothing for a review to decide and the round opens at `upcoming`. Only a club proposed through the "New LinkUp" tab opens at `pending_approval` — there the review is real work, and approving the venue releases the rounds attached to it. Admins hear either way, and which push they get is the difference between a queue item and news: `hostedEventNeedsReview` for the proposed venue, `hostedEventListed` for a round already in front of members. The host-facing copy follows the server rather than the tab ("Publish event", and the toast reads the created rows' status), and the "We'll notify you once it's done" line is gone — the chip says "Waiting on us" and nothing promises a notification.
  **Attendance**: once the round has run the roster sheet is also where the host records who came — the faces button sits to the **left** of the proof upload, because the two are one job (tick who played, send the photo of them) and the list is the half that comes first. `hosted_event_attendance` (`20261001000001`) holds one row per member marked present; absence is the absence of a row, so nobody is ever marked absent and a round nobody marked has no rows. `POST /api/host/events/[id]/attendance` takes the **whole set** (a replace, so a retry or a double tap lands on the same answer) and keeps only members on that round's roster, computed server-side — the host's screen isn't the authority on who was there. The window is `canMarkAttendance`, which is `canUploadProof`: both are things only the round can answer, and a checkbox the server would refuse is worse than no checkbox. `rosterFor` carries `attended` so the tick travels with the name
- **Naming a person in a list**: `nameOrEmail` in `src/lib/utils.ts` — their name title-cased where we hold one, their email address where we don't, `''` where we hold neither so the caller supplies its own last word. A member row can genuinely carry no name: a non-member guest is provisioned from an address and a phone number, and GHL will hold a contact whose first and last name are both blank. Every list of people printed "Member" for those, which is the one thing a list of people must not do — four rows reading "Member" are four people the reader can't tell apart. An address is never title-cased; it has to stay as it is to be recognised, which is why the callers no longer apply `titleCaseName` or a `capitalize` class on top. The address travels **only where it's the label**: `CalendarPlayer.email`, `MemberCard.email` / `BookedAttendee.email` / `EventPlayer.email` are set for a nameless member and absent for everyone else. `booker_name` on `GET /api/bookings` and in `pending-payment.ts` is resolved server-side the same way, so the client prints it as it comes
- **Host scheduling**: `src/lib/hosts/schedule.ts` — also `availabilityRules()`, which turns a host's rounds into the GHL schedule rules above (one rule per date, one interval per tee time, each one `GHL_CALENDAR_RULES.slotDuration` long). A round holds tee time → tee time + `courses.meeting_duration_mins`; two hosts may not hold overlapping blocks at one venue. Checked on host event create/edit, on hosted-event approval, and before a venue's calendar is created in `PATCH /api/admin/courses/[id]` (409 naming the clash)
- **Caching**: `src/lib/cache/index.ts`, `src/lib/cache/keys.ts`
- **Errors**: `src/lib/errors/app-error.ts`
- **Activity tracking**: `src/lib/activity/areas.ts` (registry + path map), `src/lib/activity/log.ts` (server), `src/lib/activity/track.ts` (client), `src/lib/activity/report.ts` (roster page sizes), `src/components/providers/ActivityTracker.tsx`, `src/components/admin/ActivityCharts.tsx`
- **Validation**: `src/lib/validation.ts`
- **Rate limiting**: `src/lib/rateLimit.ts`
- **Middleware**: `src/middleware.ts`
- **Utilities**: `src/lib/utils.ts`
- **Push notifications**: `src/hooks/usePushNotifications.ts`, `src/lib/push/pushService.ts`
- **Email notifications**: `src/lib/notify.ts` (both channels), `src/lib/email/template.ts` (the one layout, pure), `src/lib/email/send.ts` (recipients + absolute URLs + per-recipient unsubscribe), `src/lib/email/client.ts` (Resend, single + batch), `src/lib/email/suppression.ts` (who we've stopped mailing), `src/lib/email/unsubscribe.ts` (signed tokens, pure), `src/lib/email/webhook.ts` (Svix verification, pure). `POST /api/admin/email-test` runs the whole path and reports each stage
- **Announcement email audience**: `src/lib/announcements/recipients.ts` — `announcements.email_tags` / `email_member_ids` narrow **only the email**; the post and the in-app notification always go to the community. Both empty means **no email at all** — there is deliberately no "email everyone", since a broadcast to every address we hold is the send most likely to collect the bounces and complaints that cost us the sending domain, and the post plus the in-app notification already reached the community. Every row written before `20260930000002` reads as naming nobody, which is right for it: its email went out when it was published. Tags resolve inside the course's active members (a tag is a segment, and the post links to a feed only its members can open); members picked by name are honoured as picked. Read off the row rather than the request, because a post held for moderation is emailed when `PATCH /api/admin/announcements/[id]` publishes it, days later. `resolveEmailAudience` always returns a list, never null: `notifyCourse` / `notifyFocusMembers` read `{ emailMemberIds }` as "the same audience as the push" when it's undefined, so handing them null would mail the whole community — the one thing the picker exists to prevent. The admin form states what empty means where the admin can read it before publishing
- **Whose round a booking row is**: a booking has been one row per player since
  20260612 — the booker, each member added by name, each non-member guest — and
  `bookings.player_member_id` is what says whose seat a row is. It's the only
  link `GET /api/bookings` reads besides `member_id`
  (`.or(member_id.eq.<me>,player_member_id.eq.<me>)`), and the invited member's
  card is built from the sibling rows fetched alongside it (same booker, date,
  tee time and `created_at` — one statement, so one `now()`). A non-member guest
  is provisioned a GHL contact, the access tags and a member row at booking time
  (`src/lib/bookings/non-member-guest.ts`), so they can sign in — and used to
  open the app to no rounds at all, because their seat carried only
  `guest_name`. `provisionNonMemberGuest` now returns the member id and
  `linkGuestToMember` writes it onto that row (`is null` guarded: two seats
  naming the same new guest race through provisioning). `20261002000001`
  backfills every row it already created and adds `player_member_id =
  auth.uid()` to the bookings select policy, so being named on a row is its own
  reason to read it — a guest brought to a club they hold no membership at
  otherwise couldn't. A booking made *before* 20260612 is one row with
  `players = N` and no `additional_players`: nothing recorded who those people
  were, so there is no row to give them and nothing tries
- **Admin bookings layout**: a date heading, and under it one tree per tee
  time (`groupByTeeTime` in `src/app/(admin)/admin/bookings/page.tsx`): the
  time is the root, with no card around it, and each booking is a branch drawn
  as an unlabelled box
  (`groupBySlot`) — a solo booking is a box of one, a group booking keeps its
  players in one box, booker first. Nothing collapses. Trees run by tee date,
  latest first, then by tee time through the day; boxes in the order they were
  booked. **Move** is on every row but live only on a box's first, because it
  moves the whole group. Rows carry no status picker, payment reminder or price —
  the tee time's header holds the status counts and the total. The dates used to be ordered by whichever held the newest booking,
  which left them in no order at all
- **Booking lead time**: `src/lib/bookings/lead-time.ts` — inside `JOIN_ONLY_WINDOW_DAYS` (3: today, +1, +2) a venue-day with **no bookings** is closed, and one with any booking stays open to everyone. One booking is enough, since the first booking is what opens the day. An admin can also force a venue-day open by hand — **Open days** on `/admin/golf-events`, stored in `course_open_days` (`20261015000001`), `GET`/`PUT /api/admin/courses/[id]/open-days`. `loadForcedOpenDays` (in `src/lib/bookings/availability.ts`) feeds `dayIsBookable`'s `forcedOpen` at all three readers; it lifts only the window — the calendar still needs a tee time and the daily cap still applies — and an unreadable table opens nothing. Only a day inside the window can be opened. Read by `venueAvailabilityForMonth`, `coursesWithAvailabilityOn` and `POST /api/bookings/create` (which enforces it — a month left open in a browser goes stale). "Today" is the venue's own timezone; day arithmetic is on UTC midnights so a DST boundary can't round a day to zero. `openSpotsByDate` passes `joinOnlyWindowDays: 0` — a host listing a round IS the venue being asked, and members reserve against `hosted_event_registrations` rather than `bookings`, so there would never be a booking to satisfy it
- **Day occupancy / tee sheet**: `src/lib/bookings/occupancy.ts` — the month grid's day cell reads "3/12" (seats taken / seats the day holds, summed over the venues the day lists), replacing the old "1P"/"2Ps". **Below md it is drawn, not written**: a cell there is about a thumb wide with the date centred in it, so the fraction became a full-width bar across the top of the cell — `occupancyPercent` for the fill, `occupancyLevel` for the colour (open / busy from three quarters on / full). The digits stay where there's room for them: the cell from md up, the day's agenda card (which now carries "3/12 spots" beside the price), and the accessible label at every width. `bookedSpots` and `totalSpots` come from `CalendarOpening`; `totalSpots` is derived as booked + open because either the calendar's seats or `max_players_per_day` can be the smaller bound. `src/lib/bookings/tee-sheet.ts` arranges a day as venue → host → tee time → players, and `src/lib/bookings/venue-hosts.ts` resolves the host from the venue's GHL calendar (`teamMembers[isPrimary]`, via `pickCalendarAssignee`) — not from `host_venues`, which grants the right to list rounds rather than saying who is there. Name from `hosts.name` first, the GHL user second, no host row if neither. Delivered on `GET /api/bookings/availability`, which is already reading those calendars.
  **A full venue-day is listed, not dropped** — `openSpots: 0`, `openSlots: 0`, no `tees` — so the calendar can show that a round is happening and nobody can join it; a day with nothing open *and* nobody on it is still absent. `openingIsFull` is the one check, and every surface that offers a booking asks it: the agenda card (which opens the tee sheet instead of the booking sheet, and reads "Full"), the pinned dock, `openDayDetail` on /book, `nextOpeningForCourse` and `GET /api/courses/[id]/available-dates`. Within a day, bookable venues sort before full ones.
  **The list and the count are reconciled on purpose.** The cell counts seats held against the venue's cap (everything but `cancelled`/`waitlist`, which is what `create_bookings_for_day` enforces); the tee sheet can only name members whose round is going ahead (`PLAYING_STATUSES`) and never a non-member guest, who has no profile. `buildTeeSheet` takes the day's seats and reports `listedSeats` / `unnamedSeats`, and the sheet says the remainder out loud rather than leaving two numbers that disagree. `distinctPlayers` counts people, not rows — a member out twice is one member
- **Tests**: `src/__tests__/`, `vitest.config.ts`
- **DB migrations**: `supabase/migrations/`
- **Config**: `next.config.js`, `tailwind.config.ts`, `tsconfig.json`
- **PWA manifest**: `public/manifest.json`
- **Vercel cron config**: `vercel.json`
