---
name: weekly-release-report
description: Write the weekly "What's New" release report for the LinkUp Golf client — every change grouped by who it affects (admins, hosts, members) in short, plain-English lines a non-technical reader understands. Use when asked for the weekly release report, release notes, a changelog for the client, or "what's new this week".
argument-hint: "[range — e.g. 'main..develop' (default), 'last 7 days', 'since 2026-10-09']"
---

# Weekly release report

Write the weekly report that goes to the client: what changed in LinkUp Golf,
grouped by **who it affects** — admins, hosts, members — in short lines anyone
can follow.

**Who reads it:** the client. They are older and not technical. They know the
app from the screen, not from the code. Every line must make sense to someone
who has never heard of a database, a webhook or a migration.

## 1. Collect the changes

Range: `$ARGUMENTS` if given, otherwise everything on `develop` not yet on
`main` (`main..develop` — what's about to go live). "last 7 days" means
`--since="7 days ago"` on `develop`; "since <date>" likewise.

```bash
git fetch origin --quiet
git log --no-merges --format='%h %ad %s%n%b%n---' --date=short main..develop
git diff --stat main..develop
```

- Read each commit's **body**, not just its subject — the body says what the
  change does for the user.
- When a commit message doesn't make the user-facing effect clear, read its
  diff (`git show <hash>`) until it does. Never guess what a change does.
- **Drop reverted work.** A commit and its `Revert "…"` cancel out — neither
  appears. A fix to something added in the same range folds into that item.
- Fold small follow-ups (copy tweaks, a button moved) into the feature they
  belong to, unless they're the only change in that area.

## 2. Sort each change by module

Decide from the reader's side: **who sees or feels this change?**

| Module | Where the change lives |
|---|---|
| **Admins** | `src/app/(admin)/`, `src/app/api/admin/`, admin-only emails/notifications |
| **Hosts** | `src/app/(host)/`, `src/app/api/host/`, host notifications |
| **Members** | `src/app/(app)/`, member API routes (`api/bookings`, `api/members`, …), member emails/notifications |
| **Behind the scenes** | crons, database updates, performance, security, fixes nobody sees directly |

- A change that touches more than one group goes under **each** group it
  affects, written from that group's point of view. (Example: "admin can book
  for a member" — Admins: how to do it; Members: "you'll get a notification
  when the team books for you".)
- A shared component (`src/components/`, `src/lib/`) belongs to whoever sees
  its effect, not to "behind the scenes" by default.
- Skip a group with nothing in it.

## 3. Write it

Output this, in chat, as plain markdown. **No artifact, no file, no design
pass** — the user copies it into their message to the client.

```
# LinkUp Golf — What's New
**<D Month YYYY>**

## Before it goes live
## For admins
## For hosts
## For members
## Behind the scenes
## Still to do
```

**Every bullet:** a **bold lead-in** naming the change, then one or two short
sentences: what it does and where to find it.

> - **Move a booking to another day.** On the bookings page, press "Move" next to
>   any player. Pick a new date and one of that day's open tee times, and the
>   whole group moves together. Everyone is told.

Rules:

- **Plain words.** Say what the person sees and does: the button they press,
  the page it's on, what happens next. Name buttons and pages exactly as they
  appear on screen, in quotes.
- **Short.** One idea per bullet, one or two sentences. If it needs three, it's
  two bullets.
- **No technical words.** No commit hashes, file paths, function, table or
  column names, migration names, API routes, or code. Translate:

  | Don't write | Write |
  |---|---|
  | migration, schema, column, RPC | database update |
  | GHL, GoHighLevel | the booking system |
  | push notification | app notification |
  | cron, scheduled job | an automatic check that runs every few minutes / every day |
  | webhook | (describe the effect: "when a payment comes through…") |
  | FIFO gate, payment-due check | "members with an unpaid round can't book another" |
  | RLS, auth, endpoint, API | (leave out, or "security") |
  | toggle, flag | switch / setting |
  | bug fix in X | "X now works properly when …" |

- **Say who's affected and what they need to do**, if anything ("Turn this on
  per course — it's off to start with").
- Don't oversell. Say what it does, not that it's "powerful" or "seamless".

**Before it goes live** — only if something must happen first (a database
update to apply, a setting to switch on, something to set up in the booking
system). Say it in plain words. Leave the section out if there's nothing.

**Behind the scenes** — at most three bullets, the ones the client would care
about (reliability, speed, safety). Leave out pure housekeeping.

**Still to do** — known gaps, decisions the client needs to make, and anything
not yet checked in the live app. Phrase decisions as a question they can answer
("Should unanswered invitations expire the evening before instead?").

## 4. In the reply around it

After the report, add a short note to the **user** (not part of the report):
the commit range used, anything you were unsure how to place or describe, and
any change you left out on purpose (and why). Keep engineering detail there, not
in the report.
