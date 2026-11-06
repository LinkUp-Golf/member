# Playing Partner Matching

Each member is recommended someone new to play with: a person they haven't been out with yet, who fits how they play and has a real reason to talk business on the course. The app finds the candidates. An admin chooses every match and sends it. Nothing is suggested automatically, and no AI is involved.

| Part | What it is |
| --- | --- |
| Survey | A mandatory sheet every member completes before using the app: a networking profile, then golf preferences that rule partners in or out. |
| Admin matching | **Admin → Matchmaking.** Pick a member, see the players who fit them ranked by the survey answers, choose, add a note on why, send. |
| Member view | A push and an email, then **Recommended for you** at the top of Members and on Home, a **Suggested** tag in the member list, and a **Suggested** tab when adding a player to a round. The recommended player is told too. |

## Where it lives

| Piece | File |
| --- | --- |
| Questions, options, validation | `src/lib/matching/survey.ts` |
| Filters, score, chips, note (pure) | `src/lib/matching/rules.ts` |
| Loading the pool and history | `src/lib/matching/candidates.ts`, `src/lib/matching/queue.ts` |
| Survey API | `GET` / `PUT /api/match-survey` |
| Mandatory gate | `src/components/matching/MatchSurveyGate.tsx`, mounted in `src/app/(app)/layout.tsx` |
| Survey form | `src/components/matching/MatchSurveyForm.tsx` (gate: step by step; `/more/match-profile`: every section on one page) |
| Admin screen | `src/app/(admin)/admin/matching/page.tsx`, `GET /api/admin/matching`, `GET` / `POST /api/admin/matching/[memberId]` |
| Member view | `src/hooks/useRecommendations.ts` (one fetch shared by everything below), `src/components/matching/RecommendedPartners.tsx`, `SuggestedTag.tsx`, `SuggestedPlayerPicker.tsx`, `GET /api/recommendations`, `POST /api/recommendations/[id]/dismiss` |
| Schema | `supabase/migrations/20261104000002_partner_matching.sql` |
| Tests | `src/__tests__/matching-rules.test.ts` |

## 1. Survey

Mandatory. A member of a club (a home course, active, holding a membership tag) who hasn't submitted it gets the survey over the whole app, with no way to dismiss it, until they finish. Guests, referral partners and hosts without a golf membership, and admin accounts without a membership of their own are never asked. If the status read fails the gate stays open, so a broken endpoint can't lock members out of their bookings.

Every pick-list is required. The free text, the handicap and "Who are your best clients?" are optional. Members change their answers any time from **More → Golf Preferences**.

### Networking profile

| # | Question | Answers | Why the matcher needs it |
| --- | --- | --- | --- |
| 1 | What do you want from LinkUp connections? (up to 3) | New clients, referral partners, capital, investment deals, hiring, vendors, give mentorship, get mentorship, just golf | The intent behind every match |
| 2 | Who would you most like to meet? | Industries, multi-select | Industry targeting, checked both ways |
| 3 | What industries are your best clients in? How big are their companies? (both optional) | Industries, multi-select; company sizes, multi-select | "Potential client" |
| 4 | How big is your company? | Single choice | Peer fit, and the other side of question 3 |
| 5 | What you offer and what you're looking for (optional) | Free text, pre-filled from the profile | Business fit. Admins read it beside each candidate |
| 6 | When do you usually play? | Weekday early, midday or twilight; weekend morning or afternoon | Play-time overlap |
| 7 | Your golf attitude, plus handicap (handicap optional) | The same three attitudes as question 11 | What the attitude preference is checked against; handicap feeds skill level |
| 8 | Outside golf (optional) | Hobbies and up to 3 non-profits, pre-filled | Shared interests |

### About you

A preference describes the other person, so it only works when every member also answers for themselves. These answers are never shown on a profile.

| Question | Answers | Checked by |
| --- | --- | --- |
| Your gender | Male, Female, Prefer not to say | Gender preference. Prefer not to say fits only members with no gender preference |
| Do you smoke cigars on the course? | Yes / No | "Do you mind … cigars?" |
| Do you smoke cigarettes on the course? | Yes / No | "Do you mind … cigarettes?" |
| Do you smoke marijuana on the course? | Yes / No | "Do you mind … marijuana?" |
| Do you drink alcohol on the course? | Yes / No | "Do you mind … alcohol?" |
| Do you play music from a speaker on the course? | Yes / No | "Do you mind … music?" |

### Golf preferences

The section opens with *Describe the profile of person you would or would not like to play golf with*. Each answer is a filter applied before scoring: it decides who can be recommended, not how highly. "No preference" and "No" rule nobody out.

| # | Question | Answer options | How the matcher uses it |
| --- | --- | --- | --- |
| 9 | Do you have a gender preference? | Male · Female · No preference | Leaves out candidates of another gender |
| 10 | Do you have a skill level preference? | Excellent golfers - Low handicap golfers only · Good golfers - Mid to low handicap golfers only · New golfers - Beginners or high handicap golfers only · No preference | Leaves out candidates outside the level. Low is up to 9, mid 10 to 18, high 19 and up; no handicap counts as a new golfer |
| 11 | Do you have a golf attitude preference? | Serious, competitive, strict adherence to rules of golf · Friendly competition · Relaxed, casual, "Not Attached to the Outcome". Score keeping optional · No preference | Leaves out candidates whose own attitude (question 7) is different |
| 12 | Do you mind playing with people who smoke cigars? | Yes / No | Yes leaves out candidates who do it on the course |
| 13 | Do you mind playing with people who smoke cigarettes? | Yes / No | 〃 |
| 14 | Do you mind playing with people who smoke marijuana? | Yes / No | 〃 |
| 15 | Do you mind playing with people who drink alcohol? | Yes / No | 〃 |
| 16 | Do you mind playing with music playing from speakers? | Yes / No | 〃 |

The sheet ends with one toggle, **Suggest me to other members**, on by default. Turning it off takes a member out of other people's candidate lists. They still receive recommendations of their own.

### Storage

Pick-lists go to `member_match_profiles`: RLS on, no policies, read only through the service role. The free text, handicap and non-profits stay on `member_profiles`, where the profile page already edits them. `completed_at` is set on the first full submission and is what the gate and the admin queue read.

## 2. Admin matching

**Admin → Matchmaking** has two panes.

**The queue** lists members with a complete survey and no recommendation in the last 30 days, newest survey first. Any member can also be found by name or email. The queue card is sized to the screen and scrolls inside itself; it loads 20 at a time and fetches more as it scrolls, as does the list of players who fit.

**One member** shows their role, industry, course, handicap, goals, play times, what they offer and seek, and their golf preferences. Preferences are visible to admins only. Below that is the candidate list, best first.

### Who's on the candidate list

Left out first:

- anyone outside the member's home course, inactive, hidden, opted out of being suggested, or without a completed survey
- anyone they've already played with or have a round booked with (`members_played_with`: bookings and hosted events)
- a pair either of them dismissed with Not now in the last 90 days
- anyone either member's golf preferences rule out

Golf preferences are checked both ways: B is listed for A only if B fits A's preferences and A fits B's. A candidate who hasn't answered the question a preference needs is left out, because the preference can't be checked. An admin can't override a preference. The list says how many were ruled out.

Everyone left is scored out of 100 (`MATCH_WEIGHTS` in `rules.ts`). The score only orders the list.

| Weight | Component | Measures |
| --- | --- | --- |
| 40 | Business fit | B answers what A wants: a potential client, mentoring, referral partners, capital, hiring, or what A seeks in B's own words |
| 20 | Industry targeting | B is in an industry A wants to meet |
| 20 | Play fit | Shared play time, handicaps within 8, same golf attitude |
| 10 | Shared interests | A shared non-profit or hobby |
| 10 | Recently active | Signed in within 14 days (half within 30) |

The pair's score is the geometric mean of A→B and B→A, so a match that only works for one person scores low.

### Sending

A pair already sent in either direction stays on the list, ticked and disabled, with when it was sent: "Recommended to Sam" or "Sam was recommended to Dana".

The admin ticks up to 5 players. Each pick carries a note, pre-filled from the rules ("Dana is a founder, the kind of client you serve, and you both play early on weekdays."), which the admin edits or sends as it is. Notes and chips are built from the networking answers only and never mention a preference, a gender or a habit.

The server rebuilds the list before saving, so a stale screen can't send a match that no longer fits. Each pick is a `play_suggestions` row with `recommended_by` and `note`; re-sending a pair dismissed long ago reopens its row. The member gets one push and email: "Play with Dana?" with the note for a single pick, "3 playing partners for you" for several. Each recommended player gets their own: "You've been recommended to Sam", linking to Sam's profile. The note isn't in it, since it's written to the member.

**Already sent** shows each recommendation's outcome: Sent, Seen, Not now, Messaged, Round booked, Played together.

## 3. Member view

**Recommended for you** sits at the top of Members (every open recommendation) and on Home (the newest, with a link to the rest). It appears only when there's one to show.

- Photo, name, title, company and industry
- **Why you two**: the admin's note, marked "Recommended by the LinkUp team"
- What the two share: play times and causes
- **Message** opens a new conversation with them
- **Invite to a round** opens booking with them added
- **Not now** hides the recommendation and keeps them off the admin's list for this member for 90 days

Members list: a **Suggested** tag beside each recommended member. Hovering it with a mouse shows the note and what the two share; on a phone, a tap does the same, and a second tap or a tap elsewhere closes it.

Add player, both when booking and on an existing booking: a **Suggested** tab beside Member and Non-member, listing the recommended members who can be added to that round, one tap each. It appears only when there's a recommendation.

Opening the list stamps `seen_at`. Not now and completing the survey are recorded as activity (`recommendation_dismissed`, `match_survey_completed`).

## Privacy and trust

- Gender, the smoke, music and booze answers, and the preferences appear only on the admin screen. They're never shown on a profile or named in a note, so nobody learns why someone wasn't recommended to them.
- Hidden profiles and members who turned off **Suggest me to other members** never appear on a candidate list.
- Only admins send. The send route is behind the admin check, and a member can only read their own `play_suggestions` rows.

## Also fixed

The "played together" badge on member profiles read `play_history`, which nothing writes to, so it was always false. It now reads `members_played_with` and counts rounds already played.

## Deploying

Apply `20261104000002_partner_matching.sql` before deploying. The gate turns on for every member as soon as it ships, so the first visit after release opens the survey.

## Decisions taken

These were open questions in the proposal. Each went with the recommended default and can be revisited.

| Question | Decision |
| --- | --- |
| Home course only, or all of LinkUp? | Home course only |
| Opt in or opt out of being suggested? | Opt out: the toggle is on by default |
| Tell both members, or only one? | Both: the member gets the recommendation, and each recommended player is told who they were recommended to |
| Include hosts as candidates? | A host who is a member is in the pool like anyone else |
| Skill level lines | Low up to 9, mid 10 to 18, high 19 and up; no handicap counts as new |
| Ask the "about you" questions? | Yes, in their own step before the preferences |
