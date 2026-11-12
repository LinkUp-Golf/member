# LinkUp Golf — Handover

This is the starting point for whoever takes over the LinkUp Golf member app, and for the AI coding tool they use with it. It covers what the app is, where it runs, every outside service it depends on, how to change and ship it, and what is unfinished.

Read in this order:

1. **This file.** The services, the environments, how to ship, and what's open.
2. **[`CLAUDE.md`](../CLAUDE.md).** The architecture and the rules each feature follows, in depth. AI tools read it automatically. It's long because the details matter.
3. **[`docs/code-map.md`](code-map.md).** Every page, API route, library file and migration, each with a one-line description. It's generated from the code (`npm run docs:map`).
4. **[`docs/decisions.md`](decisions.md).** Why things are the way they are, including the ambiguous requests and how each was read. Check here before "fixing" something that looks odd.
5. **[`docs/playing-partner-matching.md`](playing-partner-matching.md).** The full write-up of Curated Introductions.

Items marked **FILL IN** are facts that were not in the code or on the developer's machine when this was written. The person handing over should complete them.

---

## 1. What the app is

LinkUp Golf is a private golf-and-business-networking community. This repository is its member app: a Next.js progressive web app (installable from the browser, no app store) at **https://app.linkup.golf**.

Who uses it:

| Who | How they get in | What they do |
| --- | --- | --- |
| **Members** | A GoHighLevel (GHL) contact carrying a membership tag for a club (e.g. `avi member - active`, `member-active-SD`) | Book tee times at venues, invite players, message members, read announcements and offers, join member events and Focus LinkUps, turn on Curated Introductions, refer people |
| **Guests** | Brought onto a round by a member; the app creates their GHL contact with the `member-guest` tag | Sign in, answer their invitation, see their rounds |
| **Hosts** | Members approved through "Become a Host" | List rounds at venues (`/host`), mark attendance, upload proof photos, earn credit |
| **Referral partners** | Approved partners | Submit referrals, track conversions, earn monthly commission paid as credit (`/partner`) |
| **Admins** | `members.is_admin = true` | Everything under `/admin`: bookings, courses, members, hosts, partners, announcements, moderation, matchmaking, analytics, credits, reviews |

The main flows, each with its own section in `CLAUDE.md`:

- **Booking.** Venues are GHL calendars. A booking is one row per player. Rounds are paid through the venue's checkout link ("Pay on App"), at the club, or with credit codes. There's a first-in-first-out payment gate, a 3-day "join-only" window, and invitations that expire 5 hours before tee time.
- **Late cancellations.** These are invoiced through Stripe: free up to 2 days before, 50% the day before, 100% on the day.
- **Credit wallet.** Hosts and partners earn credit. It's spent as single-use GHL coupon codes at the venue's checkout.
- **Notifications.** Every notification goes out as a Web Push and an email (Resend).
- **Curated Introductions.** An optional survey. Admins hand-pick introductions on Admin → Matchmaking.

## 2. Where it runs

| Environment | URL | Hosting | Database | Notes |
| --- | --- | --- | --- | --- |
| **Production** | https://app.linkup.golf | Vercel, deployed from `main` | Supabase production project: **FILL IN** project ref | Real members. Vercel runs the crons in `vercel.json`. |
| **Development** | http://localhost:3000 | `npm run dev` | Supabase `linkupgolf-dev`, ref `jxmculznmsmyfxiaehqa` | Contains test data, including synthetic survey answers for about 66 members, seeded 2026-11-05 to test matchmaking. Never copy dev data to production. |
| **Preview** | **FILL IN** (Vercel preview URLs, if enabled) | Vercel | **FILL IN** which Supabase project previews use | |

**Branches.**
- Work happens on `develop`. Releases are a pull request from `develop` into `main` (PRs #43–#47 so far), and merging to `main` deploys production.
- **FILL IN:** confirm the production branch in Vercel → Project → Settings → Git.
- There is no CI. Run `npm run lint`, `npm test` and `npm run build` before pushing.

**The repository.** `github.com/LinkUp-Golf/member` (the remote may be configured as `git@github-linkup-golf:LinkUp-Golf/member.git`, an SSH host alias on the previous developer's machine).

## 3. Outside services

Every service the code talks to, what it's for, and what has to be set up in that service's own dashboard. The secrets themselves never go in this repo; see section 4 for the variable names.

| Service | Used for | Code | Dashboard setup the app depends on | If it's not configured |
| --- | --- | --- | --- | --- |
| **Vercel** | Hosting, crons, environment variables, the feature-flag toolbar | `vercel.json`, `src/flags.ts`, `src/app/.well-known/vercel/flags` | Production domain `app.linkup.golf`. Every env var in section 4, per environment. Crons run from `vercel.json` with `CRON_SECRET`. | — |
| **Supabase** | Postgres with row-level security, auth (magic-link sign-in), realtime (messages, presence, typing, notification bell), storage (buckets `avatars` and `post-media`) | `src/lib/supabase*.ts`, `supabase/migrations/` (129 files) | **Auth:** Site URL `https://app.linkup.golf`, and the redirect allow-list must include `https://app.linkup.golf/api/auth/callback` (and `http://localhost:3000/api/auth/callback` for dev). The magic-link email template and SMTP sender are set here, because Supabase sends the sign-in email, not GHL. **Storage:** both buckets must exist. **Realtime:** enabled on the messaging tables. | Nothing works |
| **GoHighLevel (GHL)**, also called LeadConnector | The CRM the business runs on. It decides who may use the app, what tee times exist, and whether a round is confirmed and paid. It also holds coupons (credit codes), one GHL user per host, and the reminder workflows. **Section 3.1 has the full split between GHL and the app.** | `src/lib/ghl/` (`client.ts`, `tags.ts`, `coupons.ts`), `src/lib/sync/` | A private integration API key for the location (`GHL_API_KEY`), the location id and agency id. Two incoming webhooks, two reminder workflows, a calendar per venue and the access tags: all listed in section 3.1. | Nobody can sign in, and nothing can be booked |
| **Stripe** | Invoicing late-cancellation fees (server only). Setup in section 3.2 | `src/lib/stripe/`, `src/lib/cancellation/` | Webhook endpoint `https://app.linkup.golf/api/webhooks/stripe` with events `invoice.paid` and `invoice.voided`, plus `checkout.session.completed` and `payment_intent.succeeded` for fees from before invoicing. Voiding an invoice in the dashboard is how a fee is waived. | No fee is stated or charged |
| **Resend** | The email half of every notification | `src/lib/email/`, `src/lib/notify.ts` | Sending domain verified in DNS (sender `EMAIL_FROM`). Webhook to `POST /api/webhooks/resend` for `email.bounced` and `email.complained`: bounces, complaints and unsubscribes go on a suppression list. | Email is skipped, push still sends |
| **Web Push** (VAPID) | Push notifications to installed apps | `src/lib/push.ts`, `src/lib/push/`, `src/hooks/usePushNotifications.ts`, `worker/`, `public/sw-custom.js` | No account. A key pair made with `npm run generate-vapid`. Changing the keys invalidates every existing push subscription. | No push |
| **Upstash Redis** (optional) | Shared cache across server instances | `src/lib/cache/` | A Redis database (REST URL and token) | Falls back to an in-memory cache per instance |
| **DNS / domain** `linkup.golf` | `app.` points to Vercel; email DNS for Resend | — | **FILL IN** the registrar and DNS host | — |

Other domains that appear in the code are not services of their own. `linkupgolf-services.com` hosts the GHL checkout pages where rounds are paid for (one per venue, stored as `courses.payment_url` and set by admins); see section 3.1. `maps.google.com` is only used for links.

### 3.1 GoHighLevel: what it decides, and what the app decides

GHL isn't only the membership list. Several things are decided in GHL, and the app reads them live instead of keeping its own copy. If you change one of them in GHL, the app follows. If you change it only in the app's database, GHL overwrites it on the next sync or never hears about it.

**GHL is the source of truth for these:**

| What | Where it lives in GHL | How it reaches the app | Code |
| --- | --- | --- | --- |
| **Who can sign in, and as what** | The contact, and its tags. Access tags: `avi member`, `avi member - active`, `member-active-SD`, `nbd client` (members) and `member-guest` (a guest a member brought). Role tags: `host`, `referral-partner`. | Anyone with a GHL contact can sign in. Without an access or role tag they're a guest with limited access. Tags are read at sign-in, on the contact webhook, and in the nightly reconcile (06:00 UTC). Every signed-in API request also re-checks the contact against GHL, cached for 15 minutes; a deleted contact is signed out. Removing a tag in GHL is how membership ends. | `src/lib/ghl/tags.ts`, `src/lib/sync/`, `src/lib/auth/ghl-validator.ts` |
| **Name, email, phone, business name, job title, LinkedIn, nonprofits** | Contact fields, and the custom fields `company_name`, `title`, `linkedin`, `nonprofits` | The same sync. Where GHL has a value it wins. Where GHL is blank, the value the member typed in the app is kept. | `src/lib/sync/member.sync.ts`, `src/lib/sync/profile.sync.ts` |
| **Which tee times exist, and how many seats each has** | Each venue's GHL calendar (`courses.ghl_calendar_id`): its hours, slot length, seats per slot, minimum notice and how far ahead it books | Read from the calendar's free slots whenever /book shows availability, cached for 30 minutes, so a change made in GHL can take that long to show. The app has no tee-time table of its own. | `src/lib/bookings/availability.ts`, `getAvailableSlots` in `src/lib/ghl/client.ts` |
| **Who hosts a venue on a given day** | The calendar's primary team member | Read off the calendar for the day's tee sheet | `src/lib/bookings/venue-hosts.ts` |
| **Whether a round is confirmed, and whether it's paid** | The booking pipeline: opportunity stages such as Availability Confirmed and Payment Confirmed | GHL workflows call `POST /api/webhooks/ghl/bookings` when a stage changes, and that call is the only way the app learns a round was paid | `src/app/api/webhooks/ghl/bookings/route.ts` |
| **Paying for a round** | The venue's GHL checkout page (`courses.payment_url`, on `linkupgolf-services.com`). Credit coupon codes are entered here. | The app only links to it. Payment comes back through the pipeline webhook above. | `src/lib/bookings/payment-options.ts` |
| **Whether a credit code was used** | GHL coupons (Payments → Coupons), every code starting `LUC` | Reconciled daily at 07:00 UTC, and whenever a member opens their wallet or an admin opens the credits list | `src/lib/ghl/coupons.ts`, `src/lib/credits/coupons.ts` |
| **Booking-reminder and payment-reminder messages** | Two GHL workflows, each started by an inbound-webhook URL | The app calls the URL (the reminder cron, 7 days, 3 days and 6 hours before a round; the admin's Remind button). GHL writes and sends the email and SMS. | `triggerBookingReminderWebhook`, `triggerPaymentReminderWebhook` |

**The app is the source of truth for everything else.** That covers:
- Who sits in which seat of a booking, its invitations and their answers.
- Hosted rounds and their registrations: those seats never touch a GHL calendar.
- Messages, announcements, credit balances and late-cancellation fees (with Stripe).
- Curated Introductions, and the parts of a profile members edit themselves.
- `is_admin`, which is a column in the database, not a GHL tag.

**The app adds its own rules on top of a GHL calendar.** These live only in the app:
- **Custom slots:** for a venue with `courses.custom_slots_enabled`, an admin can curate a date's tee times and seats in the app, starting from the calendar's own (`course_custom_slots`, `/api/admin/courses/[id]/slots`). The curated list replaces the calendar for that date only.
- **Booking limits:** the daily player cap (`max_players_per_day`), the 3-day join-only window, forced open days, and the limit on non-member guests.

**What the app writes into GHL:**
- **Appointments:** one per player on the venue's calendar when a round is booked. The booker's appointment must succeed or the booking fails; the others are best-effort. Cancelling a seat cancels its appointment, an admin's Move reschedules it, and deleting a booking deletes it. The app doesn't create opportunities: GHL's own pipeline automation creates them from the appointment.
- **Contacts and tags:**
  - A non-member guest added to a round gets a contact with the `member-guest` tag.
  - A referral prospect becomes a lead contact.
  - Admins can add or remove a tag across many members at once (`/api/admin/members/bulk-tags`).
- **Calendars:** created when an admin sets up a venue or a host is approved. They're built with the fixed rules in `GHL_CALENDAR_RULES`, plus the booking form and calendar group ids in `src/lib/constants.ts`.
- **Users and schedules:** each host gets a GHL user (needs `GHL_COMPANY_ID`) who staffs their venue calendars. An availability schedule narrows each calendar to the tee times that host listed.
- **Coupons:** spending credit creates a single-use coupon. Refunding the code deletes it.
- **Media:** an approved host proof photo is copied into the GHL media library.

**What has to be set up inside GHL, by hand:**
1. **Contact webhook → `POST https://app.linkup.golf/api/webhooks/ghl`**, signed with `GHL_WEBHOOK_SECRET` (header `x-ghl-signature`), for `contact.created`, `contact.updated`, `contact.tag.added` and `contact.tag.removed`. Without it, a tag change reaches the app only at the member's next sign-in or the nightly reconcile.
2. **Booking pipeline workflows → `POST https://app.linkup.golf/api/webhooks/ghl/bookings`.** Set up one workflow per event (`availability_confirmed`, `payment_confirmed`, `cancelled`, `deleted`). Each uses an HTTP action with the header `x-linkup-secret: <GHL_BOOKING_WEBHOOK_SECRET>` and the body `{"event": "<that event>", "ghlBookingId": "{{appointment.id}}"}`. Without these, rounds never move past their first status and paid rounds look unpaid. Step-by-step setup is in the header comment of that route.
3. **The two reminder workflows.** Their inbound-webhook paths are hard-coded in `src/lib/constants.ts` (`GHL_BOOKING_REMINDER_WEBHOOK_PATH`, `GHL_PAYMENT_REMINDER_WEBHOOK_PATH`). If either workflow is deleted or rebuilt, its messages stop with no error until the new path is pasted in. A third, for emailing a host when an admin takes their round down (`GHL_HOSTED_EVENT_TAKEDOWN_WEBHOOK_PATH`), was never built; until it is, the host gets only the push.
4. **A calendar per venue,** linked on the venue's admin page. Changing a calendar's hours or seats in GHL changes what members can book.
5. **The access tags,** spelled as in `src/lib/ghl/tags.ts` (case doesn't matter). A new club or community means a new row in that file, and a member whose tag isn't listed there is only a guest.

**Other GHL ids hard-coded in `src/lib/constants.ts`:**
- The fallback staff user (`GHL_DEFAULT_ASSIGNEE_ID`).
- The calendar group and booking form used for new calendars.
- The contact and opportunity custom-field ids.
- The address shown on every calendar (Aviara).

Moving to a different GHL sub-account means changing all of these, plus the API key and location id, every venue's calendar id, both webhooks, the workflows and the tags.

**In the code but not doing anything:**
- **The `GHL_WORKFLOW_*` variables:** they fill a `GHL_WORKFLOWS` map that nothing reads, so the app never starts a workflow by id. If welcome, booking-confirmation, referral or Focus LinkUp messages go out, GHL's own triggers start them.
- **`GHL_AVI_PLAY_CANCELLED_STAGE_ID`:** a member's cancel would move the opportunity to this stage, but only when the booking row holds `ghl_opportunity_id`, and nothing ever writes that column. GHL's own automation has to react to the cancelled appointment instead.
- **Unused functions in `src/lib/ghl/client.ts`:** `sendSms`, `triggerWorkflow`, `createOpportunity`, `chargeForBooking`, `getContactBookings` and `createCalendarGroup`.

### 3.2 Stripe: what a late-cancellation invoice needs

**How it works.**
1. A member cancels late, and the app records the fee.
2. Through the API, the app creates a Stripe customer for the member (once), an invoice item and an invoice, and finalizes the invoice. The invoice is due in 7 days.
3. The app emails the member in its own template, with a link to Stripe's hosted invoice page, where they pay by card or download the PDF. The app doesn't ask Stripe to send its own email.
4. When the member pays, Stripe calls the app's webhook, and the app marks the fee paid and emails a receipt.

Nothing needs creating in Stripe beforehand: no products, prices or invoice templates.

**What has to be set up:**
1. **`STRIPE_SECRET_KEY`.** This alone switches the policy on: fees are stated, recorded and invoiced. Use a live key in production, which needs an activated Stripe account (business details and a bank account for payouts).
2. **The webhook. Without it, nothing is ever marked paid.** In Stripe → Developers → Webhooks, add the endpoint `https://app.linkup.golf/api/webhooks/stripe` with the events `invoice.paid` and `invoice.voided`, plus `checkout.session.completed` and `payment_intent.succeeded` for fees from before invoicing. Put its signing secret in `STRIPE_WEBHOOK_SECRET`. If either is missing, the member can still pay, but the fee stays unpaid in the app and no receipt goes out.
3. **The database update `20261112000001_cancellation_invoices.sql`,** applied before the code is deployed.
4. **What the member sees on the invoice page and PDF.** In Settings → Business: the public business name, address and support email. In Settings → Branding: the logo and colours. Without these, the page is plain but still works.
5. **Card payments enabled for invoices** (Settings → Payments → Payment methods). Card is on by default.

**Worth checking in Stripe's email settings** (Settings → Customer emails). The app sends its own invoice and receipt emails, so with Stripe's "successful payments" receipts turned on, a member gets two receipts. Stripe's reminders for overdue invoices are optional, and the app sends none of its own.

**Waiving a fee:** void the invoice in the Stripe dashboard. The `invoice.voided` event marks the fee waived.

**Testing locally:** use a test key (`sk_test_…`). Stripe can't reach localhost, so run `stripe listen --forward-to localhost:3000/api/webhooks/stripe` (Stripe CLI) and use the signing secret it prints as `STRIPE_WEBHOOK_SECRET`. In test mode, pay the invoice with card `4242 4242 4242 4242`.

## 4. Environment variables

The template is [`.env.local.example`](../.env.local.example). Locally they go in `.env.local`, which git ignores. In production they're set in Vercel. **FILL IN** where the production values are kept for handover; share them through a password manager, never in the repo or chat.

| Variable | Required | What it is |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | Supabase project URL and public anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Bypasses row-level security. Server-only, never in client code |
| `NEXT_PUBLIC_APP_URL` | Yes | `https://app.linkup.golf`. Used for absolute links in email and Stripe |
| `GHL_API_KEY`, `GHL_LOCATION_ID` | Yes | GHL private integration key and sub-account (location) |
| `GHL_COMPANY_ID` | For hosts | GHL agency id. Needed to create a GHL user when someone becomes a host |
| `GHL_AVIARA_CALENDAR_ID`, `GHL_AVIARA_CALENDAR_USER_ID` | Yes | Fallback calendar for the original venue (Aviara) |
| `GHL_WEBHOOK_SECRET` | Yes | Verifies `POST /api/webhooks/ghl` |
| `GHL_BOOKING_WEBHOOK_SECRET` | Yes | Verifies `POST /api/webhooks/ghl/bookings` (`x-linkup-secret` header) |
| `GHL_AVI_PLAY_CANCELLED_STAGE_ID` | No | Read, but has no effect: see "not doing anything" in section 3.1 |
| `GHL_WORKFLOW_MAGIC_LINK`, `GHL_WORKFLOW_WELCOME`, `GHL_WORKFLOW_REFERRAL`, `GHL_WORKFLOW_BOOKING_CONFIRM`, `GHL_WORKFLOW_FOCUS_2W`, `GHL_WORKFLOW_FOCUS_1W` | No | Read into a map that nothing uses. The app never starts these workflows (section 3.1) |
| `GHL_AVI_PLAY_PIPELINE_ID`, `GHL_AVI_PLAY_TENTATIVE_STAGE_ID` | No | In the template but not read by any code |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_CONTACT_EMAIL` | Yes | Web Push key pair and contact |
| `RESEND_API_KEY`, `EMAIL_FROM` | For email | Resend key and sender. Unset turns email off |
| `EMAIL_REPLY_TO` | Optional | Reply-to address |
| `RESEND_WEBHOOK_SECRET` | For email | Verifies `POST /api/webhooks/resend` (Svix signature) |
| `EMAIL_UNSUBSCRIBE_SECRET` | Optional | Signs unsubscribe links; falls back to the service-role key |
| `STRIPE_SECRET_KEY` | For fees | Turns the cancellation policy on. Unset means no fees |
| `STRIPE_WEBHOOK_SECRET` | For fees | Verifies `POST /api/webhooks/stripe` |
| `CRON_SECRET` | Yes | Vercel sends it to every cron route; 32+ random characters |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | Optional | Shared cache |
| `FLAGS_SECRET` | Optional | Encrypts Vercel-toolbar flag overrides |
| `NEXT_PUBLIC_FEATURE_FOCUS_LINKUPS` | Optional | `false` hides Focus LinkUps |
| `LOG_LEVEL` | Optional | `debug` / `info` / `warn` / `error` |
| `NEXT_PUBLIC_MOCK` | Dev only | `false` uses the real APIs locally. Mocking is **on** in development unless this says `false` |

Not every setting is an environment variable. GHL ids, the Aviara address and timezone, and calendar defaults are constants in `src/lib/constants.ts`. Changing GHL sub-account means changing them there too.

`STRIPE_PUBLISHABLE_KEY` (and the older `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`) is no longer used. Nothing runs Stripe in the browser any more, so it can be deleted from Vercel.

## 5. Working on it

**Run it locally.**

```bash
npm install
cp .env.local.example .env.local   # then fill in, pointing at the dev Supabase project
npm run dev                        # http://localhost:3000
```

Signing in for real needs `NEXT_PUBLIC_MOCK=false`, plus a GHL contact with an access tag whose email you can receive. With mocking on, `src/components/dev/MockProvider.tsx` and `src/mocks/` stand in for the session and the API.

**Check before pushing.** There's no CI, so this is the only check.

```bash
npm run lint && npm test && npm run build
```

**Database changes.**
- Make one with `npm run db:migration <name>`. Files are `supabase/migrations/YYYYMMDDHHMMSS_name.sql`.
- Start each with a comment saying why. Keep them additive. Don't edit a migration that has already been applied; write a new one.
- `npm run db:push` applies pending migrations to whichever project the Supabase CLI is linked to. Check with `supabase projects list` (the linked one is marked) before pushing.
- To ship a change: link production (`supabase link --project-ref <prod ref>`), push, then link dev again.
- **Apply a migration to production before merging the code that reads it.** Otherwise the deployed code queries columns that don't exist yet.
- New tables get row-level security. Server routes use the service-role client only behind `withAuth` / `withAdminAuth`, a webhook signature, or `CRON_SECRET`.

**Ship.**
1. Push `develop`.
2. Open a PR from `develop` into `main`.
3. Apply that release's migrations to production.
4. Merge. Vercel deploys.

Then do any dashboard steps the commit messages list (webhook events, env vars). Each feature commit's message ends with what has to happen before deploying.

**Scheduled jobs.** These are listed in `vercel.json` and described in `CLAUDE.md` → Scheduled Jobs: booking reminders, invite expiry, post-round surveys, host proof reminders, hosted-event completion, credit-coupon reconcile, nightly GHL member sync. To run one by hand: `curl -H "Authorization: Bearer $CRON_SECRET" https://app.linkup.golf/api/cron/<name>`.

**Admin tools worth knowing.**
- **Sync from GHL** on the admin members page re-runs the full member reconcile.
- `POST /api/admin/email-test` traces why an email didn't arrive.
- **Open days** on Admin → Courses forces a venue-day open inside the 3-day window.

**Weekly client report.** The previous developer sent the client a plain-English "What's New" every week. The format and procedure are in `.claude/skills/weekly-release-report/SKILL.md`, which Claude Code runs as `/weekly-release-report`.

**Keeping the docs true.** When a feature changes, update its section in `CLAUDE.md`, add to `docs/decisions.md` if the change rests on a judgment call, and rerun `npm run docs:map`. The code map only knows what each file's header comment says, so give new files one.

## 6. State at handover (2026-11-12)

**On `develop`, not yet on `main`:**
- `bf72529` invoices late-cancellation fees instead of charging a card on file.
- `8c3bbc0` makes the survey the optional Curated Introductions, with the client's new wording.

Before that release goes live:
- Apply `20261112000001_cancellation_invoices.sql` and `20261112000002_curated_introductions.sql`, on dev and on production.
- Add `invoice.paid` and `invoice.voided` to the Stripe webhook.
- Delete `STRIPE_PUBLISHABLE_KEY` from Vercel.

**Not yet checked in a browser:** the invoice flow end to end (cancel → email → pay on Stripe → marked paid) and the Curated Introductions page. Both pass type-checks and the unit tests, and the Stripe invoice calls were exercised against Stripe's test mode.

**Production migration status: FILL IN.** Run `supabase migration list` against production to see which of the 129 migrations it has.

## 7. Open questions and known gaps

**Waiting on the client.** Each was settled with a default that can be reversed. See `docs/decisions.md`.
- Curated Introductions:
  - "Mentors" / "Mentees" were mapped by meaning: "Mentors" means looking for a mentor.
  - "Other" became a "Non-profit" industry.
  - An optional "Your role" question was added.
  - The Golf Skill answers keep the client's "…golfers only" wording, even though they describe the member.
  - Matching stays within the member's home club.
- Cancellation fees:
  - An unpaid fee does not stop a member booking again.
  - The client's request cut off at "ensure that once the payment was received". It was read as: mark it paid and send a receipt.
  - There is no admin screen for fees; Stripe's dashboard is the view.

**Known gaps in the code:**
- **Host names stored escaped.** Names and descriptions entered through the host application are HTML-escaped on save, so they show as `Fritz&#x27;s Golf`. The fix is to stop escaping on save, plus a migration to unescape the existing rows.
- **Hosted rounds have no GHL calendar of their own.** Editing or cancelling one doesn't re-sync the host's GHL availability schedule. The host screens no longer offer edit or cancel, but `PATCH /api/host/events/[id]` still accepts both.
- **`/api/host/bookings`** offers any member's booking at any course to a host, with no venue filter.
- **Pay-at-club rounds** that an admin never moves to a paid status never get the post-round survey.
- **Rate limiting is in memory.** It resets on every deploy and isn't shared between instances. `withAuth`'s `rateLimit` option is declared but ignored: every route shares 120 requests a minute per member.
- **Unused dependencies:** `zustand` and `@vercel/edge-config`. `src/lib/ghl.ts` and `src/lib/ghl-tags.ts` are re-export shims for old imports.
- **Single community.** Guests are mapped to the one community there is (Aviara / San Diego). A second community needs its tags added in `src/lib/ghl/tags.ts`.

## 8. Handing over access

Tick these off. Afterwards, rotate every secret the previous developer could see.

- [ ] GitHub: the `LinkUp-Golf` organisation and the `member` repository
- [ ] Vercel: the team and the project, including its environment variables
- [ ] Supabase: the organisation, with the production and `linkupgolf-dev` projects
- [ ] GoHighLevel: the agency and the sub-account; regenerate the private integration key
- [ ] Stripe: the account; roll the secret key and the webhook signing secret
- [ ] Resend: the account and the verified domain
- [ ] Upstash: the Redis database, if one is in use
- [ ] The `linkup.golf` domain registrar and DNS
- [ ] After transfer, rotate `CRON_SECRET`, `GHL_WEBHOOK_SECRET`, `GHL_BOOKING_WEBHOOK_SECRET`, `RESEND_WEBHOOK_SECRET`, `STRIPE_WEBHOOK_SECRET`, `FLAGS_SECRET` and `EMAIL_UNSUBSCRIBE_SECRET`, updating the matching webhook settings in GHL, Stripe and Resend. Rotating the Supabase service-role key or the VAPID keys has wider effects: new VAPID keys sign everyone out of push.

## 9. Rules for changing the code with an AI

These hold the app together. Most bugs fixed so far broke one of them.

1. **GHL decides who is a member.** Membership is a GHL contact tag. Supabase mirrors it through the sign-in sync, the GHL webhook and the nightly reconcile. Don't make membership editable in Supabase alone.
2. **Never use the service-role client in client code.** Client components fetch through API routes. API routes use `withAuth()` / `withAdminAuth()`.
3. **Notifications go through `notify*`** (`src/lib/notify.ts`), which sends push and email together and never throws. Call it without awaiting (`void notifyMember(...)`). Every notification is defined once in `NotificationTemplates` (`src/lib/push.ts`).
4. **One rule per concept, in one pure module.** The pure modules and their tests are the spec:
   - cancellation tiers: `src/lib/cancellation/policy.ts`
   - payment options: `src/lib/bookings/payment-options.ts`
   - guest limits: `src/lib/bookings/guest-policy.ts`
   - the 3-day window: `src/lib/bookings/lead-time.ts`
   - matching: `src/lib/matching/rules.ts`

   Screens and routes import these rather than repeating the logic.
5. **A booking is one row per player.** `player_member_id` says whose seat a row is. Hosted rounds are counted in `hosted_event_registrations`, never written as `bookings` rows, or the same seats get sold twice.
6. **Write the reason down.** Comments in this codebase explain why, not what. Keep that up. It is how the next person, or the next AI session, avoids undoing a deliberate choice.
7. **Run lint, tests and the build before pushing.** There is no CI to catch it later.
