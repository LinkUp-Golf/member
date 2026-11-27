# Decisions

Why the app works the way it does, where the code alone doesn't say. Most entries answer an ambiguous request or settle a trade-off, and some look like bugs until you know the reason. Before changing one, check whether its reason still holds.

Each entry gives the date, who decided (**client** means the LinkUp Golf owner; **default** means a developer's call, flagged at the time and never confirmed), and the decision. Newest areas first.

## Membership and access

- **2026-11-27 · client. Removing the membership tag ends access, after the member's last round.** Before, a member whose `member-active-SD` tag was removed became a guest who could still sign in, and stayed in the member directory until the nightly sync. Now they become a **former member** (`members.membership_status = 'cancelled'`, `src/lib/auth/former-member.ts`): off the directory and every active-members list straight away. While they still have a round ahead (a booking seat or a hosted-round reservation, dated today or later) they keep the app except booking a new round, member chat, Refer a Member and Curated Introductions. After the day of their last round they have no access: sign-in is refused and an open session is signed out. Default: a contact who was never a member (a prospect) still signs in as a guest, as since 2026-10-23, and someone left holding another access or role tag (`member-guest`, `nbd client`, `host`, `referral-partner`) isn't a former member. Default: "last pending booking" counts any seat not cancelled or waitlisted, confirmed or not.
- **2026-11-27 · default. The contact webhook takes a shared secret.** `POST /api/webhooks/ghl` only accepted an HMAC signature, which a GHL workflow can't produce, so tag changes reached the app only at sign-in or the nightly sync. It now also accepts the header `x-linkup-secret: <GHL_WEBHOOK_SECRET>`, like the bookings webhook. Separately, every signed-in request already re-checks the member's tags in GHL (cached up to 15 minutes); when they show a membership began or ended, the member row is now re-synced on the spot.

## Cancellation fees

- **2026-11-25 · client. Invoiced by hand in Stripe for now.** Late cancellations are few, so the client invoices them manually from the Stripe dashboard. Setting up `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` in Vercel is deferred. While `STRIPE_SECRET_KEY` is unset the in-app policy is off: the app shows, records and invoices no fee. That's intended, not a missing setup. Revisit if volume grows.
- **2026-11-12 · client. Invoices, not a card on file.** The client asked to stop collecting card details. A late cancellation is issued as a Stripe invoice, due in 7 days, and the member pays on Stripe's invoice page. The card-on-file version (a card saved at booking and charged automatically) existed from 2026-11-03 to 2026-11-12 and was removed whole.
- **2026-11-12 · default. "Once the payment was received."** The client's message cut off after these words. They were read as: mark the fee paid, and send the member a receipt (`cancellationFeePaid`). If the intent was something else, such as holding the seat until it's paid, that's a different design.
- **2026-11-12 · default. Our email, not Stripe's.** The app sends its own email linking Stripe's invoice page, and doesn't call Stripe's `sendInvoice`. That keeps it to one message in the app's template, and it also arrives in Stripe test mode, where Stripe emails nobody.
- **2026-11-12 · default. An unpaid fee doesn't block booking.** The invoice and its due date are the whole of the collection.
- **2026-11-12 · default. Voiding the invoice in Stripe waives the fee.** It's the only waive path until there's an admin fee screen.
- **2026-11-03 · client. Tiers.** Free up to 2 days before; 50% the day before; 100% on the day. These are percentages of each seat's own price, so a new event at a new price needs no setup.
- **2026-11-03 · client. Already-paid rounds are ignored.** "Payment is paid to the shop as of now." Nothing refunds or credits a paid round that's cancelled.
- **2026-11-03 · default.** The person who cancels pays. Seats booked before the policy existed are exempt. Unanswered invitations and unconfirmed requests are free to cancel. "Day" is the venue's calendar day, not a 24-hour count.

## Profile

- **2026-11-26 · client. Two-way sync with GoHighLevel.** Organization, title, LinkedIn, non-profits, date of birth and gender travel both ways; the latest change wins. Name, email and phone stay GoHighLevel-only, and members can't edit them in the app (client chose this over a confirm-the-new-address flow for email). Default: a member's edit is written to GoHighLevel first and the save refused if it can't be, because saving locally anyway would be undone by the next sync.
- **2026-11-26 · client. Gender and community are tags, not fields.** Gender is `gender-male` / `gender-female` / `gender-pns`; community comes from the membership tag (`member-active-SD` = San Diego). GoHighLevel's Community and Gender fields are no longer used. Default: gender tags are kept out of the app's stored tag list, since that list reaches other members' devices in places.
- **2026-11-26 · client. Date of birth and gender are private, with "Prefer not to say".** Asked on More → Profile under Private details, used only for Curated Introductions. "Prefer not to say" for gender is now also an answer in the survey, so saving the survey can't erase it; for matching it reads like a blank. Default: date of birth must be a real date of someone 18 to 110.
- **2026-11-26 · client. Existing gender answers are copied to GoHighLevel once.** Default: done by the sync rather than a one-off script — a contact with no gender tag gets the app's answer at its next sync. A tag set in GoHighLevel always wins.
- **2026-11-26 · client. One-time import: what members typed in the app stays.** Before the sync went both ways, app and GoHighLevel had drifted apart. For the 89 active members, a field blank in the app was filled from GoHighLevel, and the app's value was written to GoHighLevel otherwise — except two values the client chose to keep from GoHighLevel. 72 members were updated (script in `ghl-cleanup/`, kept out of git). While waiting for it, organization was briefly fill-blanks-only in the sync (#59); that was removed once the import was done.
- **2026-11-26 · client. "Organization", not "Business name".** App wording only; GoHighLevel keeps "Business Name".
- **2026-11-26 · client. One Title field, one Business Name field.** GoHighLevel had several, made by copying and renaming, so names and keys didn't match. Keepers: `contact.title` (single line) and the built-in Business Name. The 66 `member-active-sd` contacts were cleaned by script (`ghl-cleanup/`, kept out of git): values that agreed or had one source were copied automatically, conflicts were reviewed by the client, and only 3 contacts needed a write. The 158 Golf Membership contacts past the Identified column were then cleaned the same way (11 writes), and the three duplicates were deleted in GoHighLevel on 2026-11-26 after a full contact export. Forms, workflows and templates weren't checked first (client's call): if one shows a blank company or title, repoint it to `contact.title` / `contact.company_name`.

- **2026-11-25 · client. Three summaries, named like the introduction email.** On More → Profile, "Intro message" is now **Professional Summary** and "Hobbies" is now **Personal Summary**, directly below it. A new **Golfer Summary** ("describe yourself as a golfer", `member_profiles.golfer_description`) follows. The columns keep their old names (`business_description`, `non_golf_hobbies`). Default: Golfer Summary was placed after Personal Summary to match the order of the Introduce Me email.
- **2026-11-25 · client. A blank Golfer Summary reads as a default line.** Other members see "A golfer who embraces moments of celebration and ponders moments of reflection." (`DEFAULT_GOLFER_DESCRIPTION`) instead of "Not filled in". Default: it's shown only, never saved, so Introduce Me and Curated Introductions still see the field as blank and ask for a real one, and the member's own Profile screen still shows it empty.
- **2026-11-25 · client. Golfer Summary is optional on the profile.** It becomes required only when a member uses Introduce Me or Curated Introductions. Those services are how members are moved to complete their profiles.
- **2026-11-25 · client. Title and Organization aren't repeated.** The header under the photo already shows "Title · Organization", so the two rows below it were removed when viewing. In edit mode they sit side by side at the top. Default: the header now shows either half on its own; before, it showed nothing for a member with an organization but no title.
- **2026-11-25 · client. Focus LinkUps groups are off the own-profile screen.** They're managed on More → Focus LinkUps. Default: the member profile page other members see, and the profile sheet, still list them.

## Curated Introductions (matching)

- **2026-11-24 · client. Two-sided matches, no reasons shown.** Both members of a match get it in their queue and the same "new Curated Introduction" notification, with no name and no reason; they judge each other from the profile and LinkedIn. The admin's note is optional and internal. The queue lives at the top of More → Curated Introductions (the sidebar on a computer). Shipped as Phase 1 of the open-ended redesign (`docs/proposals/curated-introductions-open-ended.html`). Default: matches sent before this stay one-sided; nothing back-fills the other side.

- **2026-11-20 · client. Two steps.** "Describe Yourself" (your business, your golf, about you), then "Describe Your Ideal Match" (what you're looking for, who you'd like to meet, who you'd like to play with), with step indicators, Back and Continue, and Submit at the end.
  - Default: "Describe any solutions, services or resources you seek" moved to step 2, since it says what the member wants. "Describe your offering" stays in step 1.
  - Default: where the profile already says something, the survey starts from it. Industry, role (from a job title that says one role plainly, such as "CFO"), golf skill (from the handicap), offering and seeking are pre-selected, and the member can change them.
- **2026-11-20 · client. No limit on objectives.** Members choose as many as they like.
- **2026-11-20 · default. Which questions became multi-select.** The request named "Preferred Roles" and organization size "based on their preferences". The two preference questions (Preferred roles, Preferred company size) already took several answers, and still do. The member's own role and organization size are still one answer each. Making those multi-select would need new array columns and a database update, so it wasn't done without asking.
- **2026-11-20 · client. Afternoons only.** Play times are Weekday afternoons and Weekend afternoons. Default: earlier answers (weekday early, midday or twilight; weekend morning) are read as the afternoon of the same kind of day, in code, so no stored answer was rewritten and old and new answers compare.
- **2026-11-20 · client. "Other" on preferred industries, with a name.**
  - Default: offered on the member's own industry too, so a named preference has something to match.
  - Default: a named industry is stored as itself beside the listed ones (the columns already hold labels), so no column was added.
  - Default: for ranking, it counts as met by the same words or a shared non-generic word.
- **2026-11-20 · client. Golf skill wording.** "I'm an excellent golfer", "I'm a good golfer", "I'm a new golfer"; no hyphens and no handicap talk. Default: the preference reads "Excellent golfers", "Good golfers", "New golfers", and "Good golfers" still lets in excellent golfers, as it did when it read "Mid to low handicap golfers only". If the client wants it to mean good golfers only, that's a change to `SKILL_FITS`.
- **2026-11-20 · default. The layout bug.** The walkthrough's layout issue wasn't described. The one found: the survey's hidden radio buttons were positioned against the page instead of their option, so they sat outside the app's scrolling area and stretched the page to about 5,000px on a phone. The page could be dragged past the app into blank space, and tapping an answer could make it jump. Each option now contains its radio.
- **2026-11-04 · client. Admin-led, no AI.** An admin picks every introduction; the app only lists and ranks candidates. Asked whether AI would help, the answer given was: the rules are enough for now, and AI would only add something for the free-text "what you offer / seek" fit.
- **2026-11-12 · client. Optional, switched on from More.** The survey had been mandatory, a full-screen gate. It's now "Curated Introductions" under More, with a switch. Off means out both ways (default): the member isn't introduced to anyone and isn't suggested to anyone.
- **2026-11-12 · client. The wording is the client's.** Section titles, "Objectives", "Team Members", "Preferred industries", "Organization size", "Solopreneurs", "Golf Skill", "Tell us about yourself", "Preferred introductions", "Turn on Curated Introductions". Keep it exact.
- **2026-11-12 · default. Mentors / Mentees mapped by meaning.** The client wrote "Give mentorship → Mentors, Get mentorship → Mentees". Under "Objectives" (what you want), "Mentors" means *looking for* a mentor, which is the old `get_mentorship`. So "Mentors" is stored as `get_mentorship`, and older answers keep their meaning.
- **2026-11-12 · client. "Business Owner / Founder" is a role, not an industry.** It's gone from the survey's industry list and is now "Founder / Owner / CEO" in a new role list. The database update moved existing picks across. The app-wide industry list on profiles is unchanged (default), so it may still need cleaning up.
- **2026-11-12 · default. "Other" became a "Non-profit" industry.** This was the reading of the client's note "Preferred industries ['Other'] → Add non-profits".
- **2026-11-12 · default. An optional "Your role" question was added**, so that "Preferred roles" has something to be checked against.
- **2026-11-12 · default. "Who you'd like to meet" ranks; "who you'd like to play with" filters.** Preferred industries, roles and company size only order the list. Gender, skill, attitude and the smoke / music / booze answers rule people out, checked both ways.
- **2026-11-04 · default.** Matching stays within the member's home club. Both sides are told about an introduction. A pair either side dismissed with Not now stays off the list for 90 days.
- **Privacy, by design.** Gender, habits and preferences are readable only through the service role and shown only to admins, never in a note or a chip. A test enforces this.

## Booking

- **2026-11-25 · client. The group-table question is asked only on days with more than one foursome.** "We don't need a reservation if there's just 4 players because the restaurant can almost always seat a group of 4." Default: a foursome is a tee time on the venue's calendar that day, booked or still open, counted once (`src/lib/bookings/group-table.ts`). Booked tee times come from our rows, because a full one drops out of GHL's free slots. The count is taken when the booking is made, so a member who booked before a second tee time was added was never asked, and nothing asks them later. If the count can't be read, the question is asked.
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
- **2026-11-25. The signed-in member's own row is read through the server** (`GET /api/members/me`), not the browser Supabase client. The browser client's session can stall or go stale (an auth lock, a refresh that never settles; most often in the installed app) while the cookie every API route uses is fine. When it did, the app worked but the Profile screen painted nothing and the menu lost its Admin entry. The route skips the GHL re-check, so a GHL outage can't blank the profile either.
- **2026-11-25. An admin-generated login link asks before it replaces a signed-in session.** The admin who triggered the profile/Admin outage had opened a member's link on their own phone. Asking first is cheaper than untangling a session that was swapped under a running browser client. The token isn't spent until the person chooses.
- **2026-11-25. The admin layout trusts the server, not the browser client, about who is signed in.** The middleware already checks `is_admin` from the cookie before `/admin` is served. A second check against the browser client only added a way to be bounced out when that client was stale.
- **2026-11-25. Open tabs reload themselves after a deploy, at the next screen change.** The service worker wasn't the cause of stale code (it caches hashed assets and the start URL, NetworkFirst); a long-lived App Router tab simply never reloads. Reloading at the next screen change rather than on the spot is so nobody loses a half-typed message.
- **Removed crons:** `/api/cron/daily` and `/api/cron/play-suggestions` were dropped from the schedule and later deleted. If their work is needed again, write it fresh.
- **`withAuth`'s `rateLimit` option is ignored.** Every route shares 120 requests a minute per member. To give a route its own limit, use a limiter from `src/lib/rateLimit.ts` inside the handler.

## Known debt, recorded on purpose

- **Host names and descriptions are HTML-escaped on save** (`Fritz&#x27;s Golf`). The fix needs a migration to unescape existing rows in the same change.
- **Pay-at-club rounds never get the post-round survey**, unless an admin moves their status.
- **`/api/host/bookings`** offers any member's booking at any course, with no venue filter. This is longstanding and arguably intended.
