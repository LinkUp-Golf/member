# Introduce Me — plan and decision record

Status: **Phase 1 done; decisions recorded 2026-11-25; Phase 2 not started.**
Nothing has been built, no migration written, nothing sent to GHL. This file is
the running record for the module: decisions, progress, open issues. Settled
decisions are copied into `docs/decisions.md` when the code that rests on them
lands.

---

## 0. Decisions (2026-11-25)

| # | Decision | Consequence for the build |
|---|---|---|
| 1 | Add **"Describe yourself as a golfer"** to the member profile | New column `member_profiles.golfer_description` (free text). Edited on More → Profile, shown on the member's profile page, pre-fills the introduction's Golfer Summary, and shown to the admin on the Matchmaking screen. Not used in match scoring (scoring stays rule-based, no AI). |
| 2 | Email: Greg sets audience, schedule and batching in GHL | The app prepares everything up to that point. **Correction:** GHL's API cannot create a campaign, not even as a draft. The closest it allows is a finished **email template**. So the app creates the template; Greg creates the campaign from it (see §2.1). |
| 3 | LinkedIn: the app creates the company-page post **as a draft**; Greg adds @tags and publishes | No scheduling or publishing by the app. The app polls the post afterwards only to record that it was published (and when). |
| 4 | Personal LinkedIn repost stays manual | The app sends Greg a notification once the company post is published, with the member's LinkedIn URL and an optional suggested comment. |
| 5 | Photo comes from the member profile; a profile photo is **required** to request an introduction | The Introduce Me screen sends a member with no photo to upload one first. The approved photo is uploaded to the **GHL media library** automatically as "First Last profile pic" (see §2.3) — no middle repository needed. |
| 6 | "Ready for review" and reminder emails are sent by the app | `notifyMember()` (push + LinkUp email). No GHL workflow. |
| 7 | AI provider: Claude API | Needs an Anthropic account and `ANTHROPIC_API_KEY`. |
| 8 | Community Captains: admin-only now, everything scoped by community | A reviewer role by community can be added later without rework. |
| 9 | Retention | Keep published introductions and their audit trail indefinitely; delete drafts and declined/canceled requests (and their photos/graphics) after 12 months; a member's account deletion removes unpublished material. |
| 10 | Reference email: the Ali Nikoopour GHL email (screenshot, 2026-11-25) | Layout in §3. |
| 11 | Audience: Greg chooses it in GHL. Planned: the **`subscriber-newsletter`** tag (broader than `member-active-sd`); intra- vs inter-community **undecided** | The app doesn't choose the audience, so this doesn't block the build. Each introduction records its community so the choice can be made later. Note: the spec asked not to send to the prospect database — whether `subscriber-newsletter` includes prospects is Greg's call. |
| 12 | Order of publication doesn't matter (2026-11-25) | No email-before-LinkedIn sequencing or warning. Spec §17's sequencing requirement is dropped. |
| 13 | Withdrawal after hand-off isn't needed while Greg sends/publishes the drafts by hand (2026-11-25) | A member can still cancel a channel or the whole request in the app **until** the admin hands it to GHL (it's the same code as declining). After hand-off the app only tells admins the member withdrew; no GHL clean-up is built. |
| 14 | "Aviara" as a community name becomes **"San Diego"** (2026-11-25) | Aviara is the anchor club of the San Diego community. Introductions print "San Diego". Renaming the community app-wide is a separate change (§10). |
| 15 | The golfer description is required only to use **Introduce Me** or **Curated Introductions** (2026-11-25) | Not required on the profile itself. Both services check it before they start: Introduce Me before the request form, Curated Introductions when it's switched on. These services are how members are moved to complete their profiles. |
| 16 | Profile relabel and reorder (§11) | Done 2026-11-25 with the golfer field (migration `20261125000001`). |

## 1. What already exists that the module reuses

| Need | Already in the app |
|---|---|
| Identity, auth on every route | `withAuth()` / `withAdminAuth()`, middleware, magic-link sign-in. The review link is an in-app URL behind the normal login. |
| Profile data | `member_profiles` + `members`. The introduction stores a **snapshot**; editing it never writes the profile. |
| Community | The member's home course (`members.home_course_id`), today Aviara / San Diego. |
| Photo upload | Profile photo upload already exists on More → Profile (Supabase Storage `avatars`). |
| Upload to GHL media library | `uploadMediaToGhl()` in `src/lib/ghl/client.ts` — already in production for host proof photos, with tests. |
| Graphic rendering | `next/og` (`ImageResponse`) ships with Next 14; `sharp` is installed. No new dependency. |
| Notifications | `notifyMember()` / `notifyAdmins()` (push + LinkUp-branded email with unsubscribe). |
| Scheduled work | Vercel cron with `CRON_SECRET`. |
| Admin area | `(admin)/admin/*`, `is_admin` gate. |

## 2. What GHL's API can do (from GHL's published OpenAPI specs)

Source: `github.com/GoHighLevel/highlevel-api-docs` (`apps/emails.json`,
`apps/social-media-posting.json`, `apps/medias`). Items marked *verify* get a
read-only check against the LinkUp account before code relies on them.

### 2.1 Email

- **Can:** create a template from our own HTML (`POST /emails/builder`, then
  `POST /emails/builder/data`), list and delete templates, list campaigns with
  status and delivered/opened/clicked counts (`GET /emails/schedule`).
- **Cannot:** create a campaign (draft or otherwise), set its audience,
  schedule or send it, or read smart lists. No webhook when a campaign sends.

So the hand-off is: app creates template **"Member Introduction | San Diego |
Ali Nikoopour | 2026-11-25"** → Greg: Marketing → Emails → New campaign → pick
that template → audience `active-member-sd`, schedule, batch. The app then
looks for a campaign of that name in `GET /emails/schedule` and records its id,
status and send time. *Verify* that a campaign built from a template is listed
under the template's name, or whether Greg names the campaign.

### 2.2 LinkedIn (Social Planner)

- **Can:** list connected accounts and tell a company page from a profile;
  create a post with text and an image with `status: draft` (*verify* draft is
  accepted on create); read a post's status (`draft`, `scheduled`, `published`,
  `failed`), `publishedAt`, platform `postId`; edit and delete it.
- **Cannot:** @mention people or companies (Greg tags by hand — decision 3);
  return the published LinkedIn URL (only `postId`; *verify* whether the URL
  can be built from it, otherwise Greg pastes it into the admin screen).

### 2.3 Media library

`POST /medias/upload-file` with a `name` — already used. The member's photo
goes up as **"First Last profile pic"**; the LinkedIn graphic as **"First Last
LinkedIn intro"**. The returned GHL URL is what the template and the post use,
so the image GHL sends is the exact file the member approved.

## 3. The email, from the reference

Matches the Ali Nikoopour email:

1. LinkUp logo, green rule
2. `Hi {{contact.first_name}},` — GHL fills it per recipient
3. Two standard paragraphs ("Here is one more person…", "Please ensure your
   member app profile is complete…") — fixed text, not member-approved
4. Photo (rounded, ~200px wide), **Name**
5. Labelled fields in small green caps: TITLE, COMPANY, COMMUNITY, LINKEDIN
   PROFILE URL (omitted when blank)
6. Rule, then PROFESSIONAL SUMMARY, PERSONAL SUMMARY, GOLFER SUMMARY
7. **Find in the App** button → the member's profile in the app
8. GHL footer (LinkUp Golf LP, Unsubscribe, View in Browser) — GHL adds this
   when sending; the app's template leaves it to GHL

Two small fixes the template will make: Personal Summary is set in a smaller
font than the other two sections in the reference, and the template will use
one size throughout; the logo will be served from a stable URL rather than
pasted in.

Member-approved parts: photo, name, title, company, community, LinkedIn URL,
the three summaries, subject line. Everything else is fixed.

## 4. Data model (new tables; one new profile column)

- `member_profiles.golfer_description` — decision 1.
- **`introduction_requests`** — member, community (`course_id`), the submitted
  snapshot (jsonb), photo storage path + GHL media id/URL, timestamps. One open
  request per member (partial unique index).
- **`introduction_channels`** — one row per (request, `email` | `linkedin`):
  consent given, consent wording version, consented/withdrawn at, channel
  status, approved version id, admin approver, GHL template id / campaign id /
  social post id, published URL and time, reminders sent, last error, attempts.
- **`introduction_versions`** — immutable content versions (`ai` / `member` /
  `admin`). An approval points at a version id, so any edit makes a new version
  and the old approval no longer applies.
- **`introduction_events`** — append-only audit log.
- **`introduction_settings`** — AI instructions per channel, subject format,
  reminder intervals, admin recipients, require-admin-approval (default on).
  Member consent and approval are enforced in code, not settings.

Channel statuses: `not_authorized`, `generating`, `generation_failed`,
`awaiting_member`, `member_approved`, `declined`, `awaiting_admin`,
`admin_approved`, `handed_to_ghl` (template / draft post created), `published`,
`failed`, `withdrawn`, `canceled`. The overall status is derived from the two.
Rules live in one pure, tested module (`src/lib/introductions/state.ts`).

## 5. Flow

```
Member  Introduce Me (own profile) — needs a profile photo first
        form pre-filled from profile (incl. golfer description), edits are intro-only
        two consents (LinkedIn unchecked by default), at least one required
App     Claude drafts only consented channels → validated JSON
        LinkedIn graphic rendered (LinkedIn consent only)
        member notified (push + email)
Member  review, edit, approve/decline per channel; reminders day 3 and 7
Admin   Introductions queue → review → approve (or edit → back to member)
App     re-checks consent + approvals, then:
          photo/graphic → GHL media library
          email    → GHL template created, admin notified "ready to send"
          linkedin → draft post on the company page, admin notified "ready to tag & publish"
Greg    creates + schedules campaign in GHL; tags + publishes the post
App     polls GHL: records campaign sent / post published
        → repost notification to Greg (post URL, member's LinkedIn, suggested comment)
```

**Order.** Either channel may go out first (decision 12).

**Withdrawal.** Until hand-off the member can cancel a channel or the whole
request in the app. After hand-off the app only alerts admins, since Greg is
the one sending (decision 13).

## 6. Open questions

- ~~Q1. Tag spelling~~ — resolved: `member-active-sd` (the app matches tags
  case-insensitively, so `member-active-SD` in the code is the same tag).
- ~~Q2. Professional / Personal Summary source~~ — resolved by the relabel
  (§11): the profile now carries all three summaries under those names.
- ~~Q3. Community wording~~ — resolved: "San Diego" (decision 14).
- ~~Q4. Golfer description required?~~ — resolved: only for the two services
  (decision 15).

## 7. Still needed from you

- Logo file (or permission to take it from the existing GHL template), brand
  colours, and approval of the LinkedIn graphic design (I'll mock it up first).
- 2–3 past introductions you consider good, for the AI instructions.
- Before Phase 5: add scopes to the GHL private integration —
  `emails/builder.write`, `emails/builder.readonly`, `emails/schedule.readonly`,
  `socialplanner/account.readonly`, `socialplanner/post.readonly`,
  `socialplanner/post.write`, `medias.write` — connect the LinkUp Golf company
  page in Social Planner, and name the GHL user to create posts as.
- An Anthropic API key (`ANTHROPIC_API_KEY` in Vercel, dev first).

## 8. Phases

1. **Discovery** — done. Remaining: read-only GHL checks once scopes exist.
2. **Member side** — golfer description on the profile; Introduce Me button on
   own profile; photo gate; request form + consents; status screen; tables,
   state module, tests.
3. **Content** — Claude integration, settings-driven instructions, validation;
   graphic template; email HTML matching §3, with a preview.
4. **Approval** — review/edit per channel, versioned approvals, reminders cron,
   admin queue.
5. **GHL hand-off** — media upload, template create, draft post, status polling,
   withdrawal clean-up, repost notification. Tested with test contacts and a
   draft post only; nothing live without your go-ahead.
6. **Testing & launch** — spec §23 scenarios, handover docs.

## 9. Risks

- Whether GHL lists a campaign under its template's name (§2.1). Fallback: Greg
  pastes the campaign name or ticks "sent" in the admin screen.
- Whether `status: draft` is accepted when creating a Social Planner post.
- LinkedIn URL may not be derivable from `postId`.

## 10. Follow-up outside this module: "Aviara" → "San Diego"

The app treats a member's home course as their community, and the course is
Aviara, so "Aviara" appears in places that mean the community (e.g. the admin
announcement confirmation "visible to all Aviara members", the guest-access
page "Aviara is currently the first LinkUp community", the settings screen's
home-course line, the promotions "Aviara only" badge). Other places mean the
venue itself (Park Hyatt Aviara on /book, the group-dinner rule) and stay.
Doing it properly means giving the app a community name separate from the
venue. Tracked as its own change, not part of Introduce Me.

## 11. Profile relabel and reorder — received 2026-11-25, implemented

Greg's list:
1. Title and Organization at the top, on one line.
2. "Intro message" → **Professional Summary**.
3. Hobbies moves below Professional Summary, renamed **Personal Summary**.
4. Remove the Focus LinkUps section.
5. (follow-up) Title and Organization already show under the photo, so they
   aren't repeated while viewing; they're edited side by side at the top in
   edit mode. The header line now shows either half on its own (it used to
   vanish without a title).

Placed by me, matching the email's order: **Golfer Summary**
(`golfer_description`) directly after Personal Summary.

So the introduction's summaries map one-to-one (resolves Q2):
Professional Summary = `business_description`, Personal Summary =
`non_golf_hobbies`, Golfer Summary = `golfer_description`.

More → Profile order now: photo / name / "Title · Organization", then (edit
only) Title + Organization, Professional Summary, Personal Summary, Golfer
Summary, LinkedIn profile, Industry category (edit only), Value I offer, What
I'm looking for, Non-profits, Privacy (edit only).

The member profile page others see (`/members/[id]`) relabels Hobbies to
Personal Summary and shows Golfer Summary after it; its other sections are
unchanged. The bottom-sheet preview (`MemberProfileSheet`) is unchanged.
