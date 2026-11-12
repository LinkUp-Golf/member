# Decisions

Why the app works the way it does, where the code alone doesn't say. Most entries answer an ambiguous request or settle a trade-off, and some look like bugs until you know the reason. Before changing one, check whether its reason still holds.

Each entry gives the date, who decided (**client** means the LinkUp Golf owner; **default** means a developer's call, flagged at the time and never confirmed), and the decision. Newest areas first.

## Cancellation fees

- **2026-11-12 · client. Invoices, not a card on file.** The client asked to stop collecting card details. A late cancellation is issued as a Stripe invoice, due in 7 days, and the member pays on Stripe's invoice page. The card-on-file version (a card saved at booking and charged automatically) existed from 2026-11-03 to 2026-11-12 and was removed whole.
- **2026-11-12 · default. "Once the payment was received."** The client's message cut off after these words. They were read as: mark the fee paid, and send the member a receipt (`cancellationFeePaid`). If the intent was something else, such as holding the seat until it's paid, that's a different design.
- **2026-11-12 · default. Our email, not Stripe's.** The app sends its own email linking Stripe's invoice page, and doesn't call Stripe's `sendInvoice`. That keeps it to one message in the app's template, and it also arrives in Stripe test mode, where Stripe emails nobody.
- **2026-11-12 · default. An unpaid fee doesn't block booking.** The invoice and its due date are the whole of the collection.
- **2026-11-12 · default. Voiding the invoice in Stripe waives the fee.** It's the only waive path until there's an admin fee screen.
- **2026-11-03 · client. Tiers.** Free up to 2 days before; 50% the day before; 100% on the day. These are percentages of each seat's own price, so a new event at a new price needs no setup.
- **2026-11-03 · client. Already-paid rounds are ignored.** "Payment is paid to the shop as of now." Nothing refunds or credits a paid round that's cancelled.
- **2026-11-03 · default.** The person who cancels pays. Seats booked before the policy existed are exempt. Unanswered invitations and unconfirmed requests are free to cancel. "Day" is the venue's calendar day, not a 24-hour count.

## Curated Introductions (matching)

- **2026-11-04 · client. Admin-led, no AI.** An admin picks every introduction; the app only lists and ranks candidates. Asked whether AI would help, the answer given was: the rules are enough for now, and AI would only add something for the free-text "what you offer / seek" fit.
- **2026-11-12 · client. Optional, switched on from More.** The survey had been mandatory, a full-screen gate. It's now "Curated Introductions" under More, with a switch. Off means out both ways (default): the member isn't introduced to anyone and isn't suggested to anyone.
- **2026-11-12 · client. The wording is the client's.** Section titles, "Objectives", "Team Members", "Preferred industries", "Organization size", "Solopreneurs", "Golf Skill", "Tell us about yourself", "Preferred introductions", "Turn on Curated Introductions". Keep it exact.
- **2026-11-12 · default. Mentors / Mentees mapped by meaning.** The client wrote "Give mentorship → Mentors, Get mentorship → Mentees". Under "Objectives" (what you want), "Mentors" means *looking for* a mentor, which is the old `get_mentorship`. So "Mentors" is stored as `get_mentorship`, and older answers keep their meaning.
- **2026-11-12 · client. "Business Owner / Founder" is a role, not an industry.** It's gone from the survey's industry list and is now "Founder / Owner / CEO" in a new role list. The database update moved existing picks across. The app-wide industry list on profiles is unchanged (default), so it may still need cleaning up.
- **2026-11-12 · default. "Other" became a "Non-profit" industry.** This was the reading of the client's note "Preferred industries ['Other'] → Add non-profits".
- **2026-11-12 · default. An optional "Your role" question was added**, so that "Preferred roles" has something to be checked against.
- **2026-11-12 · default. Golf Skill keeps "…golfers only".** The client's options ("Excellent golfer - Low handicap golfers only") describe the member, so "only" reads oddly. They were kept verbatim and the oddity was flagged.
- **2026-11-12 · default. Step 1 preferences rank; preferred introductions filter.** Preferred industries, roles and ideal company size only order the list. Gender, skill, attitude and the smoke / music / booze answers rule people out, checked both ways.
- **2026-11-04 · default.** Matching stays within the member's home club. Both sides are told about an introduction. A pair either side dismissed with Not now stays off the list for 90 days.
- **Privacy, by design.** Gender, habits and preferences are readable only through the service role and shown only to admins, never in a note or a chip. A test enforces this.

## Booking

- **2026-09-30 · client, interpreted. The 3-day "join-only" window.** The request: "a 3-day window for upcoming events. A day will be unavailable if there are no bookings for that event date." It was read as days on the /book venue calendar, not hosted events. Inside today, +1 and +2, a venue-day nobody has booked is closed, and one booking opens it to everyone.
  - The boundary is `< 3` days. Nobody has said whether `<= 3` was meant.
  - Hosted rounds are exempt: their seats live in a different table, so the rule could never be satisfied there.
  - 2026-10-15 (client): admins can force a closed venue-day open (Admin → Courses → Open days), only for a date inside the window.
- **2026-10-01 · client. A full day is listed, shown as full.** So two rules decide whether a day appears, and they're easy to confuse. The window drops a near day nobody booked; a full day is listed *because* somebody did.
- **2026-11-04 · client. Non-member guests per booking** is a per-venue number, 1 by default. It's counted across the whole booking, including players added later.
- **2026-10 · client. Invitations expire 5 hours before tee time**, in the venue's timezone, and the seat is freed.
- **2026-09-17 · client. Pay at club.** Payment options are per venue. A pay-at-club round reads "Paying at club" everywhere. There's deliberately no "Paid at club" stage, because nothing ever tells the app the club was paid. A venue whose only option is pay-at-club creates rounds already at `payment_confirmed`, so they aren't stuck behind the payment gate. Credit codes only work with Pay on App, since they're typed into the venue's checkout.
- **A booking is one row per player** (since 2026-06-12). `player_member_id` says whose seat a row is. Bookings made before that date are a single row with a player count, and nothing recorded who the other players were.

## Hosts

- **2026-08-14 · decided. Hosted-round seats live in `hosted_event_registrations`, never in `bookings`.** The two capacity systems count separately. If both owned the seats, the same spots would be sold twice.
- **2026-08-19 · client. A member who books the venue on the day a host runs a round is at that round.** They're shown on the host's roster. They're deliberately *not* counted against the round's capacity, because the database enforces capacity on registrations alone.
- **2026-08-14. There are no recurring events.** One hosted round is one dated row. Recurring rounds would be new work, not a restore.
- **2026-08-14 · client. The GHL `host` tag still creates a host**, but no longer grants every venue: an admin grants venues.
- **Creating a round publishes it**, at a venue already on LinkUp. Only a club proposed through "New LinkUp" waits for admin review.
- **Hosts can't edit or cancel a listed round from the app.** Members reserve against its date and time. The edit code is still there, so restoring it means re-adding the buttons.

## Notifications and email

- **No throttling.** Every notification worth a push also gets an email, with no daily cap. The one exception is the suppression list: hard bounces, spam complaints and unsubscribes are never mailed again, because mailing them is what damages a sending domain.
- **Announcement emails go only to the members or tags the admin picks.** There's deliberately no "email everyone": a broadcast to every address is the send most likely to cost the domain. The post and the in-app notification reach the whole community regardless.
- **Booking reminders aren't emailed by the app.** GHL already emails and texts them.

## Architecture

- **GHL is the source of truth for membership.** Supabase mirrors it at sign-in, on the GHL contact webhook, and in the nightly reconcile.
- **GHL also owns tee times and payment.** A venue's tee times and seats come from its GHL calendar; the app keeps no tee-time table, only its own limits on top. A round becomes confirmed or paid only when a GHL pipeline workflow says so through `/api/webhooks/ghl/bookings`. Rounds are paid on a GHL checkout page, so the app never sees the payment itself. Hosted-round seats are the exception: they live in the app. The full split is in `docs/HANDOVER.md` §3.1.
- **Auth state lives in React Context**, not Zustand. `zustand` is still a dependency but unused.
- **Removed crons:** `/api/cron/daily` and `/api/cron/play-suggestions` were dropped from the schedule and later deleted. If their work is needed again, write it fresh.
- **`withAuth`'s `rateLimit` option is ignored.** Every route shares 120 requests a minute per member. To give a route its own limit, use a limiter from `src/lib/rateLimit.ts` inside the handler.

## Known debt, recorded on purpose

- **Host names and descriptions are HTML-escaped on save** (`Fritz&#x27;s Golf`). The fix needs a migration to unescape existing rows in the same change.
- **Pay-at-club rounds never get the post-round survey**, unless an admin moves their status.
- **`/api/host/bookings`** offers any member's booking at any course, with no venue filter. This is longstanding and arguably intended.
